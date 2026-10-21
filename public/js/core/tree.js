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
  { id: 'small', kind: 'small', name: 'Small pine', bites: 14, notchSteps: 6, targetDeg: 8 },
  { id: 'big', kind: 'big', name: 'Big pine', bites: 24, notchSteps: 8, targetDeg: -12 },
]);

/** Past this, the tree lands on Grandma's privy (B's side, +x). */
export const PRIVY_DEG = 18;

/**
 * @typedef {object} CutState
 * @property {number} needed
 * @property {number} bites
 * @property {number} leanSum
 * @property {number} lean      live blade lean -1..1 (average of both twists)
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

/** @param {CutState} cut @param {number} lean */
export function cutBite(cut, lean) {
  if (cut.bites >= cut.needed) return true;
  cut.bites++;
  cut.leanSum += lean;
  return cut.bites >= cut.needed;
}

/** Where the tree will fall if the cut finished now, degrees. Live preview blends in the current lean. */
export function fallAngle(cut, liveLean = cut.lean) {
  const n = cut.bites;
  const avg = n > 0 ? (cut.leanSum + liveLean) / (n + 1) : liveLean;
  return avg * MAX_FALL_DEG;
}

/** @param {CutState} cut */
export const cutFrac = (cut) => Math.min(1, cut.bites / cut.needed);

/**
 * @param {number} angleDeg @param {number} targetDeg
 * @returns {{grade:'skid'|'close'|'wide'|'privy', offDeg:number, stars:number}}
 */
export function landing(angleDeg, targetDeg) {
  const off = Math.abs(angleDeg - targetDeg);
  if (angleDeg >= PRIVY_DEG && targetDeg < PRIVY_DEG - 6) return { grade: 'privy', offDeg: off, stars: 1 };
  if (off <= 4) return { grade: 'skid', offDeg: off, stars: 3 };
  if (off <= 10) return { grade: 'close', offDeg: off, stars: 2 };
  return { grade: 'wide', offDeg: off, stars: 1 };
}
