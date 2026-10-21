// @ts-check
// ============================================================
// saw-model — Old Misery, the two-person crosscut saw (PLAN §4.3)
// ============================================================
//
// Pure: no DOM, no clock. The host feeds both handles' stroke positions at
// one matched time; this returns what the saw did.
//
//   p ∈ [-1, +1] per seat, +1 = pulled to that sawyer's belly.
//   s = (pA - pB) / 2   saw position (drawn), +1 = at A's end
//   e = (pA + pB) / 2   blade strain: <0 compression (push), >0 tension (tug)
//
// One bite per completed stroke (each time s reverses after enough travel),
// only if |e| stayed under the green line the whole stroke and the stroke
// wasn't faster than the beat allows (chatter). Past the red line the saw
// throws a tantrum: the stroke is lost, nothing else is taken.
// ============================================================

export const SAW = Object.freeze({
  /** |e| under this cuts. Below 0.5, so one person sawing alone always binds.
   *  0.40 ≈ the pair may drift ±80 ms apart at 96 BPM (first guess; the
   *  phone spike tunes it, docs/PLAYTEST.md). */
  GREEN: 0.4,
  /** Strain must stay past the green line this long to spoil a stroke, so a
   *  one-sample sensor glitch can't (a real push lasts far longer). */
  BIND_MS: 50,
  /** |e| past this throws a tantrum. */
  RED: 0.8,
  /** s must travel at least this far (of 2.0 end to end) for a reversal to count as a stroke. */
  MIN_TRAVEL: 1.0,
  /** A reversal of less than this (in s) is jitter, not a new direction. */
  REVERSE_HYST: 0.06,
  /** Strokes shorter than this fraction of a beat chatter: teeth skip, no bite. */
  CHATTER_FRAC: 0.55,
  /** After a tantrum the blade bucks for this long; nothing counts. */
  TANTRUM_COOLDOWN_MS: 900,
});

/** @typedef {'A'|'B'} Seat */

/**
 * @typedef {object} SawState
 * @property {number} s
 * @property {number} e
 * @property {1|-1|0} dir            current travel direction of s
 * @property {number} extreme         furthest s reached in the current direction
 * @property {number} strokeStartT
 * @property {number} strokeStartS
 * @property {number} strokeMaxE      max |e| this stroke
 * @property {number} strokeMaxESigned  e at that max
 * @property {number} overSince       when |e| last went past the green line (NaN if under)
 * @property {boolean} strokeSpoiled   a tantrum happened this stroke
 * @property {number} cooldownUntil
 * @property {number} bites
 * @property {number} strokes
 * @property {number} streak          clean bites in a row
 * @property {number} bestStreak
 * @property {number} tantrums
 * @property {number} chatters
 * @property {number} binds
 * @property {number} travelGood      saw travel with |e| under GREEN
 * @property {number} travelAll
 * @property {number} lastT
 * @property {{A:number,B:number}} blameTime  ms of strain attributed to each seat
 */

/** @returns {SawState} */
export function createSaw() {
  return {
    s: 0, e: 0, dir: 0, extreme: 0,
    strokeStartT: 0, strokeStartS: 0, strokeMaxE: 0, strokeMaxESigned: 0, strokeSpoiled: false, overSince: NaN,
    cooldownUntil: -Infinity,
    bites: 0, strokes: 0, streak: 0, bestStreak: 0, tantrums: 0, chatters: 0, binds: 0,
    travelGood: 0, travelAll: 0, lastT: NaN,
    blameTime: { A: 0, B: 0 },
  };
}

/**
 * Who is making the strain worse: the seat whose hand moves in the direction
 * that grows |e| (sign v = sign e). Both? The faster one. Pure.
 * @param {number} e @param {number} vA @param {number} vB
 * @returns {Seat|null}
 */
export function blameOf(e, vA, vB) {
  if (Math.abs(e) < 1e-6) return null;
  const sg = Math.sign(e);
  const a = Math.sign(vA) === sg ? Math.abs(vA) : 0;
  const b = Math.sign(vB) === sg ? Math.abs(vB) : 0;
  if (a === 0 && b === 0) return null;
  return a >= b ? 'A' : 'B';
}

/**
 * Who to mark for this strain: the plan's literal rule (PLAN §4.3), the hand
 * moving the way that makes the strain worse. Being off the beat is shown
 * separately, on the beat strip, not as blame.
 * @param {SawInput} input @param {number} pA @param {number} pB @param {number} e
 * @returns {Seat|null}
 */
export function whoStrains(input, pA, pB, e) {
  void pA; void pB;
  return blameOf(e, input.vA ?? 0, input.vB ?? 0);
}

/** @param {number} e @returns {'green'|'amber'|'red'} */
export function zoneOf(e) {
  const m = Math.abs(e);
  return m < SAW.GREEN ? 'green' : m < SAW.RED ? 'amber' : 'red';
}

/**
 * @typedef {object} SawInput
 * @property {number} t       matched host time, ms
 * @property {number} pA
 * @property {number} pB
 * @property {number} [vA]    stroke velocity, p per second (for blame)
 * @property {number} [vB]
 * @property {number} beatMs  current beat length (chatter threshold)
 * @property {number} [beatPos] beats since the song started (for the record)
 */

/**
 * @typedef {{type:'bite', t:number, streak:number}
 *   | {type:'chatter', t:number}
 *   | {type:'bind', t:number, kind:'push'|'tug'}
 *   | {type:'tantrum', t:number, kind:'push'|'tug', blame:Seat|null}
 *   | {type:'stroke', t:number, toward:Seat}} SawEvent
 */

/**
 * Advance the saw to input.t. Mutates `st`; returns the events of this step.
 * @param {SawState} st @param {SawInput} input @returns {SawEvent[]}
 */
export function stepSaw(st, input) {
  /** @type {SawEvent[]} */
  const ev = [];
  const pA = clamp1(input.pA), pB = clamp1(input.pB);
  const t = input.t;
  const s = (pA - pB) / 2;
  const e = (pA + pB) / 2;
  const first = !Number.isFinite(st.lastT);
  const dt = first ? 0 : Math.max(0, t - st.lastT);
  const ds = first ? 0 : s - st.s;
  st.lastT = t;
  st.s = s;
  st.e = e;
  if (first) {
    st.strokeStartT = t; st.strokeStartS = s; st.extreme = s;
    return ev;
  }

  const cooling = t < st.cooldownUntil;
  const absE = Math.abs(e);

  // Temper bookkeeping: share of saw travel inside the green line.
  if (!cooling) {
    st.travelAll += Math.abs(ds);
    if (absE < SAW.GREEN) st.travelGood += Math.abs(ds);
  }
  const who = absE >= SAW.GREEN ? whoStrains(input, pA, pB, e) : null;
  if (who && dt > 0) {
    if (who) st.blameTime[who] += dt;
  }

  // Worst sustained strain this stroke: past the green line for BIND_MS.
  if (absE >= SAW.GREEN) {
    if (!Number.isFinite(st.overSince)) st.overSince = t;
    if (t - st.overSince >= SAW.BIND_MS && absE > st.strokeMaxE) { st.strokeMaxE = absE; st.strokeMaxESigned = e; }
  } else {
    st.overSince = NaN;
    if (absE > st.strokeMaxE) { st.strokeMaxE = absE; st.strokeMaxESigned = e; }
  }

  // Tantrum: crossing the red line, once per cooldown.
  if (absE >= SAW.RED && !cooling) {
    st.tantrums++;
    st.streak = 0;
    st.strokeSpoiled = true;
    st.cooldownUntil = t + SAW.TANTRUM_COOLDOWN_MS;
    ev.push({ type: 'tantrum', t, kind: e < 0 ? 'push' : 'tug', blame: whoStrains(input, pA, pB, e) });
  }

  // Direction tracking with hysteresis. A stroke completes on reversal.
  if (st.dir === 0) {
    if (Math.abs(s - st.strokeStartS) > SAW.REVERSE_HYST) {
      st.dir = s > st.strokeStartS ? 1 : -1;
      st.extreme = s;
    }
  } else if (st.dir === 1) {
    if (s > st.extreme) st.extreme = s;
    else if (st.extreme - s > SAW.REVERSE_HYST) completeStroke(st, t, input.beatMs, ev, -1, s);
  } else {
    if (s < st.extreme) st.extreme = s;
    else if (s - st.extreme > SAW.REVERSE_HYST) completeStroke(st, t, input.beatMs, ev, 1, s);
  }
  return ev;
}

/**
 * The stroke that just ended ran from strokeStartS to st.extreme.
 * @param {SawState} st @param {number} t @param {number} beatMs
 * @param {SawEvent[]} ev @param {1|-1} newDir @param {number} s
 */
function completeStroke(st, t, beatMs, ev, newDir, s) {
  const travel = Math.abs(st.extreme - st.strokeStartS);
  const endedAt = st.extreme;
  if (travel >= SAW.MIN_TRAVEL) {
    st.strokes++;
    const duration = t - st.strokeStartT;
    const cooling = t < st.cooldownUntil;
    ev.push({ type: 'stroke', t, toward: st.dir === 1 ? 'A' : 'B' });
    if (st.strokeSpoiled || cooling) {
      // Lost to the tantrum: already reported.
    } else if (duration < SAW.CHATTER_FRAC * beatMs) {
      st.chatters++;
      st.streak = 0;
      ev.push({ type: 'chatter', t });
    } else if (st.strokeMaxE >= SAW.GREEN) {
      st.binds++;
      st.streak = 0;
      ev.push({ type: 'bind', t, kind: st.strokeMaxESigned < 0 ? 'push' : 'tug' });
    } else {
      st.bites++;
      st.streak++;
      if (st.streak > st.bestStreak) st.bestStreak = st.streak;
      ev.push({ type: 'bite', t, streak: st.streak });
    }
    // Next stroke starts at the turnaround.
    st.strokeStartT = t;
    st.strokeStartS = endedAt;
    st.strokeMaxE = Math.abs(st.e);
    st.strokeMaxESigned = st.e;
    st.strokeSpoiled = false;
  }
  // Too short to be a stroke: the saw still turned around here, so the next
  // stroke is measured from this turnaround if it went past the old start.
  else if ((newDir === -1 && endedAt > st.strokeStartS) || (newDir === 1 && endedAt < st.strokeStartS)) {
    st.strokeStartS = endedAt;
    st.strokeStartT = t;
  }
  st.dir = newDir;
  st.extreme = s;
}

/** Temper 0–100: % of saw travel inside the green line. */
export function temperOf(st) {
  if (st.travelAll < 1e-6) return 100;
  return Math.round((100 * st.travelGood) / st.travelAll);
}

function clamp1(x) {
  return x > 1 ? 1 : x < -1 ? -1 : Number.isFinite(x) ? x : 0;
}

// ------------------------------------------------------------
// The beat and Grandma
// ------------------------------------------------------------

/**
 * The saw path a perfect pair traces: one stroke per beat, A pulled on odd
 * beats (s = +1 at beatPos 1, 3, …), B on even beats.
 * @param {number} beatPos  beats since the song started (fractional)
 */
export function targetS(beatPos) {
  return -Math.cos(Math.PI * beatPos);
}

/** d(targetS)/dt in s per ms. */
export function targetSVel(beatPos, beatMs) {
  return (Math.PI / beatMs) * Math.sin(Math.PI * beatPos);
}

/**
 * Grandma on the far handle: exactly on the beat, never pushes. Since a
 * perfect pair has pA = s* and pB = -s*, she holds pB = -s*, so any strain
 * is the player's (PLAN §8.1).
 * @param {number} beatPos @param {number} beatMs
 * @returns {{p:number, v:number}}  v in p per second
 */
export function grandmaHandle(beatPos, beatMs) {
  return { p: -targetS(beatPos), v: -targetSVel(beatPos, beatMs) * 1000 };
}
