// demo-link.js — a simulated NanoVNA-F V3 console.
// SPDX-License-Identifier: GPL-2.0-only
//
// Produces the same byte stream a real device does (echo, body, doubled
// prompt, chunked delivery) so ShellLink's parser is exercised, not bypassed.
// If a real device does something odd, teach this class to do it too.
import { ShellLink } from './shell-link.js';

export class DemoLink extends ShellLink {
  constructor() {
    super();
    this.sweepStart = 2.2e9; this.sweepStop = 2.6e9; this.sweepPts = 801;   // same as the real unit was found on
    this.f0 = 433e6;            // first resonance of the simulated antenna
    this.paused = false;
    this.calOn = false; this.edelayVal = '0'; this.beepOn = false; this.pwmVal = '1.00';
    this.markers = {}; this.traces = {};
  }
  async open() {}
  info() { return 'demo'; }
  async close() { this.closed = true; }

  _reply(cmd, body, delay) {
    const bytes = this.enc.encode(cmd + '\r\n' + (body ? body + '\r\n' : '') + 'ch> \r\nch> ');
    let i = 0;
    const step = () => { if (this.closed || i >= bytes.length) return; this._feed(bytes.slice(i, i + 512)); i += 512; setTimeout(step, 2); };
    setTimeout(step, delay);
  }

  // Dipole-ish S11: two series resonances, plus a little series inductance.
  s11(f) {
    const Z0 = 50; let R = 20, X = 0;
    for (const [f0, Rr, Q] of [[this.f0, 73, 12], [this.f0 * 2.95, 95, 9]]) {
      const d = f / f0 - f0 / f;
      const w = 1 / (1 + Math.pow(Math.abs(d) * Q, 2));
      R += (Rr - 20) * w; X += Rr * Q * d * w * 1.4;
    }
    X += 2 * Math.PI * f * 12e-9;
    const nre = R - Z0, nim = X, dre = R + Z0, dim = X, d2 = dre * dre + dim * dim;
    const n = () => (Math.random() - 0.5) * 0.004;
    return [(nre * dre + nim * dim) / d2 + n(), (nim * dre - nre * dim) / d2 + n()];
  }
  // Bandpass S21 centred at 868 MHz.
  s21(f) {
    const fc = 868e6, bw = 60e6, x = (f - fc) / (bw / 2);
    const mag = Math.pow(10, (-1.2 - 30 * Math.log10(1 + x * x)) / 20);
    const ph = -2 * Math.PI * f * 2.5e-9 - Math.atan(x);
    const n = () => (Math.random() - 0.5) * 0.002;
    return [mag * Math.cos(ph) + n(), mag * Math.sin(ph) + n()];
  }

  _write(s) {
    const cmd = s.trim(); const [c, ...a] = cmd.split(/\s+/); const lc = (c || '').toLowerCase();
    let body = '', delay = 8;
    switch (lc) {
      case 'version': body = '0.5.8'; break;                                   // the real F V3 answers with the bare version
      case 'info': body = 'Model:        NanoVNA-F_V3 (demo)\nFrequency:    50k ~ 6.3GHz\nBuild time:   demo'; break;
      case 'sn': body = 'DEMO000000000000'; break;
      case 'help': body = 'There are all commands\nhelp:                lists all the registered commands\ncwfreq:              usage: cwfreq {frequency(Hz)}\ndata:                usage: data [array]\nfrequencies:         usage: frequencies\nscan:                usage: scan {start(Hz)} {stop(Hz)} [points] [outmask]\nsweep:               usage: sweep [start(Hz)] [stop(Hz)] [points]\ntouchcal:            usage: touchcal\ntouchtest:           usage: touchtest\npause:               usage: pause\nresume:              usage: resume\ncal:                 usage: cal [load|open|short|thru|done|reset|on|off]\nsave:                usage: save {id}\nrecall:              usage: recall {id}\ntrace:               usage: trace [0|1|2|3|all] [{format}|scale|refpos|channel|off] [{value}]\nmarker:              usage: marker [1|2|3|4] [on|off|{index}]\nedelay:              usage: edelay {value}\npwm:                 usage: pwm {0.0-1.0}\nbeep:                usage: beep on/off\ncapture:             usage: capture\nversion:             usage: Show NanoVNA version\ninfo:                usage: NanoVNA-F V3 info\nSN:                  usage: NanoVNA-F V3 Serial Numbel\nresolution:          usage: LCD resolution'; break;
      case 'pause': this.paused = true; break;
      case 'resume': this.paused = false; break;
      case 'cal': { const a0 = (a[0] || '').toLowerCase(); if (this.paused && ['open','short','load','thru'].includes(a0)) { body = 'cal: sweep is paused'; break; } if (a0 === 'on') this.calOn = true; else if (a0 === 'off' || a0 === 'reset') this.calOn = false; else if (!a0) body = `cal: ${this.calOn ? 'on' : 'off'}`; delay = ['open', 'short', 'load', 'thru', 'done'].includes(a0) ? 400 : 8; break; }
      case 'save': { const bytes = this.enc.encode(cmd + '\r\n'); setTimeout(() => this._feed(bytes), 8); return Promise.resolve(); }   // echo only, no prompt (F V2 quirk)
      case 'recall': break;
      case 'edelay': if (a.length) this.edelayVal = a[0]; else body = this.edelayVal; break;
      case 'cwfreq': if (!a.length || !Number.isFinite(+a[0])) body = 'usage: cwfreq {frequency(Hz)}'; break;
      case 'beep': this.beepOn = (a[0] || '').toLowerCase() === 'on'; break;
      case 'pwm': this.pwmVal = a[0] || this.pwmVal; break;
      case 'resolution': body = '800,480'; break;
      case 'touchcal': body = 'touch calibration: tap the targets on the device screen (simulated)'; delay = 600; break;
      case 'touchtest': body = 'touch test running (simulated)'; delay = 600; break;
      case 'marker': {
        if (a.length >= 2) { const id = +a[0], v = a[1]; if (!(id >= 1 && id <= 4)) body = 'marker: invalid marker id (1-4)'; else if (v !== 'off' && !(+v >= 0 && +v < this.sweepPts)) body = `marker: index out of range (0-${this.sweepPts - 1})`; else this.markers[id] = v; }
        else body = Object.entries(this.markers).map(([k, v]) => `${k} ${v}`).join('\n');
        break; }
      case 'trace': {
        const fmts = ['off', 'logmag', 'linear', 'phase', 'smith', 'swr', 'polar', 'delay', 'refpos', 'channel'];
        if (a.length >= 2) { if (!fmts.includes(a[1].toLowerCase())) body = `usage: trace {id} {${fmts.join('|')}}`; else this.traces[a[0]] = a[1]; }
        else body = Object.entries(this.traces).map(([k, v]) => `${k} ${v}`).join('\n');
        break; }
      case 'sweep':
        if (a.length >= 2) { this.sweepStart = +a[0]; this.sweepStop = +a[1]; if (a[2]) this.sweepPts = +a[2]; }
        else body = `${this.sweepStart} ${this.sweepStop} ${this.sweepPts}`;
        break;
      case 'frequencies': {
        const L = []; for (let i = 0; i < this.sweepPts; i++) L.push(Math.round(this.sweepStart + (this.sweepStop - this.sweepStart) * i / (this.sweepPts - 1)));
        body = L.join('\n'); break; }
      case 'data': {
        const ch = +(a[0] || 0); const L = [];
        for (let i = 0; i < this.sweepPts; i++) { const f = this.sweepStart + (this.sweepStop - this.sweepStart) * i / (this.sweepPts - 1); const v = ch === 1 ? this.s21(f) : this.s11(f); L.push(v[0].toFixed(6) + ' ' + v[1].toFixed(6)); }
        body = L.join('\n'); break; }
      case 'scan': {
        const st = +a[0], sp = +a[1], pts = +(a[2] || this.sweepPts), mask = +(a[3] || 0);
        if (!(st < sp)) { body = 'scan: start must be < stop'; break; }
        this.sweepStart = st; this.sweepStop = sp; this.sweepPts = pts;   // real firmware: scan replaces the device sweep
        const L = [];
        for (let i = 0; i < pts; i++) {
          const f = st + (sp - st) * i / (pts - 1); const p = [];
          if (mask & 1) p.push(Math.round(f));
          if (mask & 2) { const v = this.s11(f); p.push(v[0].toFixed(6), v[1].toFixed(6)); }
          if (mask & 4) { const v = this.s21(f); p.push(v[0].toFixed(6), v[1].toFixed(6)); }
          if (p.length) L.push(p.join(' ') + ' ');
        }
        body = L.join('\n'); delay = 300 + pts * 5.5; break; }   // measured on an F V3: ~5.5 ms per point
      case 'capture': {
        // synthetic 800x480 RGB565 frame: dark gradient with a yellow |S11| trace
        const W = 800, H = 480, buf = new Uint8Array(W * H * 2);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 2;
          const g = this.s11(50e3 + (6e9 - 50e3) * x / W); const db = 20 * Math.log10(Math.hypot(g[0], g[1]) + 1e-9);
          const ty = Math.round(H * 0.15 + (-db / 60) * H * 0.7), on = Math.abs(y - ty) < 2;
          const r = on ? 31 : 2, gg = on ? 63 : (y >> 4), b = on ? 10 : 8;
          const v = (r << 11) | (gg << 5) | b; buf[i] = v & 255; buf[i + 1] = v >> 8;
        }
        const head = this.enc.encode(cmd + '\r\n'), tail = this.enc.encode('ch> \r\nch> ');
        const all = new Uint8Array(head.length + buf.length + tail.length); all.set(head); all.set(buf, head.length); all.set(tail, head.length + buf.length);
        let i = 0; const step = () => { if (this.closed || i >= all.length) return; this._feed(all.slice(i, i + 8192)); i += 8192; setTimeout(step, 1); };
        setTimeout(step, 20); return Promise.resolve(); }
      default: body = `${c}?`; break;
    }
    this._reply(cmd, body, delay);
    return Promise.resolve();
  }
}
