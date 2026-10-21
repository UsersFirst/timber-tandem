// @ts-check
// ============================================================
// calibration — build a phone's StrokeProfile from guided moves (PLAN §6.1, §6.2)
// ============================================================
// Pure helpers. The phone runs the steps; the screen shows what to do.
//   rest   hold the fist grip still          → resting gravity, noise floor
//   pull   from forward, pull to your belly   → which way "pull" is
//   saw    saw air: free strokes, then on the clicks → stroke axis, travel,
//          comfortable tempo, and the lag between your strokes and the beat
//   twist  twist toward the TV's right        → steering sign
//   chop   three small chops                  → your swing size
// ============================================================

import { norm, dot, principalAxis, scale, len } from './vec.js';

/** @typedef {import('./vec.js').Vec3} Vec3 */

/** @param {Vec3[]} gs gravity samples @returns {Vec3|null} */
export function restGravity(gs) {
  if (gs.length < 5) return null;
  const m = [0, 0, 0];
  for (const g of gs) { m[0] += g[0]; m[1] += g[1]; m[2] += g[2]; }
  const v = norm(/** @type {Vec3} */ (m));
  return len(v) > 0.5 ? v : null;
}

/**
 * Direction of a deliberate pull from rest: the integrated acceleration over
 * the first ~250 ms after it starts (a move from rest begins by speeding up
 * toward where it goes). Robust to browsers that flip the axis signs, because
 * the same convention applies later.
 * @param {{t:number, a:Vec3}[]} samples  linear acceleration
 * @returns {Vec3|null}
 */
export function pullDirection(samples, { onset = 1.2 } = {}) {
  const i0 = samples.findIndex((s) => len(s.a) >= onset);
  if (i0 < 0) return null;
  // Integrate velocity from the start of the motion, then take the direction
  // of the LAST big velocity peak: the pull is the move that ends the
  // gesture, even if someone reaches forward first.
  /** @type {Vec3} */
  const v = [0, 0, 0];
  const vs = [];
  for (let i = Math.max(1, i0); i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (!(dt > 0) || dt > 0.25) continue;
    v[0] += samples[i].a[0] * dt; v[1] += samples[i].a[1] * dt; v[2] += samples[i].a[2] * dt;
    vs.push(/** @type {Vec3} */ ([v[0], v[1], v[2]]));
  }
  if (vs.length < 3) return null;
  const mags = vs.map(len);
  const max = Math.max(...mags);
  if (max < 0.05) return null;
  let pick = -1;
  for (let i = 1; i < vs.length - 1; i++) {
    if (mags[i] >= 0.5 * max && mags[i] >= mags[i - 1] && mags[i] >= mags[i + 1]) pick = i;
  }
  if (pick < 0) pick = mags.indexOf(max);
  const d = norm(vs[pick]);
  return len(d) > 0.5 ? d : null;
}

/**
 * Stroke axis from sawing: the principal axis of acceleration, signed so it
 * agrees with the pull direction (or with -y, the coached grip, if unknown).
 * @param {Vec3[]} accs @param {Vec3|null} pullDir
 * @returns {{axis: Vec3, quality: number}|null}  quality = share of motion on the axis
 */
export function strokeAxis(accs, pullDir) {
  if (accs.length < 30) return null;
  const { axis, share } = principalAxis(accs);
  const ref = pullDir ?? /** @type {Vec3} */ ([0, -1, 0]);
  const signed = dot(axis, ref) < 0 ? scale(axis, -1) : axis;
  return { axis: /** @type {Vec3} */ (signed), quality: share };
}

/**
 * Lag between a player's stroke reversals and the beat: the median signed
 * offset of each reversal to its nearest beat. Positive = late.
 * @param {number[]} reversalTimes host ms
 * @param {number} beat0 host ms of beat 0 @param {number} beatMs
 */
export function lagToBeat(reversalTimes, beat0, beatMs) {
  const offs = reversalTimes
    .map((t) => { const k = Math.round((t - beat0) / beatMs); return t - (beat0 + k * beatMs); })
    .filter((o) => Math.abs(o) < beatMs * 0.45);
  if (offs.length < 3) return null;
  offs.sort((a, b) => a - b);
  return offs[Math.floor(offs.length / 2)];
}

/**
 * Steering sign from "twist toward the TV's right": the median raw roll in the
 * second half of the step. +1 if that read positive.
 * @param {number[]} rawRollDeg
 * @returns {1|-1|null}
 */
export function rollSignFrom(rawRollDeg) {
  const half = rawRollDeg.slice(Math.floor(rawRollDeg.length / 2)).sort((a, b) => a - b);
  if (!half.length) return null;
  const med = half[Math.floor(half.length / 2)];
  if (Math.abs(med) < 6) return null; // didn't really twist
  return med > 0 ? 1 : -1;
}

/** @param {number[]} peaks deg/s @returns {number|null} */
export function chopPeak(peaks) {
  if (peaks.length < 2) return null;
  const s = [...peaks].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Comfortable tempo, clamped to the song's range (PLAN §4.5). */
export function songTempo(bpms) {
  const ok = bpms.filter((b) => Number.isFinite(b));
  const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 96;
  return Math.round(Math.max(80, Math.min(110, avg)));
}
