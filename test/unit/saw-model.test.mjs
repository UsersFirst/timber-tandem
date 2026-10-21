import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaw, stepSaw, SAW, temperOf, blameOf, targetS, grandmaHandle } from '../../public/js/core/saw-model.js';

const BEAT = 600; // 100 BPM
const DT = 1000 / 60;

/** Run a saw for `ms` with handle functions of t; returns {st, events}. */
function run(pAf, pBf, ms, beatMs = BEAT, withBeat = true) {
  const st = createSaw();
  const events = [];
  for (let t = 0; t <= ms; t += DT) {
    const h = 0.5;
    const vA = (pAf(t + h) - pAf(t - h)) / (2 * h) * 1000;
    const vB = (pBf(t + h) - pBf(t - h)) / (2 * h) * 1000;
    events.push(...stepSaw(st, { t, pA: pAf(t), pB: pBf(t), vA, vB, beatMs, beatPos: withBeat ? t / beatMs : undefined }));
  }
  return { st, events };
}
const count = (evs, type) => evs.filter((e) => e.type === type).length;

test('perfect alternation bites once per stroke, no strain', () => {
  const pA = (t) => targetS(t / BEAT);
  const pB = (t) => -targetS(t / BEAT);
  const { st, events } = run(pA, pB, 20 * BEAT);
  assert.ok(count(events, 'bite') >= 18, 'bites ' + count(events, 'bite'));
  assert.equal(count(events, 'tantrum'), 0);
  assert.equal(count(events, 'bind'), 0);
  assert.equal(temperOf(st), 100);
});

test('Grandma is the perfect partner: pB = -s*', () => {
  const g = grandmaHandle(0.5, BEAT);
  assert.ok(Math.abs(g.p + targetS(0.5)) < 1e-9);
});

test('faster sawing never cuts faster (chatter)', () => {
  // Both alternate perfectly, but at 3x the beat rate.
  const pA = (t) => targetS((3 * t) / BEAT);
  const pB = (t) => -targetS((3 * t) / BEAT);
  const fast = run(pA, pB, 10 * BEAT);
  const slow = run((t) => targetS(t / BEAT), (t) => -targetS(t / BEAT), 10 * BEAT);
  assert.ok(count(fast.events, 'chatter') > 20);
  assert.ok(count(fast.events, 'bite') <= count(slow.events, 'bite') / 2, 'fast bites ' + count(fast.events, 'bite'));
});

test('one person sawing alone always binds (green line below 0.5)', () => {
  assert.ok(SAW.GREEN < 0.5);
  for (const rest of [-1, -0.5, 0, 0.5]) {
    const { events } = run((t) => targetS(t / BEAT), () => rest, 12 * BEAT);
    assert.equal(count(events, 'bite'), 0, 'rest ' + rest);
  }
});

test('both pulling at once is a tug-of-war; both forward is a push', () => {
  const both = (t) => targetS(t / BEAT); // in phase
  const tug = run(both, both, 6 * BEAT);
  const tantrums = tug.events.filter((e) => e.type === 'tantrum');
  assert.ok(tantrums.length >= 1);
  // In phase, both reach +1 (tug) and -1 (push) every cycle.
  const kinds = new Set(tantrums.map((e) => e.kind));
  assert.ok(kinds.has('tug') || kinds.has('push'));
  assert.equal(count(tug.events, 'bite'), 0);
});

test('a small lag still cuts; a big lag binds, then tantrums', () => {
  const lagged = (lagMs) => run((t) => targetS(t / BEAT), (t) => -targetS((t - lagMs) / BEAT), 20 * BEAT);
  const ok = lagged(60);
  assert.ok(count(ok.events, 'bite') >= 15, 'bites at 60 ms ' + count(ok.events, 'bite'));
  const bad = lagged(200);
  assert.ok(count(bad.events, 'bite') < 5, 'bites at 200 ms ' + count(bad.events, 'bite'));
  const worse = lagged(400); // peak strain sin(pi*L/2T) = 0.87
  assert.ok(count(worse.events, 'tantrum') >= 1);
});

test('blame goes to the hand moving the way strain grows', () => {
  assert.equal(blameOf(-0.5, -2, 1), 'A'); // compression, A moving forward
  assert.equal(blameOf(-0.5, 1, -2), 'B');
  assert.equal(blameOf(0.5, 3, 1), 'A');
  assert.equal(blameOf(0.5, -1, -1), null);
});

test('with the beat known, blame lands on the late partner', () => {
  // B lags 150 ms behind the beat; A is perfect.
  const { st } = run((t) => targetS(t / BEAT), (t) => -targetS((t - 150) / BEAT), 20 * BEAT);
  assert.ok(st.blameTime.B > st.blameTime.A, JSON.stringify(st.blameTime));
});

test('a tantrum costs only the stroke and cools down', () => {
  const st = createSaw();
  let ev = [];
  ev.push(...stepSaw(st, { t: 0, pA: 0, pB: 0, beatMs: BEAT }));
  ev.push(...stepSaw(st, { t: 16, pA: 0.9, pB: 0.9, vA: 5, vB: 5, beatMs: BEAT }));
  ev.push(...stepSaw(st, { t: 32, pA: 0.95, pB: 0.95, vA: 5, vB: 5, beatMs: BEAT }));
  assert.equal(ev.filter((e) => e.type === 'tantrum').length, 1);
  assert.equal(st.bites, 0);
});

test('half strokes (normalized to ±1 by the tracker) count like full ones', () => {
  // The tracker normalizes, so the model only ever sees ±1-range strokes; a
  // stroke that only reaches ±0.6 has travel 1.2 and still counts.
  const { events } = run((t) => 0.6 * targetS(t / BEAT), (t) => -0.6 * targetS(t / BEAT), 12 * BEAT);
  assert.ok(count(events, 'bite') >= 9);
});
