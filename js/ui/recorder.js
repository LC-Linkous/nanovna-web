// recorder.js — timestamped logging of sweeps and CW readings, with CSV export.
// Mirrors nvnapython's plotting_waterfall_static.py (collect N scans → CSV).
// SPDX-License-Identifier: GPL-2.0-only
import { db, phaseDeg, swr, gammaToZ } from '../rf.js';

const iso = t => new Date(t).toISOString();

export function createRecorder() {
  const rec = { on: false, sweeps: [], cw: [], startedAt: null, onChange: null };

  rec.start = () => { rec.on = true; rec.startedAt = Date.now(); rec.onChange?.(); };
  rec.stop = () => { rec.on = false; rec.onChange?.(); };
  rec.clear = () => { rec.sweeps = []; rec.cw = []; rec.startedAt = null; rec.onChange?.(); };

  /** Call with every accepted sweep. Stores a copy (typed arrays are cheap to slice). */
  rec.addSweep = sw => { if (!rec.on) return; rec.sweeps.push({ t: sw.t || Date.now(), start: sw.start, stop: sw.stop, pts: sw.pts, f: sw.f.slice(), s11: sw.s11.slice(), s21: sw.s21.slice() }); rec.onChange?.(); };
  /** Call with every CW reading: { t, f, s11:[re,im], s21:[re,im] }. */
  rec.addCw = m => { if (!rec.on) return; rec.cw.push({ t: m.t || Date.now(), f: m.f, s11: m.s11.slice(), s21: m.s21.slice() }); rec.onChange?.(); };

  /** Rough memory estimate for the status line. */
  rec.bytes = () => rec.sweeps.reduce((a, s) => a + s.pts * 5 * 8, 0) + rec.cw.length * 6 * 8;

  // ---- exports ---------------------------------------------------------------
  /** Long format: one row per (sweep, point). Easy to load in pandas / Excel. */
  rec.sweepsCsv = z0 => {
    const rows = ['timestamp_iso,sweep_index,sweep_t_ms,freq_hz,s11_re,s11_im,s11_db,s11_phase_deg,swr,r_ohm,x_ohm,s21_re,s21_im,s21_db'];
    rec.sweeps.forEach((s, k) => {
      const ts = iso(s.t);
      for (let i = 0; i < s.pts; i++) {
        const a = s.s11[2 * i], b = s.s11[2 * i + 1], c = s.s21[2 * i], d = s.s21[2 * i + 1], z = gammaToZ(a, b, z0);
        rows.push(`${ts},${k},${s.t},${s.f[i]},${a.toFixed(6)},${b.toFixed(6)},${db(a, b).toFixed(3)},${phaseDeg(a, b).toFixed(3)},${swr(a, b).toFixed(4)},${z.r.toFixed(3)},${z.x.toFixed(3)},${c.toFixed(6)},${d.toFixed(6)},${db(c, d).toFixed(3)}`);
      }
    });
    return new Blob([rows.join('\n') + '\n'], { type: 'text/csv' });
  };

  /**
   * Waterfall matrix: one row per sweep, one column per frequency, |S11| in dB.
   * Only sweeps with the same frequency grid as the first are included (the
   * others are reported in the first comment line), so the matrix is rectangular.
   */
  rec.waterfallCsv = (which = 's11') => {
    if (!rec.sweeps.length) return new Blob([''], { type: 'text/csv' });
    const ref = rec.sweeps[0];
    const same = s => s.pts === ref.pts && s.start === ref.start && s.stop === ref.stop;
    const kept = rec.sweeps.filter(same), skipped = rec.sweeps.length - kept.length;
    const rows = [`# nanoVNA Web waterfall: |${which.toUpperCase()}| dB, ${kept.length} sweeps, ${ref.pts} points, ${ref.start} – ${ref.stop} Hz${skipped ? `; ${skipped} sweep(s) with a different grid omitted` : ''}`];
    rows.push('timestamp_iso,sweep_t_ms,' + Array.from(ref.f, f => f).join(','));
    for (const s of kept) {
      const arr = which === 's21' ? s.s21 : s.s11; const vals = new Array(s.pts);
      for (let i = 0; i < s.pts; i++) vals[i] = db(arr[2 * i], arr[2 * i + 1]).toFixed(2);
      rows.push(`${iso(s.t)},${s.t},${vals.join(',')}`);
    }
    return new Blob([rows.join('\n') + '\n'], { type: 'text/csv' });
  };

  /** CW readings: one row per reading. */
  rec.cwCsv = z0 => {
    const rows = ['timestamp_iso,t_ms,freq_hz,s11_re,s11_im,s11_db,s11_phase_deg,swr,r_ohm,x_ohm,s21_re,s21_im,s21_db'];
    for (const m of rec.cw) {
      const [a, b] = m.s11, [c, d] = m.s21, z = gammaToZ(a, b, z0);
      rows.push(`${iso(m.t)},${m.t},${m.f},${a.toFixed(6)},${b.toFixed(6)},${db(a, b).toFixed(3)},${phaseDeg(a, b).toFixed(3)},${swr(a, b).toFixed(4)},${z.r.toFixed(3)},${z.x.toFixed(3)},${c.toFixed(6)},${d.toFixed(6)},${db(c, d).toFixed(3)}`);
    }
    return new Blob([rows.join('\n') + '\n'], { type: 'text/csv' });
  };

  /** Everything, as JSON (sweeps as plain arrays). */
  /** Load a recording JSON made by jsonBlob() (sweeps become typed arrays). Returns the sweep count. */
  rec.loadJson = obj => {
    if (!obj || obj.kind !== 'recording' || !Array.isArray(obj.sweeps)) throw new Error('not a nanoVNA Web recording');
    rec.sweeps = obj.sweeps.map(s => ({ t: +s.t || 0, start: +s.start, stop: +s.stop, pts: +s.pts, f: Float64Array.from(s.f), s11: Float32Array.from(s.s11), s21: Float32Array.from(s.s21) }));
    rec.cw = Array.isArray(obj.cw) ? obj.cw : [];
    rec.startedAt = obj.startedAt ? Date.parse(obj.startedAt) : rec.sweeps[0]?.t || null;
    rec.onChange?.(); return rec.sweeps.length;
  };

  rec.jsonBlob = meta => new Blob([JSON.stringify({ tool: 'nanovna-web', kind: 'recording', ...meta, startedAt: rec.startedAt && iso(rec.startedAt), sweeps: rec.sweeps.map(s => ({ ...s, f: Array.from(s.f), s11: Array.from(s.s11), s21: Array.from(s.s21) })), cw: rec.cw })], { type: 'application/json' });

  return rec;
}
