// clip.js — replay a recording through the windows, and save what the windows
// show as a WebM clip (live, or a recording played back at a chosen speed).
// Shared between nanovna-web and tinysa-web: the page supplies the frame
// source (how many frames, when each happened, how to show one) and this
// module owns the playback loop, the compositing and the encoder.
// SPDX-License-Identifier: GPL-2.0-only
//
// Encoding is the browser's own MediaRecorder on a canvas stream: no library,
// full colour, a tenth the size of a GIF. Frames are pushed explicitly
// (captureStream(0) + requestFrame), one per rendered sweep, so a clip has
// exactly the frames the windows drew. A recording is played back in real
// time × speed while it is encoded (MediaRecorder cannot run faster than the
// clock), so a 60 s recording at 4× takes 15 s to export.

const SPEEDS = [0.5, 1, 2, 4, 8];

/**
 * createClip(ui, source)
 *   ui:     { root, slider, playBtn, speedSel, posLabel, exportBtn, liveBtn, stampChk, status }  (elements)
 *   source: {
 *     name:       'tinysa' | 'nanovna'      — file name prefix
 *     panesEl:    the .panes container (what gets composited)
 *     getPanes:   () => [{ canvas, view }]  — the live pane canvases
 *     count:      () => number              — frames in the recording
 *     timeAt:     i => ms                   — when frame i was taken
 *     show:       i => void                 — put frame i in the windows and render them NOW (synchronously)
 *     exit:       () => void                — leave replay: restore the live display
 *     stamp:      i|null => string          — caption text (null = live)
 *     download:   (name, blob) => void
 *     log:        text => void
 *   }
 * Returns { onFrame(), get replaying, get busy, refresh() }. Call onFrame()
 * after every live render; it feeds a live clip when one is being recorded.
 */
export function createClip(ui, source) {
  const st = { replaying: false, index: 0, playing: false, speed: 1, timer: null, rec: null, live: false, stamp: true, busy: false, frames: 0 };
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const say = (t, err) => { if (ui.status) { ui.status.textContent = t; ui.status.className = 'hint' + (err ? ' err' : ''); } };

  // ---- compositing: the pane canvases as laid out, plus a caption bar -------------
  function composite(caption) {
    const panes = source.getPanes().filter(p => p.canvas && p.canvas.width && p.canvas.clientWidth);
    const host = source.panesEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1, bar = st.stamp && caption ? 26 : 0;
    const W = Math.round(host.width), H = Math.round(host.height);
    if (!W || !H) return false;
    if (canvas.width !== W * dpr || canvas.height !== (H + bar) * dpr) { canvas.width = W * dpr; canvas.height = (H + bar) * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#111'; ctx.fillRect(0, 0, W, H + bar);
    for (const p of panes) {
      const r = p.canvas.getBoundingClientRect();
      ctx.drawImage(p.canvas, r.left - host.left, r.top - host.top, r.width, r.height);
    }
    if (bar) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H, W, bar);
      ctx.fillStyle = '#eee'; ctx.font = '12px ' + (getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(caption, 10, H + bar / 2);
    }
    return true;
  }

  // ---- encoder -------------------------------------------------------------------
  function startEncoder() {
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('this browser cannot record a canvas (MediaRecorder); Chrome or Edge can');
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 6e6 });
    const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise(res => { rec.onstop = () => res(new Blob(chunks, { type: 'video/webm' })); });
    rec.start(250);
    st.frames = 0;
    return { push(caption) { if (composite(caption)) { track.requestFrame?.(); st.frames++; } }, async stop() { this.push(null); await new Promise(r => setTimeout(r, 120)); rec.stop(); track.stop(); return done; } };
  }
  const fileName = () => `${source.name}-clip-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.webm`;

  // ---- replay ---------------------------------------------------------------------
  function showIndex(i) {
    const n = source.count(); if (!n) return;
    st.index = Math.max(0, Math.min(n - 1, i));
    st.replaying = true;
    source.show(st.index);
    if (ui.slider) ui.slider.value = st.index;
    if (ui.posLabel) ui.posLabel.textContent = `${st.index + 1} / ${n} · ${new Date(source.timeAt(st.index)).toLocaleTimeString()}`;
  }
  function stopPlaying() { st.playing = false; if (st.timer) clearTimeout(st.timer); st.timer = null; if (ui.playBtn) { ui.playBtn.textContent = 'Play'; ui.playBtn.setAttribute('aria-pressed', 'false'); } }
  function play(onFrame, onEnd) {
    stopPlaying(); st.playing = true;
    if (ui.playBtn) { ui.playBtn.textContent = 'Pause'; ui.playBtn.setAttribute('aria-pressed', 'true'); }
    const n = source.count(); if (st.index >= n - 1) st.index = 0;
    const step = () => {
      if (!st.playing) return;
      showIndex(st.index); onFrame?.(st.index);
      if (st.index >= n - 1) { stopPlaying(); onEnd?.(); return; }
      const dt = Math.max(20, Math.min(5000, (source.timeAt(st.index + 1) - source.timeAt(st.index)) / st.speed));
      st.index++; st.timer = setTimeout(step, dt);
    };
    step();
  }
  function exitReplay() { stopPlaying(); if (!st.replaying) return; st.replaying = false; source.exit(); if (ui.posLabel) ui.posLabel.textContent = 'live'; }

  // ---- export a recording as a clip ----------------------------------------------------
  async function exportRecording() {
    const n = source.count(); if (!n) { say('nothing recorded yet', true); return; }
    if (st.busy) return; st.busy = true; setEnabled();
    try {
      const enc = startEncoder();
      say(`encoding ${n} frames at ${st.speed}× …`);
      await new Promise(res => { st.index = 0; play(i => { enc.push(source.stamp(i)); say(`encoding ${i + 1} / ${n} at ${st.speed}× …`); }, res); });
      const blob = await enc.stop();
      source.download(fileName(), blob);
      say(`saved ${st.frames} frames, ${(blob.size / 1024).toFixed(0)} kB`); source.log?.(`clip: ${st.frames} frames, ${(blob.size / 1024).toFixed(0)} kB`);
    } catch (e) { say('clip failed: ' + e.message, true); }
    finally { st.busy = false; setEnabled(); }
  }

  // ---- live clip: record the windows while sweeping --------------------------------------
  async function toggleLive() {
    if (st.live) {
      const enc = st.rec; st.rec = null; st.live = false; setEnabled();
      try { const blob = await enc.stop(); source.download(fileName(), blob); say(`saved ${st.frames} frames, ${(blob.size / 1024).toFixed(0)} kB`); }
      catch (e) { say('clip failed: ' + e.message, true); }
      return;
    }
    try { exitReplay(); st.rec = startEncoder(); st.live = true; st.rec.push(source.stamp(null)); say('recording the windows: every rendered sweep is a frame'); }
    catch (e) { say(e.message, true); }
    setEnabled();
  }
  /** main.js calls this after every live render. */
  function onFrame() { if (st.live && st.rec && !st.replaying) st.rec.push(source.stamp(null)); }

  function setEnabled() {
    const n = source.count(), has = n > 0;
    if (ui.slider) { ui.slider.max = Math.max(0, n - 1); ui.slider.disabled = !has || st.busy; }
    if (ui.playBtn) ui.playBtn.disabled = !has || st.busy;
    if (ui.exportBtn) ui.exportBtn.disabled = !has || st.busy || st.live;
    if (ui.liveBtn) { ui.liveBtn.disabled = st.busy; ui.liveBtn.textContent = st.live ? 'Stop clip' : 'Record clip of the windows'; ui.liveBtn.classList.toggle('running', st.live); ui.liveBtn.setAttribute('aria-pressed', String(st.live)); }
    if (ui.exitBtn) ui.exitBtn.disabled = !st.replaying || st.busy;
  }

  // ---- wiring -------------------------------------------------------------------------
  if (ui.slider) ui.slider.addEventListener('input', () => { stopPlaying(); showIndex(+ui.slider.value); setEnabled(); });
  if (ui.playBtn) ui.playBtn.addEventListener('click', () => { if (st.playing) stopPlaying(); else play(); setEnabled(); });
  if (ui.exitBtn) ui.exitBtn.addEventListener('click', () => { exitReplay(); setEnabled(); });
  if (ui.speedSel) { ui.speedSel.innerHTML = SPEEDS.map(s => `<option value="${s}"${s === 1 ? ' selected' : ''}>${s}×</option>`).join(''); ui.speedSel.addEventListener('change', () => { st.speed = +ui.speedSel.value; }); }
  if (ui.stampChk) { ui.stampChk.checked = true; ui.stampChk.addEventListener('change', () => { st.stamp = ui.stampChk.checked; }); }
  if (ui.exportBtn) ui.exportBtn.addEventListener('click', exportRecording);
  if (ui.liveBtn) ui.liveBtn.addEventListener('click', toggleLive);
  setEnabled();
  return { onFrame, get replaying() { return st.replaying; }, get busy() { return st.busy || st.live; }, refresh: setEnabled, exitReplay };
}
