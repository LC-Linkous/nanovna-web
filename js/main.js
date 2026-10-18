// main.js — application state and wiring. Everything else is a module.
// SPDX-License-Identifier: GPL-2.0-only
import { NanoVNA } from './device/nanovna.js';
import { SerialLink, hasWebSerial } from './device/serial-link.js';
import { DemoLink } from './device/demo-link.js';
import { MODELS, DEFAULT_MODEL, detectModel } from './device/models.js';
import { db, swr, phaseDeg, gammaToZ, fmtHz, fmtZ, nearestIndex, minSwrIndex } from './rf.js';
import { renderRect } from './plot/rect.js';
import { renderSmith } from './plot/smith.js';
import { renderWaterfall, WATERFALL_ROWS } from './plot/waterfall.js';
import { buildLut, cssGradient } from './plot/palettes.js';
import { cssVar } from './plot/common.js';
import { settings, applyTheme, initSettingsPanel, save as saveSettings, sanitize as sanitizeSettings } from './ui/settings.js';
import { initConsole } from './ui/console.js';
import { initSidebar } from './ui/sidebar.js';
import { collectDiagnostics } from './ui/diagnostics.js';
import { download, stamp, csvBlob, touchstoneBlob, canvasPng, rgbaToPngDownload } from './ui/export.js';
import { initCalibration } from './ui/calibration.js';
import { initCw } from './ui/cw.js';
import { sessionBlob, parseSession, parseTouchstone, pickFile } from './ui/session.js';
import { initDeviceTools } from './ui/devicetools.js';
import { createRecorder } from './ui/recorder.js';
import { initAbout } from './ui/about.js';

const APP_VERSION = '0.4.2';
const $ = id => document.getElementById(id);
const VIEW_TO_TRACE = { s11db: 'logmag', s21db: 'logmag', swr: 'swr', phase: 'phase', smith: 'smith', waterfall: 'logmag' };

// ---------------------------------------------------------------- state
const state = {
  vna: null, demo: false,
  sweep: null, held: null, overlay: null, history: [], markers: [],
  view: 's11db', continuous: false, busy: false, diag: null,
  lut: buildLut(settings.palette), swrArmed: true,
};
const chart = { dirty: true, hover: null, geom: null };

applyTheme();
const sidebar = initSidebar($('sidebar'));
const con = initConsole({ log: $('log'), form: $('sendForm'), input: $('sendInput'), handle: $('conHandle'), drawer: $('console'), clearBtn: $('conClear'), copyBtn: $('conCopy'), dlBtn: $('conDl'), dlMode: $('conDlMode') }, sendManual);
const cal = initCalibration($('calSection'), () => state.vna, con, {
  // runs before every cal step: the device must be sweeping to measure a standard
  async beforeStep(vna) { if (vna.paused) { await vna.resume(); setFreezeUi(false); con.dim('resumed the device sweep for calibration'); } },
  async currentSweep(vna) { try { const sw = await vna.sweep(); return `${fmtHz(sw.start)} – ${fmtHz(sw.stop)}, ${sw.pts} pts`; } catch { return 'unknown'; } },
  onWedged() {
    con.err('device console stopped responding after save — power-cycle the NanoVNA, then Connect again');
    setStatus('Device not responding after save — power-cycle it and reconnect', 'err');
    stopContinuous(); cw.stop();
    ['singleBtn', 'contBtn', 'diagBtn', 'shotBtn', 'devSweepBtn', 'devDataBtn', 'syncMarkersBtn', 'freezeBtn'].forEach(id => $(id).disabled = true);
    cal.setEnabled(false); tools.setEnabled(false);
  },
});
function setFreezeUi(frozen) { const b = $('freezeBtn'); b.setAttribute('aria-pressed', String(frozen)); b.textContent = frozen ? 'Device frozen — click to resume' : 'Freeze device screen'; b.classList.toggle('running', frozen); }
$('freezeBtn').addEventListener('click', async () => { const v = state.vna; if (!v || state.busy) return; try { if (v.paused) await v.resume(); else await v.pause(); setFreezeUi(v.paused); } catch (e) { con.err(e.message); } });
const recorder = createRecorder();
const cw = initCw($('cwPanel'), () => state.vna, () => settings.z0, con, m => recorder.addCw(m));
const tools = initDeviceTools($('toolsSection'), () => state.vna, con);
initAbout($('about'), $('aboutLink'), [$('plotArea'), $('markersPanel')], { version: APP_VERSION });

// ---------------------------------------------------------------- model / status
function setStatus(text, cls) { $('statusText').textContent = text; $('status').className = 'status ' + (cls || ''); }
function applyModel(key) {
  const m = MODELS[key]; if (!m) return;
  if (state.vna) state.vna.model = key;
  $('ptsMaxLabel').textContent = m.maxPts; $('ptsQuickLabel').textContent = m.quick;
  $('ptsCustom').min = m.minPts; $('ptsCustom').max = m.maxPts; if (+$('ptsCustom').value > m.maxPts) $('ptsCustom').value = m.maxPts;
  $('devRange').textContent = `${fmtHz(m.minHz)} – ${fmtHz(m.maxHz)}, ${m.minPts}–${m.maxPts} pts`;
}
function currentModel() { return state.vna ? state.vna.model : ($('modelSel').value === 'auto' ? DEFAULT_MODEL : $('modelSel').value); }
function setEnabled(on) {
  ['singleBtn', 'contBtn', 'diagBtn', 'shotBtn', 'devSweepBtn', 'devDataBtn', 'sessSave', 'syncMarkersBtn', 'freezeBtn'].forEach(id => $(id).disabled = !on);
  con.setEnabled(on); cal.setEnabled(on); cw.setEnabled(on); tools.setEnabled(on);
  $('demoBtn').disabled = on && !state.demo;
  $('demoBtn').classList.toggle('demo-active', on && state.demo); $('demoBtn').setAttribute('aria-pressed', String(on && state.demo));
  $('demoBtn').textContent = on && state.demo ? 'Demo mode (click to leave)' : 'Try without hardware';
  $('connectBtn').textContent = on ? 'Disconnect' : 'Connect to NanoVNA';
  $('calBadgeTop').hidden = !on;
}
function syncCalBadge() { const b = $('calBadge'); $('calBadgeTop').textContent = b.textContent; $('calBadgeTop').className = b.className; }
new MutationObserver(syncCalBadge).observe($('calBadge'), { childList: true, attributes: true });

// ---------------------------------------------------------------- connect
async function connect(demo) {
  if (state.vna) return;
  const link = demo ? new DemoLink() : new SerialLink();
  link.onTx = cmd => con.tx(cmd);
  link.onRx = (body, meta) => con.reply(body, meta);
  link.onRaw = bytes => { if (settings.rawBytes) con.dim('rx ' + bytes.length + ' B: ' + JSON.stringify(new TextDecoder().decode(bytes)).slice(0, 200)); };
  if (!demo) link.onDrop = e => { con.err('port error: ' + e.message); disconnect(true); };
  const vna = new NanoVNA(link);
  try {
    await link.open();
    if (demo) con.dim('demo NanoVNA-F V3 ready (no hardware)');
    const override = $('modelSel').value === 'auto' ? null : $('modelSel').value;
    await vna.identify(override);
    state.vna = vna; state.demo = demo; cal.reset();
    applyModel(vna.model);
    // Not pausing: the first hardware session showed `scan` works fine while the device sweeps,
    // and a paused device can't measure calibration standards. Freeze is a toggle instead.
    if (settings.brightness < 1) await vna.pwm(settings.brightness).catch(() => {});
    setStatus(`${demo ? 'Demo' : 'Connected'} · ${vna.ident.label} · as ${vna.env.name}`, demo ? 'demo' : 'ok');
    if (vna.deviceSweep) { $('devWas').textContent = `${fmtHz(vna.deviceSweep.start)} – ${fmtHz(vna.deviceSweep.stop)}, ${vna.deviceSweep.pts} pts (restored on disconnect)`; }
    setEnabled(true); chart.dirty = true;
  } catch (e) {
    con.err('connect failed: ' + e.message); setStatus('Connection failed — ' + e.message, 'err');
    try { await link.close(); } catch {}
  }
}
async function disconnect(silent) {
  if (!state.vna) return;
  const vna = state.vna; stopContinuous(); cw.stop();
  try { if (!silent) { await vna.restoreDeviceSweep(); if (vna.paused) await vna.resume(); } } catch {}
  setFreezeUi(false);
  await vna.link.close(); state.vna = null; state.demo = false; $('devWas').textContent = '—';
  setEnabled(false); setStatus('Not connected', ''); chart.dirty = true;
}

// ---------------------------------------------------------------- sweep
function sweepParams() {
  const m = MODELS[currentModel()];
  const mode = document.querySelector('input[name=pts]:checked').value;
  const pts = mode === 'max' ? m.maxPts : mode === 'quick' ? m.quick : Math.round(+$('ptsCustom').value || m.maxPts);
  return { start: parseFloat($('fStart').value) * 1e6, stop: parseFloat($('fStop').value) * 1e6, pts: Math.min(Math.max(pts, m.minPts), m.maxPts) };
}
function acceptSweep(sw) {
  state.sweep = sw; recorder.addSweep(sw);
  $('sweepTime').textContent = `${(sw.ms / 1000).toFixed(2)} s · ${sw.pts} pts`;
  const row = new Float32Array(sw.pts); for (let i = 0; i < sw.pts; i++) row[i] = db(sw.s11[2 * i], sw.s11[2 * i + 1]);
  if (state.history.length && state.history[0].length !== sw.pts) state.history = [];
  state.history.unshift(row); if (state.history.length > WATERFALL_ROWS) state.history.pop();
  ['csvBtn', 's1pBtn', 's2pBtn', 'pngBtn', 'clearBtn', 'minSwrBtn', 'peakBtn', 'clearMarkersBtn'].forEach(id => $(id).disabled = false);
  chart.dirty = true; renderMarkers();
}
async function doSweep() {
  if (!state.vna || state.busy) return null;
  const { start, stop, pts } = sweepParams();
  state.busy = true; $('singleBtn').disabled = true; if (!state.continuous) { $('singleBtn').textContent = 'Sweeping…'; $('singleBtn').classList.add('busy'); }
  try {
    const sw = await state.vna.scan(start, stop, pts, { quiet: state.continuous });
    if (state.continuous) con.dim(`${sw.cmd} → ${sw.pts} pts, ${sw.ms.toFixed(0)} ms`);
    acceptSweep(sw);
    await afterSweep(sw);
    return sw;
  } catch (e) { con.err('sweep failed: ' + e.message); return null; }
  finally { state.busy = false; $('singleBtn').disabled = !state.vna || state.continuous; $('singleBtn').textContent = 'Single sweep'; $('singleBtn').classList.remove('busy'); }
}
async function afterSweep(sw) {
  const vna = state.vna; if (!vna) return;
  if (settings.beepDone) beep(60);
  if (settings.beepSwr) {
    const m = swr(sw.s11[2 * minSwrIndex(sw)], sw.s11[2 * minSwrIndex(sw) + 1]);
    if (m <= settings.swrThreshold && state.swrArmed) { state.swrArmed = false; beep(150); con.dim(`min SWR ${m.toFixed(2)} ≤ ${settings.swrThreshold}`); }
    else if (m > settings.swrThreshold + 0.05) state.swrArmed = true;      // re-arm with a little hysteresis
  }
}
function beep(ms) {
  if (state.vna && !state.demo) state.vna.beepFor(ms).catch(() => {});
  if (settings.beepBrowser) try { const ac = beep.ac || (beep.ac = new (window.AudioContext || window.webkitAudioContext)()); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 1760; g.gain.value = 0.08; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + ms / 1000); } catch {}
}
function stopContinuous() { state.continuous = false; const b = $('contBtn'); b.textContent = 'Continuous'; b.classList.remove('running'); b.setAttribute('aria-pressed', 'false'); $('singleBtn').disabled = !state.vna; }
async function continuousLoop() {
  const b = $('contBtn'); b.textContent = 'Stop'; b.classList.add('running'); b.setAttribute('aria-pressed', 'true'); $('singleBtn').disabled = true;
  while (state.continuous && state.vna) { const s = await doSweep(); await new Promise(r => setTimeout(r, s ? 30 : 500)); }
  stopContinuous();
}
async function useDeviceSweep() {
  if (!state.vna || state.busy) return; state.busy = true;
  try { const s = await state.vna.sweep(); if (Number.isFinite(s.start) && Number.isFinite(s.stop)) { $('fStart').value = (s.start / 1e6).toPrecision(6).replace(/\.?0+$/, ''); $('fStop').value = (s.stop / 1e6).toPrecision(6).replace(/\.?0+$/, ''); if (s.pts) { document.querySelector('input[name=pts][value=custom]').checked = true; $('ptsCustom').value = s.pts; } con.dim(`device sweep: ${fmtHz(s.start)} – ${fmtHz(s.stop)}, ${s.pts || '?'} pts`); } else con.err('could not parse the device sweep reply'); }
  catch (e) { con.err(e.message); } finally { state.busy = false; }
}
async function readDeviceData() {
  if (!state.vna || state.busy) return; state.busy = true;
  try {
    const t0 = performance.now(); const f = await state.vna.frequencies(); const s11 = await state.vna.data(0); const s21 = await state.vna.data(1);
    const pts = Math.min(f.length, s11.length / 2, s21.length / 2);
    if (pts < 2) throw new Error('device returned no sweep data');
    acceptSweep({ pts, start: f[0], stop: f[pts - 1], f: Float64Array.from(f.slice(0, pts)), s11: s11.slice(0, 2 * pts), s21: s21.slice(0, 2 * pts), t: Date.now(), ms: performance.now() - t0, cmd: 'data' });
    con.dim(`read ${pts} points from the device's current sweep`);
  } catch (e) { con.err(e.message); } finally { state.busy = false; }
}

// ---------------------------------------------------------------- chart
const canvas = $('plot'), tip = $('tip');
function renderChart() {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const sw = state.sweep, ov = settings.overlayShow && state.overlay ? state.overlay.sweep : null;
  if (!sw) { ctx.font = '13px ' + cssVar('--font'); ctx.fillStyle = cssVar('--ink-3'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(state.vna ? 'Run a sweep.' : 'Connect a NanoVNA or try the demo.', W / 2, H / 2); chart.geom = null; return; }
  if (state.view === 'smith') chart.geom = renderSmith(ctx, W, H, sw, state.held, state.markers, chart.hover, settings.z0, ov);
  else if (state.view === 'waterfall') chart.geom = renderWaterfall(ctx, W, H, sw, state.history, state.markers, chart.hover, state.lut, settings.wfFloor);
  else chart.geom = renderRect(ctx, W, H, state.view, sw, state.held, state.markers, chart.hover, ov);
}
function tick() { if (chart.dirty && state.view !== 'cw') { chart.dirty = false; renderChart(); } requestAnimationFrame(tick); }
new ResizeObserver(() => chart.dirty = true).observe(canvas);

function pointAt(e) {
  const sw = state.sweep, g = chart.geom; if (!sw || !g) return null;
  const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  if (g.smith) { let b = null, bd = 18 * 18; for (let i = 0; i < sw.pts; i++) { const [x, y] = g.gx(sw.s11[2 * i], sw.s11[2 * i + 1]); const d = (x - mx) ** 2 + (y - my) ** 2; if (d < bd) { bd = d; b = i; } } return b; }
  if (mx < g.pad.l || mx > g.pad.l + g.pw) return null;
  return nearestIndex(sw.f, g.fx(mx));
}
canvas.addEventListener('pointermove', e => {
  const i = pointAt(e); if (i !== chart.hover) { chart.hover = i; chart.dirty = true; }
  if (i == null) { tip.style.display = 'none'; return; }
  const sw = state.sweep, re = sw.s11[2 * i], im = sw.s11[2 * i + 1], g = chart.geom;
  let x, y; if (g.smith) [x, y] = g.gx(re, im); else { x = g.sx(sw.f[i]); y = g.sy(g.yOf(i)); }
  tip.style.display = 'block'; tip.style.left = x + 'px'; tip.style.top = y + 'px';
  tip.textContent = `${fmtHz(sw.f[i])}  ${db(re, im).toFixed(2)} dB  SWR ${swr(re, im).toFixed(2)}  ${fmtZ(gammaToZ(re, im, settings.z0))}`;
});
canvas.addEventListener('pointerleave', () => { chart.hover = null; chart.dirty = true; tip.style.display = 'none'; });
canvas.addEventListener('click', e => { const i = pointAt(e); if (i == null) return; addMarker(state.sweep.f[i]); });

function setView(v) {
  state.view = v;
  document.querySelectorAll('.views button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.view === v)));
  const isCw = v === 'cw'; $('chartWrap').hidden = isCw; $('cwPanel').hidden = !isCw; $('legend').hidden = isCw;
  if (!isCw) cw.stop();
  buildLegend(); chart.dirty = true;
  if (settings.mirrorTrace && state.vna && VIEW_TO_TRACE[v] && !state.busy) state.vna.trace(0, VIEW_TO_TRACE[v]).catch(() => {});
}

// ---------------------------------------------------------------- markers
function addMarker(f) { if (state.markers.length >= settings.maxMarkers) state.markers.shift(); state.markers.push(f); renderMarkers(); chart.dirty = true; }
function renderMarkers() {
  const body = $('markerBody'); body.innerHTML = ''; const sw = state.sweep; if (!sw) { $('markerEmpty').hidden = false; return; }
  state.markers.forEach((mf, k) => {
    const i = nearestIndex(sw.f, mf), re = sw.s11[2 * i], im = sw.s11[2 * i + 1], z = gammaToZ(re, im, settings.z0);
    const tr = document.createElement('tr');
    const devN = state.vna ? (state.vna.env.markers || 4) : 4;
    tr.innerHTML = `<td>${k + 1}${k >= devN ? ' <span class="hint" title="Beyond the device\'s marker count — page only">(page)</span>' : ''}</td><td>${fmtHz(sw.f[i])}</td><td>${db(re, im).toFixed(2)}</td><td>${swr(re, im).toFixed(2)}</td><td>${z.r.toFixed(1)}</td><td>${(z.x >= 0 ? '+' : '−') + Math.abs(z.x).toFixed(1)}</td><td>${db(sw.s21[2 * i], sw.s21[2 * i + 1]).toFixed(2)}</td><td>${phaseDeg(re, im).toFixed(1)}</td><td><button type="button" title="Remove marker" data-k="${k}">×</button></td>`;
    body.appendChild(tr);
  });
  $('markerEmpty').hidden = state.markers.length > 0;
  $('syncMarkersBtn').textContent = `Send first ${state.vna ? (state.vna.env.markers || 4) : 4} to device`;
}
function buildLegend() {
  const v = state.view; let items = [];
  if (v === 's21db') items = [['--s21', '|S21|']];
  else if (v === 'waterfall') items = [['--s11', '|S11| now'], [`background:${cssGradient(settings.palette)}`, `0 dB → ${settings.wfFloor} dB`]];
  else if (v !== 'cw') items = [['--s11', v === 'swr' ? 'SWR from S11' : v === 'phase' ? 'S11 phase' : v === 'smith' ? 'S11 on the Smith chart' : '|S11|']];
  if (state.held && v !== 'waterfall' && v !== 'cw') items.push(['--held', 'held trace']);
  if (state.overlay && settings.overlayShow && v !== 'waterfall' && v !== 'cw') items.push(['--overlay', `overlay: ${state.overlay.name}`]);
  // Built from DOM nodes, not innerHTML: the overlay name is user-supplied (filename or session JSON).
  $('legend').replaceChildren(...items.map(([c, l]) => {
    const span = document.createElement('span'), i = document.createElement('i');
    i.style.cssText = c.startsWith('--') ? 'background:' + cssVar(c) : c;
    span.append(i, l);
    return span;
  }));
}
async function syncMarkersToDevice() {
  const vna = state.vna, sw = state.sweep; if (!vna || !sw || state.busy) return; state.busy = true;
  const st = $('markerStatus'); st.textContent = 'sending…'; st.className = 'hint';
  try {
    const r = await vna.syncMarkers(sw, state.markers);
    if (r.error) { st.textContent = `Stopped after ${r.sent} marker(s): ${r.error}`; st.className = 'hint err'; con.err(r.error); }
    else { st.textContent = `Sent ${r.sent} marker(s) to the device (device sweep set to ${fmtHz(sw.start)} – ${fmtHz(sw.stop)}, ${sw.pts} pts)` + (r.skipped ? `; ${r.skipped} page-only` : ''); con.dim(st.textContent); }
  } finally { state.busy = false; }
}

// ---------------------------------------------------------------- session / overlay
function setOverlay(ov) {
  state.overlay = ov; $('ovlClear').disabled = !ov;
  $('ovlName').textContent = ov ? `Overlay: ${ov.name} — ${ov.sweep.pts} pts, ${fmtHz(ov.sweep.start)} – ${fmtHz(ov.sweep.stop)}${ov.z0 && ov.z0 !== settings.z0 ? ` (file Z₀ ${ov.z0} Ω)` : ''}` : 'No overlay loaded. A loaded file is drawn dotted under the live trace; toggle it in Settings.';
  buildLegend(); chart.dirty = true;
}
async function loadOverlay() {
  const file = await pickFile('.s1p,.s2p,.snp,.txt'); if (!file) return;
  try { setOverlay(parseTouchstone(await file.text(), file.name)); con.dim(`overlay loaded: ${file.name}`); } catch (e) { con.err('overlay: ' + e.message); }
}
async function loadSession() {
  const file = await pickFile('.json'); if (!file) return;
  try {
    const d = parseSession(await file.text());
    if (d.sweep) acceptSweep(d.sweep); state.held = d.held || null; $('holdBtn').setAttribute('aria-pressed', String(!!state.held));
    state.markers = Array.isArray(d.markers) ? d.markers.slice(0, settings.maxMarkers) : [];
    if (d.settings) { Object.assign(settings, sanitizeSettings(d.settings)); saveSettings(); applyTheme(); settingsPanel.refresh(); state.lut = buildLut(settings.palette); }
    setOverlay(d.overlay || null); renderMarkers(); buildLegend(); chart.dirty = true;
    con.dim(`session loaded: ${file.name} (${d.when || 'no date'})`);
  } catch (e) { con.err('session: ' + e.message); }
}

// ---------------------------------------------------------------- manual console
async function sendManual(cmd) {
  if (!state.vna) { con.err('not connected'); return; }
  if (state.busy) { con.err('busy — stop the sweep first'); return; }
  try { await state.vna.raw(cmd); } catch (e) { con.err(e.message); }
}

// ---------------------------------------------------------------- wiring
if (!hasWebSerial()) { $('noSerial').hidden = false; $('connectBtn').disabled = true; }
$('connectBtn').addEventListener('click', () => state.vna ? disconnect() : connect(false));
$('demoBtn').addEventListener('click', () => state.vna ? disconnect() : connect(true));
$('modelSel').addEventListener('change', () => { const v = $('modelSel').value; applyModel(v === 'auto' ? (state.vna ? detectModel(state.vna.ident.version, state.vna.ident.info) : DEFAULT_MODEL) : v); });
$('singleBtn').addEventListener('click', () => doSweep());
$('contBtn').addEventListener('click', () => { if (state.continuous) stopContinuous(); else { state.continuous = true; continuousLoop(); } });
$('devSweepBtn').addEventListener('click', useDeviceSweep);
$('devDataBtn').addEventListener('click', readDeviceData);
document.querySelectorAll('.views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('holdBtn').addEventListener('click', () => { if (state.held) state.held = null; else if (state.sweep) state.held = { ...state.sweep, f: state.sweep.f.slice(), s11: state.sweep.s11.slice(), s21: state.sweep.s21.slice() }; $('holdBtn').setAttribute('aria-pressed', String(!!state.held)); buildLegend(); chart.dirty = true; });
$('clearBtn').addEventListener('click', () => { state.sweep = null; state.held = null; state.history = []; state.markers = []; $('holdBtn').setAttribute('aria-pressed', 'false'); renderMarkers(); buildLegend(); chart.dirty = true; ['csvBtn', 's1pBtn', 's2pBtn', 'pngBtn', 'clearBtn', 'minSwrBtn', 'peakBtn', 'clearMarkersBtn'].forEach(id => $(id).disabled = true); });
$('minSwrBtn').addEventListener('click', () => { if (state.sweep) addMarker(state.sweep.f[minSwrIndex(state.sweep)]); });
$('peakBtn').addEventListener('click', () => { const sw = state.sweep; if (!sw) return; let b = 0, bv = -Infinity; for (let i = 0; i < sw.pts; i++) { const v = db(sw.s11[2 * i], sw.s11[2 * i + 1]); if (v > bv) { bv = v; b = i; } } addMarker(sw.f[b]); });
$('syncMarkersBtn').addEventListener('click', syncMarkersToDevice);
$('clearMarkersBtn').addEventListener('click', () => { state.markers = []; renderMarkers(); chart.dirty = true; });
$('markerBody').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.markers.splice(+b.dataset.k, 1); renderMarkers(); chart.dirty = true; });
$('csvBtn').addEventListener('click', () => download(`nanovna-${stamp()}.csv`, csvBlob(state.sweep, settings.z0)));
$('s1pBtn').addEventListener('click', () => download(`nanovna-${stamp()}.s1p`, touchstoneBlob(state.sweep, settings.z0, 1, `${state.vna?.env.name || ''} — ${state.vna?.ident.label || ''}`)));
$('s2pBtn').addEventListener('click', () => download(`nanovna-${stamp()}.s2p`, touchstoneBlob(state.sweep, settings.z0, 2, `${state.vna?.env.name || ''} — ${state.vna?.ident.label || ''}`)));
$('pngBtn').addEventListener('click', () => canvasPng(canvas, `nanovna-${state.view}-${stamp()}.png`));
$('shotBtn').addEventListener('click', async () => { if (!state.vna || state.busy) return; state.busy = true; try { const img = await state.vna.capture(); rgbaToPngDownload(img, `nanovna-screen-${stamp()}.png`); con.dim(`capture: ${img.width}×${img.height} in ${img.ms.toFixed(0)} ms`); } catch (e) { con.err('screenshot failed: ' + e.message); } finally { state.busy = false; } });
$('diagBtn').addEventListener('click', async () => { if (!state.vna || state.busy) return; state.busy = true; state.diag = null; $('diagBtn').disabled = true; $('diagDlBtn').disabled = true; $('diagOut').hidden = false; $('diagOut').textContent = 'collecting… (each command waits up to 8 s if the device is silent)'; try { state.diag = await collectDiagnostics(state.vna, sweepParams(), t => $('diagOut').textContent = t); } catch (e) { $('diagOut').textContent += '\nfailed: ' + e.message; } finally { state.busy = false; $('diagBtn').disabled = false; $('diagDlBtn').disabled = !state.diag; } });
$('diagDlBtn').addEventListener('click', () => state.diag && download(`nanovna-diag-${stamp()}.json`, new Blob([JSON.stringify(state.diag, null, 2)], { type: 'application/json' })));
$('sessSave').addEventListener('click', () => download(`nanovna-session-${stamp()}.json`, sessionBlob({ sweep: state.sweep, held: state.held, overlay: state.overlay, markers: state.markers, settings, model: state.vna?.model, ident: state.vna?.ident, appVersion: APP_VERSION })));
$('sessLoad').addEventListener('click', loadSession);
$('ovlLoad').addEventListener('click', loadOverlay);
$('ovlClear').addEventListener('click', () => setOverlay(null));
$('ptsCustom').addEventListener('focus', () => { document.querySelector('input[name=pts][value=custom]').checked = true; });
const settingsPanel = initSettingsPanel($('settingsForm'), key => {
  if (key === 'palette') state.lut = buildLut(settings.palette);
  if (key === 'z0') renderMarkers();
  if (key === 'brightness' && state.vna && !state.busy) state.vna.pwm(settings.brightness).catch(e => con.err('pwm: ' + e.message));
  if (key === 'mirrorTrace' && settings.mirrorTrace && state.vna && VIEW_TO_TRACE[state.view]) state.vna.trace(0, VIEW_TO_TRACE[state.view]).catch(() => {});
  buildLegend(); chart.dirty = true;
});
window.addEventListener('beforeunload', () => { if (state.vna && !state.demo) state.vna.link.writeSync('resume\r\n'); });
if (hasWebSerial()) navigator.serial.addEventListener('disconnect', () => { if (state.vna && !state.demo) disconnect(true); });

// ---------------------------------------------------------------- recording
function refreshRec() {
  const n = recorder.sweeps.length, c = recorder.cw.length, any = n + c > 0;
  $('recSweeps').textContent = n; $('recCw').textContent = c; $('recSize').textContent = (recorder.bytes() / 1024).toFixed(0) + ' kB';
  $('recBtn').textContent = recorder.on ? 'Stop recording' : 'Start recording'; $('recBtn').classList.toggle('running', recorder.on); $('recBtn').setAttribute('aria-pressed', String(recorder.on));
  $('recBadge').hidden = !recorder.on; $('recBadge').textContent = `● REC ${n + c}`;
  $('recWfBtn').disabled = $('recWf21Btn').disabled = $('recSweepsBtn').disabled = !n; $('recCwBtn').disabled = !c; $('recJsonBtn').disabled = $('recClearBtn').disabled = !any;
}
recorder.onChange = refreshRec;
$('recBtn').addEventListener('click', () => { if (recorder.on) recorder.stop(); else { recorder.start(); con.dim('recording started'); } });
$('recWfBtn').addEventListener('click', () => download(`nanovna-waterfall-s11-${stamp()}.csv`, recorder.waterfallCsv('s11')));
$('recWf21Btn').addEventListener('click', () => download(`nanovna-waterfall-s21-${stamp()}.csv`, recorder.waterfallCsv('s21')));
$('recSweepsBtn').addEventListener('click', () => download(`nanovna-sweeps-${stamp()}.csv`, recorder.sweepsCsv(settings.z0)));
$('recCwBtn').addEventListener('click', () => download(`nanovna-cw-${stamp()}.csv`, recorder.cwCsv(settings.z0)));
$('recJsonBtn').addEventListener('click', () => download(`nanovna-recording-${stamp()}.json`, recorder.jsonBlob({ version: APP_VERSION, model: state.vna?.model, ident: state.vna?.ident, z0: settings.z0 })));
$('recClearBtn').addEventListener('click', () => { if (confirm('Discard the recording?')) recorder.clear(); });
window.addEventListener('beforeunload', e => { if (recorder.on && recorder.sweeps.length + recorder.cw.length) { e.preventDefault(); e.returnValue = ''; } });
refreshRec();

$('appVersion').textContent = 'v' + APP_VERSION;
applyModel(DEFAULT_MODEL); setView('s11db'); renderMarkers(); setOverlay(null); tick();
