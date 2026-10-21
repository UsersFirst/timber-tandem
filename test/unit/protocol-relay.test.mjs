import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../public/js/core/protocol.js';
import { routeMessage, secretMatches } from '../../worker/index.js';

test('codes: make, validate, normalize', () => {
  const c = P.makeCode();
  assert.ok(P.isValidCode(c));
  assert.equal(P.normalizeCode('timb-' + c.toLowerCase()), c);
  assert.equal(P.normalizeCode(c.slice(0, 2) + ' ' + c.slice(2)), c);
  assert.equal(P.normalizeCode('TIMB-O0I1Z'), null);
});

test('pair fragment round-trip', () => {
  const s = P.makeSecret();
  assert.deepEqual(P.parsePairFragment(P.pairFragment('ABCDE', 2, s)), { code: 'ABCDE', seat: 2, secret: s });
  assert.equal(P.parsePairFragment('#ABCDE.5.' + s), null);
});

test('sample frames round-trip within quantization', () => {
  const samples = [
    { t: 123456, p: 0.73211, v: -3.21, roll: 0.25, flags: P.FLAG_VALID },
    { t: 123473, p: -1, v: 0, roll: -1, flags: P.FLAG_VALID | P.FLAG_HELD },
  ];
  const buf = P.encodeSamples(7, samples);
  const d = P.decodeSamples(buf);
  assert.equal(d.seq, 7);
  assert.equal(d.samples.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(d.samples[i].t, samples[i].t);
    assert.ok(Math.abs(d.samples[i].p - samples[i].p) < 1e-4);
    assert.ok(Math.abs(d.samples[i].v - samples[i].v) < 1e-3);
    assert.ok(Math.abs(d.samples[i].roll - samples[i].roll) < 1e-3);
    assert.equal(d.samples[i].flags, samples[i].flags);
  }
  // Relay prefixes a seat byte; decode at offset 1.
  const relayed = new Uint8Array(buf.length + 1); relayed[0] = 2; relayed.set(buf, 1);
  assert.equal(P.decodeSamples(relayed, 1).samples[1].p, -1);
  assert.equal(P.decodeSamples(new Uint8Array([1, 2, 3])), null);
});

test('relay routing', async () => {
  const pad = routeMessage('pad-2', P.encodeSamples(1, [{ t: 1, p: 0, v: 0, roll: 0, flags: 1 }]));
  assert.deepEqual(pad.to, ['host']);
  assert.equal(pad.data[0], 2);
  const j = routeMessage('pad-1', JSON.stringify({ t: 'hello' }));
  assert.deepEqual(JSON.parse(j.data), { t: 'from-pad', seat: 1, msg: { t: 'hello' } });
  const scr = routeMessage('screen:abc123', JSON.stringify({ t: 'ping', id: 1 }));
  assert.deepEqual(JSON.parse(scr.data), { t: 'from-screen', id: 'abc123', msg: { t: 'ping', id: 1 } });
  assert.deepEqual(routeMessage('host', JSON.stringify({ t: 'to-pad', seat: 3, msg: { t: 'cue' } })).to, ['pad-3']);
  assert.equal(routeMessage('host', JSON.stringify({ t: 'to-screen', msg: {} })).toScreens, '*');
  assert.equal(routeMessage('host', new Uint8Array([1])), null);
  assert.equal(routeMessage('pad-9', '{}'), null);
  assert.equal(routeMessage('host', JSON.stringify({ t: 'allow', seat: 1, hash: 'x' })), null);
  const s = P.makeSecret();
  assert.ok(await secretMatches(s, await P.sha256hex(s)));
  assert.ok(!(await secretMatches('nope', await P.sha256hex(s))));
});
