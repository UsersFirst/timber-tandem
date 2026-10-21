// @ts-check
// ============================================================
// sim — a pretend sawyer for headless tests and desktop dev (?sim=...)
// ============================================================
// Generates RawMotion as if a person held this phone in a fist grip:
//   ?sim=good        saws on the beat as this seat should
//   ?sim=lag:150     saws 150 ms behind the beat (calibration absorbs this)
//   ?sim=late:260    on the beat while calibrating, 260 ms late while playing
//   ?sim=fast        saws at twice the beat (waggle; should chatter)
//   ?sim=still       never moves
// Optional &steer=0.4 twists the fist (steering), &amp=0.12 stroke size (m).
// It follows what the host asks for: holds still for calib-rest, makes one
// pull for calib-pull, twists right for calib-twist, chops for calib-chop and
// on its turn in the notch.
// ============================================================

import { targetS } from '../core/saw-model.js';

/** @typedef {import('./motion.js').RawMotion} RawMotion */

const G = 9.81;

export class SimSawyer {
  /** @param {string} spec @param {URLSearchParams} params @param {number} seat */
  constructor(spec, params, seat) {
    const [kind, arg] = spec.split(':');
    this.kind = kind || 'good';
    this.lagMs = kind === 'lag' || kind === 'late' ? Number(arg) || 120 : 0;
    this.steer = Number(params.get('steer') || 0);
    this.amp = Number(params.get('amp') || 0.12);
    this.seat = seat;
    this.mode = 'lobby';
    this.modeAt = 0;
    /** @type {{startH:number, bpm:number}|null} */
    this.song = null;
    this.chopAt = [];          // local ms of chops to perform
    this.toHost = (t) => t;    // set by the app (clock sync)
    this.pullDone = false;
    this._timer = 0;
  }

  /** @param {(m: RawMotion) => void} onSample */
  start(onSample) {
    const tick = () => {
      const t = performance.now();
      onSample(this.sample(t));
    };
    this._timer = /** @type {any} */ (setInterval(tick, 1000 / 60));
  }

  stop() { clearInterval(this._timer); }

  /** @param {string} mode @param {any} [info] */
  setMode(mode, info) {
    this.mode = mode;
    this.modeAt = performance.now();
    if (info?.song) this.song = info.song;
    if (mode === 'calib-chop') {
      const t0 = this.modeAt + 600;
      this.chopAt = [t0, t0 + 700, t0 + 1400, t0 + 2100];
    }
    if (mode === 'calib-pull') this.pullDone = false;
  }

  /** The host says it's our turn on the notch. */
  myTurn() {
    if (this.kind === 'still') return;
    this.chopAt.push(performance.now() + 250 + 100 * Math.random());
  }

  /** Stroke position this seat should hold at local time t (before lag). */
  _p(t) {
    const bpm = this.song?.bpm || 96;
    const beatMs = 60000 / bpm;
    const startLocal = this.song ? this.song.startH - (this.toHost(0)) : 0;
    const lag = this.kind === 'late' && this.mode !== 'saw' ? 0 : this.lagMs;
    let bp = (t - lag - startLocal) / beatMs;
    if (this.kind === 'fast') bp *= 2;
    const s = targetS(bp);
    return this.seat === 1 ? s : -s;
  }

  /** @param {number} t @returns {RawMotion} */
  sample(t) {
    const noise = () => (Math.random() - 0.5) * 0.12;
    /** @type {[number,number,number]} */
    let a = [noise(), noise(), noise()];
    /** @type {[number,number,number]} */
    let r = [noise() * 20, noise() * 20, noise() * 20];
    let roll = 0;
    const m = this.mode;
    const since = t - this.modeAt;
    const sawing = (m === 'saw' || m === 'calib-saw' || m === 'lobby' && false) && this.kind !== 'still';
    if (sawing) {
      // position along the pull = (amp/2)·p; the pull is toward the phone's -y
      const h = 8;
      const x = (k) => (this.amp / 2) * this._p(t + k);
      const acc = ((x(h) - 2 * x(0) + x(-h)) / (h * h)) * 1e6;
      a = [noise(), -acc + noise(), noise()];
      roll = m === 'saw' ? this.steer * 30 : 0;
    } else if (m === 'calib-pull' && this.kind !== 'still' && since > 500 && since < 1300) {
      // one deliberate pull: speed up toward the belly, then brake
      const u = (since - 500) / 800;
      a = [noise(), -6 * Math.sin(2 * Math.PI * u), noise()];
    } else if (m === 'calib-twist' && this.kind !== 'still') {
      roll = since > 400 ? Math.min(24, (since - 400) / 20) : 0;
    }
    // chops: a rotation bell about the device x axis, then a recoil
    for (const c of this.chopAt) {
      const dt = t - c;
      if (dt >= 0 && dt < 120) r = [420 * Math.sin((Math.PI * dt) / 120), noise() * 10, noise() * 10];
      else if (dt >= 140 && dt < 240) r = [-200 * Math.sin((Math.PI * (dt - 140)) / 100), noise() * 10, noise() * 10];
    }
    this.chopAt = this.chopAt.filter((c) => t - c < 400);
    // gravity: screen up (+z) at rest, twisted about the stroke axis (y)
    const rr = (roll * Math.PI) / 180;
    /** @type {[number,number,number]} */
    const g = [G * Math.sin(rr), 0, G * Math.cos(rr)];
    return { t, a, g, r };
  }
}
