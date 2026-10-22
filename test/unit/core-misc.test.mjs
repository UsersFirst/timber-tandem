import test from 'node:test';
import assert from 'node:assert/strict';
import { HatchetDetector, CHOP } from '../../public/js/core/hatchet.js';
import { createNotch, notchHit, notchFrac } from '../../public/js/core/notch.js';
import { createCut, cutBite, fallAngle, landing, bladeLean, steerLean, MAX_FALL_DEG } from '../../public/js/core/tree.js';
import { ClockSync } from '../../public/js/core/clock-sync.js';
import { restGravity, pullDirection, strokeAxis, lagToBeat, rollSignFrom, chopPeak, songTempo, pullParity } from '../../public/js/core/calibration.js';

const DT = 1000 / 60;

/** A chop: rotation-rate bell around `axis`, `peak` deg/s, ~120 ms, plus a recoil the other way. */
function chop(t0, peak, axis = [1, 0, 0], recoil = 0.5) {
  const out = [];
  for (let t = 0; t < 420; t += DT) {
    let m = 0;
    if (t < 120) m = peak * Math.sin((Math.PI * t) / 120);
    else if (t > 140 && t < 240) m = -recoil * peak * Math.sin((Math.PI * (t - 140)) / 100);
    out.push({ t: t0 + t, r: [axis[0] * m, axis[1] * m, axis[2] * m] });
  }
  return out;
}

test('hatchet: one hit per chop, recoil ignored', () => {
  const d = new HatchetDetector({ peak: 400 });
  const hits = [];
  for (const s of [...chop(0, 420), ...chop(800, 380), ...chop(1600, 450)]) { const h = d.push(s); if (h) hits.push(h); }
  assert.equal(hits.length, 3);
  assert.ok(hits.every((h) => h.grade === 'good'));
  // Hit lands after the peak (~60 ms in), before the swing ends.
  assert.ok(hits[0].t > 60 && hits[0].t < 125, 'hit t ' + hits[0].t);
});

test('hatchet: soft taps glance, wind-ups score the same as good', () => {
  const d = new HatchetDetector({ peak: 400 });
  const grades = [];
  for (const s of [...chop(0, 155), ...chop(800, 700)]) { const h = d.push(s); if (h) grades.push(h.grade); }
  assert.deepEqual(grades, ['soft', 'strong']);
  assert.ok(CHOP.SOFT_FRAC < 1);
});

test('hatchet: slow twisting is not a chop', () => {
  const d = new HatchetDetector({ peak: 400 });
  let n = 0;
  for (let t = 0; t < 3000; t += DT) if (d.push({ t, r: [90, 0, 0] })) n++;
  assert.equal(n, 0);
});

test('notch: alternating turns, out-of-turn chips, soft glances, clang', () => {
  const st = createNotch(4, 'A');
  assert.equal(notchHit(st, 'B', 0, 'good').kind, 'chip');
  assert.equal(notchHit(st, 'A', 500, 'soft').kind, 'glance');
  assert.equal(notchHit(st, 'A', 1000, 'good').kind, 'open');
  assert.equal(st.lit, 'B');
  assert.equal(notchHit(st, 'A', 1500, 'good').kind, 'chip'); // spam does nothing
  assert.equal(notchHit(st, 'B', 1550, 'good').kind, 'clang'); // too close to A's
  assert.equal(notchHit(st, 'B', 2000, 'good').kind, 'open');
  notchHit(st, 'A', 2500, 'good');
  assert.equal(notchHit(st, 'B', 3000, 'strong').kind, 'done');
  assert.equal(notchFrac(st), 1);
});

test('steering: average of both twists; opposite twists cancel', () => {
  assert.equal(bladeLean(1, 1), 1);
  assert.equal(bladeLean(1, -1), 0);
  // Grandma follows her partner's twist: solo steers at full strength.
  assert.equal(steerLean(0.8, 0, 'B'), 0.8);
  assert.equal(steerLean(0, -0.6, 'A'), -0.6);
  assert.equal(steerLean(1, -1, null), 0);
  const cut = createCut(20);
  for (let i = 0; i < 4; i++) cutBite(cut, 0.4);
  assert.ok(Math.abs(fallAngle(cut, 0.4) - 0.4 * MAX_FALL_DEG) < 1e-9);
  // Only the last few bites aim the fall: a late twist counts.
  for (let i = 0; i < 6; i++) cutBite(cut, -0.6);
  assert.ok(Math.abs(fallAngle(cut, -0.6) + 0.6 * MAX_FALL_DEG) < 1e-9);
});

test('landing grades', () => {
  assert.equal(landing(9, 8).grade, 'skid');
  assert.equal(landing(15, 8).grade, 'close');
  assert.equal(landing(-10, 8).grade, 'wide');
  assert.equal(landing(22, 8).grade, 'privy');
});

test('clock sync: recovers offset through jittery RTT', () => {
  const cs = new ClockSync();
  const OFFSET = 123456.7;
  let seed = 5;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 20; i++) {
    const c0 = i * 500;
    const up = 15 + 60 * r(), down = 15 + 60 * r();
    const h = c0 + up + OFFSET;
    cs.add(c0, h, c0 + up + down);
  }
  assert.ok(cs.synced);
  assert.ok(Math.abs(cs.offset - OFFSET) < 20, 'offset err ' + (cs.offset - OFFSET));
});

test('calibration helpers', () => {
  assert.deepEqual(restGravity(Array(10).fill([0, 0, 9.8])), [0, 0, 1]);
  const pull = [];
  for (let t = 0; t < 600; t += DT) pull.push({ t, a: t < 100 ? [0, 0, 0] : t < 300 ? [0.1, -3, 0] : [0, 3, 0] });
  const pd = pullDirection(pull);
  assert.ok(pd[1] < -0.9);
  const accs = [];
  for (let i = 0; i < 120; i++) { const a = 3 * Math.sin(i / 5); accs.push([0.05 * a, a, 0.02]); }
  const ax = strokeAxis(accs, pd);
  assert.ok(ax.axis[1] < -0.95 && ax.quality > 0.9);
  assert.equal(lagToBeat([610, 1195, 1830, 2400 + 25], 0, 600), 25);
  assert.equal(rollSignFrom([0, 5, 15, 20, 22, 21]), 1);
  assert.equal(rollSignFrom([0, -2, 1, 2]), null);
  assert.equal(chopPeak([300, 500, 420]), 420);
  assert.equal(songTempo([70, 75]), 80);
  assert.equal(songTempo([]), 96);
});

test('pull calibration: reaching forward first still finds the pull (review #2)', () => {
  const s = [];
  // reach +y for 450 ms (speed up then slow), pause, then pull -y for 900 ms
  for (let t = 0; t < 2200; t += DT) {
    let ay = 0;
    if (t < 450) ay = 4 * Math.sin((2 * Math.PI * t) / 450);
    else if (t > 800 && t < 1700) ay = -4 * Math.sin((2 * Math.PI * (t - 800)) / 900);
    s.push({ t, a: [0, ay, 0] });
  }
  const d = pullDirection(s);
  assert.ok(d && d[1] < -0.9, 'pull dir ' + JSON.stringify(d));
});

test('clock sync: a host reload (new boot id) resets the offset (review #3)', () => {
  const cs = new ClockSync();
  for (let i = 0; i < 8; i++) cs.add(i * 100, i * 100 + 20 + 500000, i * 100 + 40, 'boot1');
  assert.ok(Math.abs(cs.offset - 500000) < 1);
  for (let i = 0; i < 6; i++) cs.add(1000 + i * 100, 20 + i * 100, 1040 + i * 100, 'boot2');
  assert.ok(Math.abs(cs.offset - (-1000)) < 1, 'offset ' + cs.offset);
});

test('notch: a late-arriving hit far apart in time is not a clang (review #11)', () => {
  const st = createNotch(4, 'B');
  notchHit(st, 'A', 1600, 'good'); // out of turn, arrives first
  assert.equal(notchHit(st, 'B', 1300, 'good').kind, 'open');
});

test('pullParity: Pete\'s 2026-10-21 two-phone session — phone B was reversed', () => {
  // Pulled ends in beats from the first click (96 BPM), from the real log:
  // both phones said "pulled" on the odd clicks, so B (wants even) is backwards.
  const beatMs = 625;
  const A = [1.59, 3.48, 5.20, 7.13].map((b) => b * beatMs);
  const B = [1.74, 3.43, 5.21, 7.17].map((b) => b * beatMs);
  const a = pullParity(A, 0, beatMs, 65, 'A');
  const b = pullParity(B, 0, beatMs, 107, 'B');
  assert.equal(a?.reversed, false);
  assert.equal(b?.reversed, true);
});

test('pullParity: on-cue hands are left alone; too few strokes is no verdict', () => {
  const beatMs = 600;
  const A = [1, 3, 5, 7].map((b) => b * beatMs + 40);
  const B = [2, 4, 6, 8].map((b) => b * beatMs + 40);
  assert.equal(pullParity(A, 0, beatMs, 40, 'A')?.reversed, false);
  assert.equal(pullParity(B, 0, beatMs, 40, 'B')?.reversed, false);
  // A sloppy, half-beat-off player isn't flipped on weak evidence.
  const mush = [1.5, 2.6, 4.4, 5.5].map((b) => b * beatMs);
  assert.equal(pullParity(mush, 0, beatMs, 0, 'A')?.reversed, false);
  assert.equal(pullParity([600, 1800], 0, beatMs, 0, 'A'), null);
});
