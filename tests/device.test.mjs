// Device-layer tests: NanoVNA over the DemoLink, which produces the real byte
// stream (echo, body, prompt, chunked). Run with:  node --test 'tests/**/*.test.mjs'
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoLink } from '../js/device/demo-link.js';
import { NanoVNA, looksLikeError } from '../js/device/nanovna.js';
import { ShellLink } from '../js/device/shell-link.js';
import { detectModel, MODELS } from '../js/device/models.js';

async function connected() { const vna = new NanoVNA(new DemoLink()); await vna.identify(); return vna; }

test('identify: model from info, cwfreq unit from help, device sweep remembered', async () => {
  const vna = await connected();
  assert.equal(vna.model, 'NANOVNA_F_V3');
  assert.equal(vna.ident.modelName, 'NanoVNA-F_V3');
  assert.equal(vna.cwUnit, 1);                                   // F V3: cwfreq takes Hz
  assert.ok(vna.deviceSweep && vna.deviceSweep.pts > 0);
});

test('detectModel on captured strings', () => {
  assert.equal(detectModel('0.5.8', 'Model:        NanoVNA-F_V3'), 'NANOVNA_F_V3');
  assert.equal(detectModel('NanoVNA-F_V2 v2.1', ''), 'NANOVNA_F_V2');
  assert.equal(detectModel('ch> NanoVNA-H4 1.2.0', ''), 'NANOVNA_H4');
  assert.equal(detectModel('tinySA4_v1.4-252', 'tinySA ULTRA'), 'NANOVNA_GENERIC');
  for (const m of Object.values(MODELS)) assert.ok(m.minPts <= m.quick && m.quick <= m.maxPts, m.name);
});

test('scan returns pts points of S11/S21 and clips to the envelope', async () => {
  const vna = await connected();
  const sw = await vna.scan(50e6, 1e9, 101);
  assert.equal(sw.pts, 101); assert.equal(sw.f.length, 101); assert.equal(sw.s11.length, 202); assert.equal(sw.s21.length, 202);
  assert.ok(sw.f[0] === 50e6 && sw.f[100] === 1e9);
  const big = await vna.scan(50e6, 1e9, 5000);
  assert.equal(big.pts, MODELS.NANOVNA_F_V3.maxPts);
});

test('frequencies and data read back the device trace', async () => {
  const vna = await connected();
  await vna.sweep(100e6, 200e6, 51);
  const f = await vna.frequencies(), d = await vna.data(0);
  assert.equal(f.length, 51); assert.equal(f[0], 100e6); assert.equal(f[50], 200e6);
  assert.equal(d.length, 102);
});

test('a rejected argument throws (usage line); a bare query does not', async () => {
  const vna = await connected();
  await assert.rejects(vna.cwfreq(NaN), /cwfreq/);
  assert.ok(looksLikeError('usage: cwfreq {frequency(Hz)}'));
  assert.ok(!looksLikeError(''));
  assert.equal(typeof await vna.edelay(), 'string');             // bare edelay = query
});

test('pause / resume track the device state; the device says so when cal runs paused', async () => {
  const vna = await connected();
  await vna.pause(); assert.equal(vna.paused, true);
  const r = await vna.cal('open');                               // the page's calibration step resumes first; the raw reply tells why
  assert.match(r.body, /paused/);
  await vna.resume(); assert.equal(vna.paused, false);
  assert.equal((await vna.cal('open')).body, '');
});

test('save: no prompt on the F V2 path, console probed afterwards', async () => {
  const vna = await connected();
  const r = await vna.save(0);
  assert.deepEqual(r, { alive: true });
  assert.equal(vna.wedged, false);
});

test('measureAt averages an 11-point scan at the frequency', async () => {
  const vna = await connected();
  const m = await vna.measureAt(433e6);
  assert.equal(m.f, 433e6); assert.equal(m.s11.length, 2); assert.equal(m.s21.length, 2);
  assert.ok(Math.hypot(m.s11[0], m.s11[1]) <= 1.0001);
});

test('capture reads W*H*2 bytes and decodes RGB565', async () => {
  const vna = await connected();
  const img = await vna.capture();
  assert.equal(img.width, 800); assert.equal(img.height, 480);
  assert.equal(img.rgba.length, 800 * 480 * 4);
});

// ---- shell-link.js: the file shared with tinysa-web -------------------------------------

class ScriptedLink extends ShellLink {
  constructor() { super(); this.sent = []; this.replies = []; }
  _write(s) { this.sent.push(s.trim()); const r = this.replies.shift() || []; let d = 2; for (const piece of r) { setTimeout(() => this._feed(this.enc.encode(piece)), d); d += 3; } return Promise.resolve(); }
}

test('shell-link: commands are serialised, so a poll cannot interleave with a sweep', async () => {
  const link = new ScriptedLink();
  link.replies = [['scan 1 2 3\r\n', '1 0.1 0.2 0.3 0.4\r\n2 0.1 0.2 0.3 0.4\r\n3 0.1 0.2 0.3 0.4\r\nch>'], ['version\r\n0.5.8\r\nch>']];
  const [a, b] = await Promise.all([link.command('scan 1 2 3'), link.command('version')]);   // fired together
  assert.equal(a.body.split('\n').length, 3);
  assert.equal(b.body, '0.5.8');
  assert.deepEqual(link.sent, ['scan 1 2 3', 'version']);
});

test('shell-link: requireEcho discards a stale reply; terminators end a reply without a prompt', async () => {
  const link = new ScriptedLink();
  link.replies = [['sweep cw 1\r\nch> ', 'level -70\r\nch> ']];
  const r = await link.command('level -70', { requireEcho: true });
  assert.equal(r.body, '');
  link.replies = [['pause\r\nCommand timeout\r\n']];
  const t = await link.command('pause', { requireEcho: true, terminators: ['Command timeout'], timeoutMs: 500 });
  assert.equal(t.body.trim(), 'Command timeout');
});

test('shell-link: defaults unchanged for the NanoVNA (no echo requirement, prompt twice with a space)', async () => {
  const link = new ScriptedLink();
  link.replies = [['version\r\n', '0.5.8\r\nch> \r\nch> ']];
  const r = await link.command('version');
  assert.equal(r.body, '0.5.8');
});
