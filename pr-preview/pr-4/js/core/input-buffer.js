// @ts-check
// ============================================================
// input-buffer — per-seat stroke samples, read at one matched time (PLAN §4.3)
// ============================================================
// Pure. Each seat's samples arrive late and jittery (phone → relay → host).
// The saw must compare both handles at the SAME moment, after removing each
// seat's calibrated lag, or skew between devices shows up as false strain.
// So the host evaluates at t_eval = the newest time every live seat has
// reached, and reads each seat by interpolating its samples there.
// ============================================================

/** @typedef {{t:number, p:number, v:number, roll:number, flags:number}} Sample */

export const BUFFER = Object.freeze({
  KEEP_MS: 3000,
  /** A seat with nothing newer than this is slack (dropped, locked, asleep). */
  STALE_MS: 600,
  /** Never evaluate further behind "now" than this. */
  MAX_BEHIND_MS: 450,
});

export class SeatBuffer {
  constructor() {
    /** @type {Sample[]} */
    this.samples = [];
    this.lagMs = 0;
    this.lastArrival = -Infinity;
  }

  /** @param {Sample} s @param {number} arrivedAt host ms */
  push(s, arrivedAt) {
    const t = s.t - this.lagMs;
    const item = { ...s, t };
    const arr = this.samples;
    // Usually in order; insert in place if not (relay reorders are rare).
    if (!arr.length || arr[arr.length - 1].t <= t) arr.push(item);
    else {
      let i = arr.length - 1;
      while (i > 0 && arr[i - 1].t > t) i--;
      if (arr[i].t === t) return;
      arr.splice(i, 0, item);
    }
    this.lastArrival = arrivedAt;
    const cutoff = t - BUFFER.KEEP_MS;
    while (arr.length > 2 && arr[0].t < cutoff) arr.shift();
  }

  get latestT() {
    return this.samples.length ? this.samples[this.samples.length - 1].t : -Infinity;
  }

  /** @param {number} now host ms */
  isStale(now) {
    return now - this.lastArrival > BUFFER.STALE_MS;
  }

  /**
   * The seat's handle at time t: interpolated between samples, held at the
   * ends. @param {number} t @returns {Sample|null}
   */
  at(t) {
    const arr = this.samples;
    if (!arr.length) return null;
    if (t <= arr[0].t) return arr[0];
    const last = arr[arr.length - 1];
    if (t >= last.t) return last;
    let lo = 0, hi = arr.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = arr[lo], b = arr[hi];
    const f = (t - a.t) / (b.t - a.t || 1);
    return {
      t,
      p: a.p + (b.p - a.p) * f,
      v: a.v + (b.v - a.v) * f,
      roll: a.roll + (b.roll - a.roll) * f,
      flags: f < 0.5 ? a.flags : b.flags,
    };
  }
}

/**
 * The matched evaluation time for a set of live buffers.
 * @param {SeatBuffer[]} live @param {number} now host ms
 */
export function matchedTime(live, now) {
  let t = now;
  for (const b of live) t = Math.min(t, b.latestT);
  return Math.max(t, now - BUFFER.MAX_BEHIND_MS);
}

// ------------------------------------------------------------
// The button path: hold to pull (PLAN §4.7, §13.2 "press on your pull")
// ------------------------------------------------------------

/**
 * Holding = pulling toward you; letting go = your partner's pull carries the
 * saw back. One beat takes the handle end to end, eased at the ends.
 */
export class HoldPull {
  constructor() {
    this.x = -1;     // linear position
    this.p = -1;     // eased
    this.v = 0;
  }

  /**
   * @param {number} dtMs @param {boolean} held @param {number} beatMs
   * @returns {{p:number, v:number}}
   */
  step(dtMs, held, beatMs) {
    const rate = (2 / beatMs) * dtMs;
    const prev = this.p;
    this.x = Math.max(-1, Math.min(1, this.x + (held ? rate : -rate)));
    // Ease: the handle slows into each end the way a hand does.
    this.p = Math.sin((this.x * Math.PI) / 2);
    this.v = dtMs > 0 ? ((this.p - prev) / dtMs) * 1000 : 0;
    return { p: this.p, v: this.v };
  }
}
