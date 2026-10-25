// @ts-check
// ============================================================
// tree-pull — the tree's lean that keyboard and touch steering fight
// (docs/TOUCH-SOLO.md §4a, Pete 2026-10-25)
// ============================================================
// Pure. Keyboard and touch steering is otherwise free, so each tree pulls the
// steering toward one side, and the pull eases to a new strength (sometimes
// the other side) every few seconds. The steering that counts is the
// player's input plus the pull. The phone remote has no pull: holding a twist
// in your fist while you saw is already the hard way to steer.
// ============================================================

export const PULL = Object.freeze({
  MIN: 0.25,              // weakest pull, as a fraction of full steer
  MAX: 0.65,              // strongest
  EVERY_MS: [6000, 12000], // how long a pull holds before it changes
  EASE_MS: 1500,          // how long it takes to ease to the new pull
  FLIP: 0.3,              // chance a change switches sides
  COACH_BITES: 3,         // no pull until the cut has this many bites (learn the saw first)
});

/** Small seeded RNG so a run (and a test) is repeatable. @param {number} seed */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TreePull {
  /** @param {number} [seed] */
  constructor(seed = Date.now()) {
    this.rng = mulberry32(seed);
    this.value = 0;
    this.side = this.rng() < 0.5 ? -1 : 1;
    this.from = 0;
    this.to = this._strength() * this.side;
    this.t = 0;
    this.holdMs = this._hold();
  }

  _strength() { return PULL.MIN + (PULL.MAX - PULL.MIN) * this.rng(); }
  _hold() { return PULL.EVERY_MS[0] + (PULL.EVERY_MS[1] - PULL.EVERY_MS[0]) * this.rng(); }

  /** Advance the pull. @param {number} dtMs @returns {number} the pull, -1..1 (+ = toward the privy side) */
  step(dtMs) {
    this.t += Math.max(0, dtMs);
    const u = Math.min(1, this.t / PULL.EASE_MS);
    const ease = u * u * (3 - 2 * u);
    this.value = this.from + (this.to - this.from) * ease;
    if (this.t >= this.holdMs) {
      if (this.rng() < PULL.FLIP) this.side = -this.side;
      this.from = this.value;
      this.to = this._strength() * this.side;
      this.t = 0;
      this.holdMs = this._hold();
    }
    return this.value;
  }
}

/**
 * The roll a keyboard or touch seat steers with: its input plus the pull.
 * @param {number} input -1..1 (keys: -1, 0 or +1; touch: the thumb on the steer pad)
 * @param {number} pull the tree's pull, -1..1
 */
export function keysRoll(input, pull) {
  return Math.max(-1, Math.min(1, input + pull));
}
