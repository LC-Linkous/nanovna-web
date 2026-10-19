// diagnostics.js — collect raw replies + timings for a fixed command set.
// SPDX-License-Identifier: GPL-2.0-only
import { NanoVNA } from '../device/nanovna.js';
import { detectModel } from '../device/models.js';

export const DIAG_COMMANDS = ['version', 'info', 'SN', 'help', 'sweep', 'frequencies',
  'scan 1000000 100000000 11 7', 'scan 1000000 100000000 11 3', 'data 0', 'data 1', 'pause', 'resume'];

/** Runs the diagnostic set. onProgress(text) gets a running summary. Returns the report object. */
export async function collectDiagnostics(vna, sweepParams, onProgress) {
  const link = vna.link;
  const d = {
    tool: 'nanovna-web', version: '0.5.0', when: new Date().toISOString(), userAgent: navigator.userAgent,
    port: link.info(), modelSelected: vna.model, modelDetected: detectModel(vna.ident.version, vna.ident.info), ident: vna.ident, commands: [],
  };
  const summary = () => d.commands.map(r => `${r.cmd}\n    ${r.error ? 'ERROR ' + r.error : `${Math.round(r.ms)} ms, ${r.lines ?? 0} lines, ${r.promptCount}×ch>${r.parsedOk != null ? (r.parsedOk ? ', parsed OK' : ', PARSE FAILED') : ''}`}`).join('\n');
  for (const cmd of DIAG_COMMANDS) {
    const rec = { cmd }; const t0 = performance.now();
    try {
      const r = await link.command(cmd, { timeoutMs: 8000 });
      rec.ms = +r.ms.toFixed(1); rec.rawLength = r.raw.length;
      rec.raw = r.raw.length > 6000 ? r.raw.slice(0, 3000) + '\n…[truncated]…\n' + r.raw.slice(-2000) : r.raw;
      rec.lines = r.body.split('\n').filter(Boolean).length; rec.promptCount = (r.raw.match(/ch>/g) || []).length;
    } catch (e) { rec.error = e.message; rec.ms = +(performance.now() - t0).toFixed(1); }
    d.commands.push(rec); onProgress(summary());
  }
  const { start, stop, pts } = sweepParams;
  const rec = { cmd: `scan ${start} ${stop} ${pts} 7` };
  try {
    const r = await link.command(rec.cmd, { timeoutMs: 20000 });
    rec.ms = +r.ms.toFixed(1); rec.lines = r.body.split('\n').filter(Boolean).length; rec.promptCount = (r.raw.match(/ch>/g) || []).length;
    rec.parsedOk = !!NanoVNA.parseScan(r.body, pts); rec.firstLines = r.body.split('\n').slice(0, 5); rec.lastLines = r.body.split('\n').slice(-3);
  } catch (e) { rec.error = e.message; }
  d.commands.push(rec);
  onProgress(summary() + '\n\nDone. Download the JSON and attach it to an issue.');
  return d;
}
