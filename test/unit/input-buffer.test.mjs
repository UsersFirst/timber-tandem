import test from 'node:test';
import assert from 'node:assert/strict';
import { SeatBuffer, matchedTime, HoldPull, BUFFER } from '../../public/js/core/input-buffer.js';
import { createSaw, stepSaw, targetS } from '../../public/js/core/saw-model.js';

const DT = 1000 / 60;
const BEAT = 600;

test('interpolates and holds at the ends', () => {
  const b = new SeatBuffer();
  b.push({ t: 100, p: 0, v: 0, roll: 0, flags: 1 }, 100);
  b.push({ t: 200, p: 1, v: 0, roll: 0.5, flags: 1 }, 200);
  assert.equal(b.at(150).p, 0.5);
  assert.equal(b.at(150).roll, 0.25);
  assert.equal(b.at(50).p, 0);
  assert.equal(b.at(999).p, 1);
});

test('out-of-order samples are inserted in place', () => {
  const b = new SeatBuffer();
  for (const t of [100, 300, 200]) b.push({ t, p: t / 100, v: 0, roll: 0, flags: 1 }, t);
  assert.deepEqual(b.samples.map((s) => s.t), [100, 200, 300]);
});

test('matched time = the newest time every live seat has reached', () => {
  const a = new SeatBuffer(), b = new SeatBuffer();
  a.push({ t: 1000, p: 0, v: 0, roll: 0, flags: 1 }, 1000);
  b.push({ t: 940, p: 0, v: 0, roll: 0, flags: 1 }, 1000);
  assert.equal(matchedTime([a, b], 1050), 940);
  assert.equal(matchedTime([a, b], 2000), 2000 - BUFFER.MAX_BEHIND_MS);
});

test('skew between devices is removed by matched time + calibrated lag', () => {
  // A perfect pair, but B's samples are timestamped 70 ms late (its sensing
  // lag) and arrive 60 ms later than A's. Without correction this is ~0.12
  // false strain at 100 BPM (PLAN §4.3); with it, the saw sees a clean pair.
  const run = (lagB) => {
    const A = new SeatBuffer(), B = new SeatBuffer();
    B.lagMs = lagB;
    const saw = createSaw();
    let maxE = 0;
    for (let t = 0; t < 12000; t += DT) {
      A.push({ t, p: targetS(t / BEAT), v: 0, roll: 0, flags: 1 }, t + 40);
      B.push({ t: t + 70, p: -targetS(t / BEAT), v: 0, roll: 0, flags: 1 }, t + 100);
      const now = t + 40;
      const te = matchedTime([A, B], now);
      const a = A.at(te), b = B.at(te);
      stepSaw(saw, { t: te, pA: a.p, pB: b.p, beatMs: BEAT });
      if (t > 2000) maxE = Math.max(maxE, Math.abs(saw.e));
    }
    return { maxE, bites: saw.bites };
  };
  const raw = run(0), fixed = run(70);
  assert.ok(raw.maxE > 0.1, 'uncorrected strain ' + raw.maxE.toFixed(3));
  assert.ok(fixed.maxE < 0.02, 'corrected strain ' + fixed.maxE.toFixed(3));
  assert.ok(fixed.bites >= raw.bites);
});

test('hold-to-pull: one beat end to end, eased', () => {
  const h = new HoldPull();
  let r;
  for (let t = 0; t < BEAT; t += DT) r = h.step(DT, true, BEAT);
  assert.ok(r.p > 0.99);
  for (let t = 0; t < BEAT / 2; t += DT) r = h.step(DT, false, BEAT);
  assert.ok(Math.abs(r.p) < 0.08, 'mid ' + r.p);
});

test('hold-to-pull against Grandma: pressing on your beat cuts', () => {
  const h = new HoldPull();
  const saw = createSaw();
  // Hold during the beats where s* rises toward A (odd half-cycles).
  for (let t = 0; t < 20 * BEAT; t += DT) {
    const bp = t / BEAT;
    const held = Math.floor(bp) % 2 === 0; // beat 0→1: s* goes -1 → +1 (toward A)
    const a = h.step(DT, held, BEAT);
    stepSaw(saw, { t, pA: a.p, pB: -targetS(bp), beatMs: BEAT, beatPos: bp });
  }
  assert.ok(saw.bites >= 14, 'bites ' + saw.bites);
  assert.equal(saw.tantrums, 0);
});
