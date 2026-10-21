// @ts-check
// ============================================================
// hatchet — small chops from the gyro (PLAN §5)
// ============================================================
// Pure. A swing is a peak in rotation-rate magnitude. The hit lands when the
// rate falls back below 40% of that peak (the hatchet stopping in the wood).
// A 250 ms refractory window plus a recoil check (a rotation the other way
// right after a hit) stop one chop counting twice. Grading is against the
// player's own calibrated swing, so nothing rewards a big wind-up:
// soft = a glancing tap (no progress); good and strong score the same.
// ============================================================

import { norm, dot } from './vec.js';

/** @typedef {import('./vec.js').Vec3} Vec3 */

export const CHOP = Object.freeze({
  /** Rotation rate (deg/s) that starts a swing, at least. */
  MIN_START: 150,
  /** …or this share of the calibrated peak. */
  START_FRAC: 0.45,
  /** The hit lands when the rate drops below this share of the swing's peak. */
  LAND_FRAC: 0.4,
  REFRACTORY_MS: 250,
  /** A swing the other way this soon after a hit is the recoil. */
  RECOIL_MS: 450,
  /** Below this share of the calibrated peak = a soft (glancing) hit. */
  SOFT_FRAC: 0.6,
  /** Calibrated peak used before calibration. */
  DEFAULT_PEAK: 400,
  /** Swings that never land within this long are dropped (a wave, not a chop). */
  MAX_SWING_MS: 400,
});

/**
 * @typedef {object} ChopHit
 * @property {number} t       ms the hatchet landed
 * @property {number} peak    deg/s
 * @property {'soft'|'good'|'strong'} grade
 * @property {Vec3} axis      unit rotation axis of the swing (device frame)
 */

export class HatchetDetector {
  /** @param {{peak:number}} [profile] */
  constructor(profile = { peak: CHOP.DEFAULT_PEAK }) {
    this.profile = profile;
    this.reset();
  }

  reset() {
    /** @type {{start:number, peak:number, peakAxis: Vec3}|null} */
    this.swing = null;
    this.lastHitT = -Infinity;
    /** @type {Vec3} */
    this.lastAxis = [0, 0, 0];
  }

  /**
   * @param {{t:number, r: Vec3}} s  rotation rate, deg/s, device frame
   * @returns {ChopHit|null}
   */
  push(s) {
    const m = Math.hypot(s.r[0], s.r[1], s.r[2]);
    const start = Math.max(CHOP.MIN_START, CHOP.START_FRAC * this.profile.peak);
    if (!this.swing) {
      if (m < start || s.t - this.lastHitT < CHOP.REFRACTORY_MS) return null;
      const axis = norm(s.r);
      // The hatchet bouncing back out of the wood rotates the other way.
      if (s.t - this.lastHitT < CHOP.RECOIL_MS && dot(axis, this.lastAxis) < -0.3) return null;
      this.swing = { start: s.t, peak: m, peakAxis: axis };
      return null;
    }
    const sw = this.swing;
    if (m > sw.peak) { sw.peak = m; sw.peakAxis = norm(s.r); }
    if (s.t - sw.start > CHOP.MAX_SWING_MS) { this.swing = null; return null; }
    if (m >= CHOP.LAND_FRAC * sw.peak) return null;
    this.swing = null;
    this.lastHitT = s.t;
    this.lastAxis = sw.peakAxis;
    const cal = this.profile.peak;
    /** @type {'soft'|'good'|'strong'} */
    const grade = sw.peak < CHOP.SOFT_FRAC * cal ? 'soft' : sw.peak < 1.4 * cal ? 'good' : 'strong';
    return { t: s.t, peak: sw.peak, grade, axis: sw.peakAxis };
  }
}
