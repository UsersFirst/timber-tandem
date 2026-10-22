// @ts-check
// ============================================================
// tree — the trees of the toy, the back cut, steering and the landing (PLAN §4.4)
// ============================================================
// Pure. Each bite records the blade's lean at that moment; the cut's
// direction is the average lean over the bites, so twisting together steers
// the fall, and opposite twists cancel. The landing is scored against the
// skid's angle.
// ============================================================

/** Lean of 1.0 aims the fall this far off straight, degrees. */
export const MAX_FALL_DEG = 25;

export const TREES = Object.freeze([
  // A clean pair takes ~25 s / ~40 s of back cut at 96 BPM; real pairs bind
  // and tantrum along the way, landing near the plan's 60–90 s (PLAN §13.2).
  { id: 'small', kind: 'small', name: 'Small pine', bites: 40, notchSteps: 6, targetDeg: 8 },
  { id: 'big', kind: 'big', name: 'Big pine', bites: 64, notchSteps: 8, targetDeg: -12 },
]);

/** Past this, the tree lands on Grandma's privy (B's side, +x). */
export const PRIVY_DEG = 18;

/**
 * @typedef {object} CutState
 * @property {number} needed
 * @property {number} bites
 * @property {number} leanSum
 * @property {number} lean      live blade lean -1..1 (average of both twists)
 * @property {number[]} [recent] lean at the last few bites
 */

/** @param {number} needed @returns {CutState} */
export function createCut(needed) {
  return { needed, bites: 0, leanSum: 0, lean: 0 };
}

/**
 * The blade leans by the average of the two twists (PLAN §4.4).
 * @param {number} rollA -1..1 @param {number} rollB -1..1
 */
export function bladeLean(rollA, rollB) {
  return Math.max(-1, Math.min(1, (rollA + rollB) / 2));
}

/**
 * The blade's lean for this pair. Grandma follows her partner's twist (Pete,
 * 2026-10-22: solo steers at full strength), so a seat she holds copies the
 * other seat's roll before the two are averaged.
 * @param {number} rollA @param {number} rollB @param {'A'|'B'|null} [grandma] the seat Grandma holds
 */
export function steerLean(rollA, rollB, grandma = null) {
  if (grandma === 'A') return bladeLean(rollB, rollB);
  if (grandma === 'B') return bladeLean(rollA, rollA);
  return bladeLean(rollA, rollB);
}

/** @param {CutState} cut @param {number} lean */
export function cutBite(cut, lean) {
  if (cut.bites >= cut.needed) return true;
  cut.bites++;
  cut.leanSum += lean;
  cut.recent = [...(cut.recent || []), lean].slice(-AIM_BITES);
  return cut.bites >= cut.needed;
}

/** The fall follows the blade's lean as the cut nears the hinge: the last few bites. */
export const AIM_BITES = 4;

/**
 * Where the tree will fall if the cut finished now, degrees: the lean over the
 * last few bites plus the live lean, so a twist shows on the aim at once.
 */
export function fallAngle(cut, liveLean = cut.lean) {
  const recent = cut.recent || [];
  const all = [...recent, liveLean];
  return (all.reduce((a, b) => a + b, 0) / all.length) * MAX_FALL_DEG;
}

/** @param {CutState} cut */
export const cutFrac = (cut) => Math.min(1, cut.bites / cut.needed);

/**
 * @param {number} angleDeg @param {number} targetDeg
 * @returns {{grade:'skid'|'close'|'wide'|'privy', offDeg:number}}
 */
export function landing(angleDeg, targetDeg) {
  const off = Math.abs(angleDeg - targetDeg);
  if (angleDeg >= PRIVY_DEG && targetDeg < PRIVY_DEG - 6) return { grade: 'privy', offDeg: off };
  if (off <= 4) return { grade: 'skid', offDeg: off };
  if (off <= 10) return { grade: 'close', offDeg: off };
  return { grade: 'wide', offDeg: off };
}
