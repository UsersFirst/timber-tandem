// @ts-check
// ============================================================
// notch — the alternating hatchet notch (PLAN §5)
// ============================================================
// Pure. Two faces of the notch: A chops the left face, B the right. Turns
// alternate and the lit face is the one that bites: a good hit on your lit
// face opens the notch a step and lights your partner's face. A hit out of
// turn only chips (you see it, no progress). A soft hit glances. Both
// hitting at the same moment is a comic clang. Spamming does nothing.
// ============================================================

/** @typedef {'A'|'B'} Seat */

export const NOTCH = Object.freeze({
  /** Hits within this window of each other, by both, clang. */
  CLANG_MS: 120,
});

/**
 * @typedef {object} NotchState
 * @property {number} steps      needed
 * @property {number} done
 * @property {Seat} lit
 * @property {{A:number,B:number}} lastHit
 * @property {{A:number,B:number}} good
 * @property {number} chips
 * @property {number} clangs
 */

/** @param {number} steps @param {Seat} [first] @returns {NotchState} */
export function createNotch(steps, first = 'A') {
  return { steps, done: 0, lit: first, lastHit: { A: -Infinity, B: -Infinity }, good: { A: 0, B: 0 }, chips: 0, clangs: 0 };
}

/**
 * @param {NotchState} st @param {Seat} seat @param {number} t
 * @param {'soft'|'good'|'strong'} grade
 * @returns {{kind:'open'|'chip'|'glance'|'clang'|'done', seat:Seat, lit:Seat}}
 */
export function notchHit(st, seat, t, grade) {
  const other = seat === 'A' ? 'B' : 'A';
  const clang = Math.abs(t - st.lastHit[other]) < NOTCH.CLANG_MS;
  st.lastHit[seat] = t;
  if (st.done >= st.steps) return { kind: 'chip', seat, lit: st.lit };
  if (clang) { st.clangs++; return { kind: 'clang', seat, lit: st.lit }; }
  if (seat !== st.lit) { st.chips++; return { kind: 'chip', seat, lit: st.lit }; }
  if (grade === 'soft') return { kind: 'glance', seat, lit: st.lit };
  st.done++;
  st.good[seat]++;
  st.lit = other;
  return { kind: st.done >= st.steps ? 'done' : 'open', seat, lit: st.lit };
}

/** @param {NotchState} st */
export const notchFrac = (st) => Math.min(1, st.done / st.steps);
