import test from 'node:test';
import assert from 'node:assert/strict';
import { StrokeTracker, defaultProfile, tempoOf } from '../../public/js/core/stroke-tracker.js';

const DT = 1000 / 60;

/** Deterministic noise. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
}

/**
 * Simulate a phone sawing: position along -y (the pull) is x(t) = A·cos(…).
 * Returns per-sample {t, p, truth} after feeding the tracker.
 */
function simulate({ ampM = 0.12, bpm = 100, ms = 14000, noise = 0.15, jitterMs = 3, profile = defaultProfile(), tilt = 0 } = {}) {
  const tr = new StrokeTracker(profile);
  const r = rng(7);
  const beatMs = 60000 / bpm;
  const w = Math.PI / beatMs; // one stroke per beat → cycle = 2 beats
  const out = [];
  const revs = [];
  let t = 0;
  while (t < ms) {
    const truth = -Math.cos(w * t); // +1 at pull end
    const pos = (ampM / 2) * truth; // metres toward the belly
    const acc = (ampM / 2) * w * w * 1e6 * Math.cos(w * t); // d²pos/dt² (m/s²)
    // Pull is toward -y: device acceleration along y is -acc.
    const a = [noise * r(), -acc + tilt + noise * r(), noise * r()];
    const rev = tr.push({ t, a, g: [0, 0, 9.8] });
    if (rev) revs.push(rev);
    out.push({ t, p: tr.p, truth, pos });
    t += DT + jitterMs * r() * 2;
  }
  return { out, revs, tr };
}

function corr(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

/** Best correlation over lags 0..300 ms (the tracker lags a little; calibration removes it). */
function bestLag(out) {
  const warm = out.filter((o) => o.t > 5000);
  let best = { c: -1, lag: 0 };
  for (let lag = -150; lag <= 300; lag += DT) {
    const k = Math.round(lag / DT);
    const xs = [], ys = [];
    for (let i = Math.max(0, k); i < warm.length && i - k < warm.length; i++) {
      if (i - k < 0) continue;
      xs.push(warm[i].p); ys.push(warm[i - k].truth);
    }
    const c = corr(xs, ys);
    if (c > best.c) best = { c, lag };
  }
  return best;
}

test('tracks a full stroke at 100 BPM with noise and jitter', () => {
  const { out, revs } = simulate();
  const { c, lag } = bestLag(out);
  assert.ok(c > 0.95, 'corr ' + c.toFixed(3));
  assert.ok(lag >= -100 && lag <= 200, 'lag ' + lag);
  // ~20 strokes in 12 s at 100 BPM; reversals = strokes.
  assert.ok(revs.length >= 19 && revs.length <= 25, 'reversals ' + revs.length);
});

test('half strokes are normalized: p still reaches near ±1', () => {
  for (const ampM of [0.06, 0.12, 0.24]) {
    const { out } = simulate({ ampM });
    const late = out.filter((o) => o.t > 5000);
    const max = Math.max(...late.map((o) => o.p)), min = Math.min(...late.map((o) => o.p));
    assert.ok(max > 0.85 && min < -0.85, `amp ${ampM}: ${min.toFixed(2)}..${max.toFixed(2)}`);
  }
});

test('tempo estimate from reversals', () => {
  for (const bpm of [80, 100, 110]) {
    const { revs } = simulate({ bpm });
    const t = tempoOf(revs.slice(4));
    assert.ok(t && Math.abs(t - bpm) < 6, `bpm ${bpm} → ${t}`);
  }
});

test('a constant tilt leak does not run away', () => {
  const { out } = simulate({ tilt: 1.5, ms: 14000 }); // ~9° of gravity leaking ALONG the stroke axis
  const { c } = bestLag(out);
  assert.ok(c > 0.9, 'corr ' + c.toFixed(3));
});

test('a still phone stays still (no phantom strokes)', () => {
  const tr = new StrokeTracker();
  const r = rng(3);
  let n = 0;
  for (let t = 0; t < 8000; t += DT) if (tr.push({ t, a: [0.12 * r(), 0.12 * r(), 0.12 * r()] })) n++;
  assert.ok(n <= 1, 'phantom reversals ' + n);
});

test('roll from gravity around the stroke axis, signed by calibration', () => {
  const prof = { ...defaultProfile(), restG: [0, 0, 1] };
  const tr = new StrokeTracker(prof);
  const ang = (20 * Math.PI) / 180;
  // Twist about the stroke axis (y): gravity rotates in the x-z plane.
  tr.push({ t: 0, a: [0, 0, 0], g: [9.8 * Math.sin(ang), 0, 9.8 * Math.cos(ang)] });
  const r1 = tr.rollDeg;
  assert.ok(Math.abs(Math.abs(r1) - 20) < 0.5, 'roll ' + r1);
  const tr2 = new StrokeTracker({ ...prof, rollSign: -1 });
  tr2.push({ t: 0, a: [0, 0, 0], g: [9.8 * Math.sin(ang), 0, 9.8 * Math.cos(ang)] });
  assert.ok(Math.abs(tr2.rollDeg + r1) < 1e-6);
  // Pitch along the stroke axis does not steer.
  const tr3 = new StrokeTracker(prof);
  tr3.push({ t: 0, a: [0, 0, 0], g: [0, 9.8 * Math.sin(ang), 9.8 * Math.cos(ang)] });
  assert.ok(Math.abs(tr3.rollDeg) < 0.5);
});
