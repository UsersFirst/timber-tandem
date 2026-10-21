// @ts-check
// Tiny 3-vector helpers on plain arrays. Pure.

/** @typedef {[number, number, number]} Vec3 */

/** @param {Vec3} a @param {Vec3} b */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** @param {Vec3} a */
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
/** @param {Vec3} a @param {number} k @returns {Vec3} */
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** @param {Vec3} a @returns {Vec3} */
export function norm(a) {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/**
 * Principal axis of a set of vectors (largest-eigenvalue eigenvector of the
 * covariance), by power iteration. Sign is arbitrary. Pure.
 * @param {Vec3[]} pts @returns {{axis: Vec3, share: number}}  share = λ1 / trace
 */
export function principalAxis(pts) {
  if (!pts.length) return { axis: [0, 1, 0], share: 0 };
  const m = [0, 0, 0];
  for (const p of pts) { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; }
  m[0] /= pts.length; m[1] /= pts.length; m[2] /= pts.length;
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const d = [p[0] - m[0], p[1] - m[1], p[2] - m[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += d[i] * d[j];
  }
  /** @type {Vec3} */
  let v = [0.577, 0.577, 0.577];
  let lambda = 0;
  for (let it = 0; it < 60; it++) {
    /** @type {Vec3} */
    const w = [
      c[0][0] * v[0] + c[0][1] * v[1] + c[0][2] * v[2],
      c[1][0] * v[0] + c[1][1] * v[1] + c[1][2] * v[2],
      c[2][0] * v[0] + c[2][1] * v[1] + c[2][2] * v[2],
    ];
    lambda = len(w);
    if (lambda < 1e-12) break;
    v = scale(w, 1 / lambda);
  }
  const trace = c[0][0] + c[1][1] + c[2][2];
  return { axis: v, share: trace > 1e-12 ? lambda / trace : 0 };
}

/**
 * Signed angle (radians) from a to b around `axis`, after projecting both onto
 * the plane perpendicular to it. Pure.
 * @param {Vec3} a @param {Vec3} b @param {Vec3} axis
 */
export function signedAngleAround(a, b, axis) {
  const pa = sub(a, scale(axis, dot(a, axis)));
  const pb = sub(b, scale(axis, dot(b, axis)));
  if (len(pa) < 1e-6 || len(pb) < 1e-6) return 0;
  return Math.atan2(dot(axis, cross(pa, pb)), dot(pa, pb));
}
