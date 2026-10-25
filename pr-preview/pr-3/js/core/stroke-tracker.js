// @ts-check
// ============================================================
// stroke-tracker — a phone's saw stroke from its accelerometer (PLAN §4.3, §6.1)
// ============================================================
//
// Pure. Feed devicemotion samples; read p ∈ [-1, +1] (+1 = pulled to the
// belly), v (p per second) and the steering roll.
//
//   1. a  = linear acceleration · the calibrated stroke axis (pull = +)
//   2. remove the slow mean (tilt leak, bias), low-pass ~5 Hz (noise), then leaky-integrate to velocity (high-pass
//      ~0.3 Hz, so bias and tilt leak can't run away)
//   3. a reversal is a velocity sign change, with hysteresis and a minimum
//      half-stroke time; it is dated back to the zero crossing
//   4. p restarts at ±1 at every reversal (this is the "snap" that kills
//      drift) and moves toward the other end by the distance travelled since,
//      over the learned half-stroke travel, so half strokes still reach ±1
//
// Steering roll is read from gravity (acceleration with gravity minus
// acceleration), around the stroke axis, relative to the calibrated rest pose,
// so it never drifts (PLAN §4.4).
// ============================================================

import { dot, norm, signedAngleAround } from './vec.js';

/** @typedef {import('./vec.js').Vec3} Vec3 */

export const TRACK = Object.freeze({
  LOWPASS_HZ: 5,
  /** Acceleration DC blocker (tilt leak, sensor bias), Hz. */
  DC_HZ: 0.2,
  /** Velocity leak (high-pass corner), Hz. */
  LEAK_HZ: 0.3,
  /** |v| (m/s) needed to confirm a reversal. */
  V_MIN: 0.05,
  /** …or this share of the last half-stroke's peak speed, whichever is larger. */
  V_FRAC: 0.12,
  /** Shortest half-stroke, ms. */
  MIN_HALF_MS: 140,
  /** First guess of the half-stroke travel, m (a ±6 cm stroke). */
  HALF_TRAVEL_M: 0.12,
  /** Learned travel stays inside this range, m. */
  HALF_TRAVEL_MIN: 0.03,
  HALF_TRAVEL_MAX: 0.6,
  /** EMA weight for learning the half-stroke travel. */
  TRAVEL_EMA: 0.3,
  /** Twist that counts as a full steer, degrees. */
  ROLL_FULL_DEG: 30,
  /** The snap to ±1 at a reversal blends in over this long, s. */
  SNAP_BLEND_S: 0.08,
  /** Gaps longer than this restart the filters, ms. */
  MAX_GAP_MS: 250,
});

/**
 * Per-phone calibration (calibration.js builds it).
 * @typedef {object} StrokeProfile
 * @property {Vec3} axis          unit vector, device frame, + = the pull direction
 * @property {Vec3|null} restG    unit gravity in the device frame at the calibrated grip
 * @property {1|-1} rollSign      +1 if twisting toward the screen's right reads positive
 * @property {number} halfTravel  m, learned during calibration
 * @property {number} lagMs       sensing lag to subtract from timestamps (warm-up vs the beat)
 */

/** @returns {StrokeProfile} */
export function defaultProfile() {
  // Fist grip, phone top pointing along the stroke toward the partner:
  // pulling to the belly moves the phone toward its bottom edge (-y).
  return { axis: [0, -1, 0], restG: null, rollSign: 1, halfTravel: TRACK.HALF_TRAVEL_M, lagMs: 0 };
}

/**
 * @typedef {object} MotionSample
 * @property {number} t          ms (any monotonic clock)
 * @property {Vec3} a            linear acceleration, m/s² (gravity removed)
 * @property {Vec3|null} [g]     gravity, m/s² (acceleration with gravity minus a), if known
 */

/**
 * @typedef {object} Reversal
 * @property {number} t      ms of the velocity zero crossing
 * @property {1|-1} end      +1 = reached the pull end (belly), -1 = the forward end
 * @property {number} travel m travelled in the half-stroke that ended
 * @property {number} ms     duration of that half-stroke
 */

export class StrokeTracker {
  /** @param {StrokeProfile} [profile] */
  constructor(profile = defaultProfile()) {
    this.profile = profile;
    this.reset();
  }

  /** @param {{keepLearned?: boolean}} [o] keep the learned stroke size (a gap, not a new player) */
  reset(o = {}) {
    const keep = o.keepLearned && Number.isFinite(this.halfTravel);
    const learned = keep ? { halfTravel: this.halfTravel, lastPeakV: this.lastPeakV, p: this.p } : null;
    this._reset();
    if (learned) { this.halfTravel = learned.halfTravel; this.lastPeakV = learned.lastPeakV; this.p = learned.p; }
  }

  _reset() {
    this.lastT = NaN;
    this.aLp = 0;
    this.aDc = 0;          // slow mean of the axis acceleration (removed)
    this.v = 0;           // m/s along the axis, + = pulling
    this.dir = 0;         // sign of the current half-stroke (+1 pulling)
    this.dist = 0;        // m travelled since the last reversal
    this.peakV = 0;       // |v| peak this half-stroke
    this.lastPeakV = 0.3;
    this.revT = NaN;      // time of the last confirmed reversal (zero crossing)
    this.zeroT = NaN;     // most recent zero crossing of v
    this.distAtZero = 0;
    this.startP = -1;     // p at the last reversal (±1)
    this.snapOff = 0;     // what's left of the snap to ±1, blended out
    this.p = 0;
    this.pv = 0;          // dp/dt, per second
    this.halfTravel = this.profile.halfTravel;
    this.roll = 0;        // -1..1 steer
    this.rollDeg = 0;
    /** @type {Reversal[]} */
    this.reversals = [];
  }

  /** @param {StrokeProfile} profile */
  setProfile(profile) {
    this.profile = profile;
    this.halfTravel = profile.halfTravel;
  }

  /**
   * @param {MotionSample} s
   * @returns {Reversal|null} a reversal confirmed by this sample
   */
  push(s) {
    const prof = this.profile;
    const first = !Number.isFinite(this.lastT);
    let dt = first ? 0 : (s.t - this.lastT) / 1000;
    // A duplicate or out-of-order timestamp (Android can coalesce events):
    // skip the sample, keep every filter as it is.
    if (!first && dt <= 0) return null;
    if (dt > TRACK.MAX_GAP_MS / 1000) { this.reset({ keepLearned: true }); dt = 0; }
    this.lastT = s.t;

    // Steering roll from gravity.
    if (s.g && prof.restG) {
      const gN = norm(s.g);
      const ang = signedAngleAround(prof.restG, gN, prof.axis) * (180 / Math.PI) * prof.rollSign;
      this.rollDeg = ang;
      this.roll = Math.max(-1, Math.min(1, ang / TRACK.ROLL_FULL_DEG));
    }

    const a = dot(s.a, prof.axis);
    if (dt === 0) return null; // first sample (or right after a gap): filters start here
    const kLp = 1 - Math.exp(-2 * Math.PI * TRACK.LOWPASS_HZ * dt);
    this.aDc += (a - this.aDc) * (1 - Math.exp(-2 * Math.PI * TRACK.DC_HZ * dt));
    this.aLp += (a - this.aDc - this.aLp) * kLp;
    const leak = Math.exp(-2 * Math.PI * TRACK.LEAK_HZ * dt);
    const vPrev = this.v;
    this.v = this.v * leak + this.aLp * dt;
    this.dist += Math.abs(this.v) * dt * (Math.sign(this.v) === this.dir || this.dir === 0 ? 1 : -1);

    // Remember where v last crossed zero (interpolated), to date reversals.
    if (vPrev !== 0 && Math.sign(this.v) !== Math.sign(vPrev)) {
      const f = vPrev / (vPrev - this.v);
      this.zeroT = s.t - (1 - f) * dt * 1000;
      this.distAtZero = this.dist;
    }

    let rev = null;
    const vs = Math.sign(this.v);
    const thresh = Math.max(TRACK.V_MIN, TRACK.V_FRAC * this.lastPeakV);
    if (this.dir === 0) {
      if (Math.abs(this.v) >= thresh) this._startHalf(vs, Number.isFinite(this.zeroT) ? this.zeroT : s.t, 0);
    } else if (vs !== 0 && vs !== this.dir && Math.abs(this.v) >= thresh) {
      let zt = Number.isFinite(this.zeroT) ? this.zeroT : s.t;
      // Too soon after the last reversal to be a new half-stroke? Wait until
      // the minimum has passed (not forever: the crossing may be real).
      if (Number.isFinite(this.revT) && zt - this.revT < TRACK.MIN_HALF_MS && s.t - this.revT >= TRACK.MIN_HALF_MS) {
        zt = this.revT + TRACK.MIN_HALF_MS;
      }
      if (!Number.isFinite(this.revT) || zt - this.revT >= TRACK.MIN_HALF_MS) {
        const travel = Math.max(0, this.distAtZero);
        const ms = Number.isFinite(this.revT) ? zt - this.revT : NaN;
        /** @type {1|-1} */
        const end = this.dir === 1 ? 1 : -1;
        rev = { t: zt, end, travel, ms };
        this.reversals.push(rev);
        if (this.reversals.length > 64) this.reversals.shift();
        if (Number.isFinite(ms) && travel > TRACK.HALF_TRAVEL_MIN * 0.5) {
          const learned = this.halfTravel + (travel - this.halfTravel) * TRACK.TRAVEL_EMA;
          this.halfTravel = Math.max(TRACK.HALF_TRAVEL_MIN, Math.min(TRACK.HALF_TRAVEL_MAX, learned));
        }
        this.lastPeakV = Math.max(0.1, this.peakV);
        // The new half-stroke started at the zero crossing; keep what it
        // already travelled since then. The snap to ±1 (which stops drift)
        // is blended in over ~80 ms so a short stroke never jumps.
        const before = this.p;
        this._startHalf(vs, zt, Math.max(0, -(this.dist - this.distAtZero)));
        this.snapOff = before - this._ramp();
      }
    }
    if (Math.abs(this.v) > this.peakV) this.peakV = Math.abs(this.v);

    // Position: from the end we reversed at, toward the other end.
    if (this.dir !== 0) {
      this.snapOff *= Math.exp(-dt / TRACK.SNAP_BLEND_S);
      this.p = Math.max(-1, Math.min(1, this._ramp() + this.snapOff));
    }
    // Stroke velocity in p per second, straight from the hand's velocity
    // (smooth, no spike at the snap).
    this.pv = (2 * this.v) / this.halfTravel;
    return rev;
  }

  /** Where the half-stroke ramp puts p, from the end we reversed at. */
  _ramp() {
    const frac = Math.min(1, Math.max(0, this.dist) / this.halfTravel);
    return this.startP - this.startP * 2 * frac;
  }

  /** @param {number} dir @param {number} t @param {number} already */
  _startHalf(dir, t, already) {
    // Moving toward the pull end (+) means we just left the forward end (-1).
    this.startP = dir > 0 ? -1 : 1;
    this.dir = dir;
    this.dist = already;
    this.peakV = 0;
    this.revT = t;
  }
}

/**
 * Median tempo from recent reversals (one reversal per stroke = per beat).
 * @param {Reversal[]} revs @returns {number|null} BPM
 */
export function tempoOf(revs) {
  const ms = revs.map((r) => r.ms).filter((x) => Number.isFinite(x) && x > 200 && x < 2000);
  if (ms.length < 3) return null;
  ms.sort((a, b) => a - b);
  return 60000 / ms[Math.floor(ms.length / 2)];
}
