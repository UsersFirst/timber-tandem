// @ts-check
// ============================================================
// tantrum — Old Misery throws a fit (PLAN §4.3: "the blade bucks, the wood
// squeals, sawdust spits, and the saw grumbles a line")
// ============================================================
// The beats, about 1.4 s, readable from the sofa:
//   0.00  SNAP    the blade buckles (push) or twangs (tug), jumps out of the
//                 kerf, glows red-hot; sawdust spits; the camera kicks.
//   0.05  CURSE   Old Misery's grawlix bubble pops over the blade; steam
//                 jets from both handles like a kettle.
//   0.00  RECOIL  push: the pusher is kicked back — head whipped, hop, hat
//                 off, feathers up, one wing loses the handle and flaps.
//                 tug: both are yanked in toward the trunk, then rock back.
//   0.35  TAKE    the partner turns to the camera, deadpan (Grandma tuts
//                 and shakes her head instead).
//   0.60  SHAKE   the blamed goose shakes it off; a puff of steam from its head.
//   1.20  SETTLE  hat lands, wing back on the handle, everyone back to work.
// The saw model's 900 ms cooldown runs underneath; nothing here blocks play.
// ============================================================

import * as THREE from 'three';
import { softSprite } from './environment.js';

/** @typedef {'A'|'B'} Seat */

const CURSES = ['#@%!', '&*$#!', '@#!!', '%$#@&!', 'GRRR!', '#!@?!'];

/** Old Misery's speech burst: a jagged white star with a grawlix in it. @param {string} text @param {number} [dir] */
function burstTexture(text, dir = 0) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 320;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const cx = 256, cy = 160, n = 14;
  g.beginPath();
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? 0.74 : 1;
    const jitter = 0.9 + 0.1 * Math.sin(i * 12.9898);
    g.lineTo(cx + Math.cos(a) * 240 * r * jitter, cy + Math.sin(a) * 150 * r * jitter);
  }
  g.closePath();
  // A tail down toward the goose who caused it (dir −1 left, +1 right).
  if (dir) {
    g.moveTo(cx + dir * 70, cy + 95);
    g.lineTo(cx + dir * 215, cy + 158);
    g.lineTo(cx + dir * 125, cy + 72);
    g.closePath();
  }
  g.fillStyle = '#fff6e0';
  g.strokeStyle = '#2a1508';
  g.lineWidth = 14;
  g.lineJoin = 'round';
  g.fill();
  g.stroke();
  g.font = '900 104px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = '#2a1508';
  g.strokeText(text, cx, cy + 6);
  g.fillStyle = '#e8321e';
  g.fillText(text, cx, cy + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Steam puffs (sprites, so each can grow and fade on its own) and the curse bubble. */
export class TantrumFx {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    const tex = softSprite();
    /** @type {{s: THREE.Sprite, v: THREE.Vector3, life: number, max: number, size: number}[]} */
    this.steam = [];
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xf4f1ea, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false;
      s.renderOrder = 5;
      scene.add(s);
      this.steam.push({ s, v: new THREE.Vector3(), life: 0, max: 1, size: 0.3 });
    }
    this.next = 0;
    /** @type {Map<string, THREE.CanvasTexture>} */
    this.tex = new Map();
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
    this.bubble.renderOrder = 20;
    this.bubble.visible = false;
    scene.add(this.bubble);
    this.bub = { t: 0, dur: 0, size: 0.62, at: new THREE.Vector3(), curse: 0 };
  }

  /** @param {THREE.Vector3} at @param {THREE.Vector3} dir @param {{n?:number, speed?:number, size?:number, life?:number}} [o] */
  jet(at, dir, o = {}) {
    const n = o.n ?? 5;
    for (let k = 0; k < n; k++) {
      const p = this.steam[this.next];
      this.next = (this.next + 1) % this.steam.length;
      const sp = (o.speed ?? 1.4) * (0.7 + Math.random() * 0.6);
      p.v.copy(dir).normalize().multiplyScalar(sp).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.3, (Math.random() - 0.5) * 0.4));
      p.s.position.copy(at).addScaledVector(p.v, 0.02 * k);
      p.max = (o.life ?? 0.9) * (0.7 + Math.random() * 0.5);
      p.life = p.max;
      p.size = (o.size ?? 0.32) * (0.7 + Math.random() * 0.6);
      p.s.visible = true;
    }
  }

  /** Pop the curse bubble. @param {THREE.Vector3} at @param {number} [dir] tail toward the blamed side (−1, 0, 1) @param {boolean} [small] */
  curse(at, dir = 0, small = false) {
    const text = CURSES[this.bub.curse++ % CURSES.length];
    const key = text + dir;
    if (!this.tex.has(key)) this.tex.set(key, burstTexture(text, dir));
    const m = /** @type {THREE.SpriteMaterial} */ (this.bubble.material);
    m.map = /** @type {THREE.CanvasTexture} */ (this.tex.get(key));
    m.needsUpdate = true;
    this.bub.t = 0;
    this.bub.dur = small ? 0.6 : 0.85;
    this.bub.size = small ? 0.45 : 0.62;
    this.bub.at.copy(at);
    this.bubble.visible = true;
  }

  /** @param {number} dt */
  update(dt) {
    for (const p of this.steam) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.v.multiplyScalar(1 - dt * 2.2);
      p.v.y += dt * 0.6;
      p.s.position.addScaledVector(p.v, dt);
      const k = 1 - p.life / p.max;
      p.s.scale.setScalar(p.size * (0.35 + 1.2 * k));
      /** @type {THREE.SpriteMaterial} */ (p.s.material).opacity = 0.85 * Math.min(1, k * 6) * (1 - k);
    }
    const b = this.bub;
    if (this.bubble.visible) {
      b.t += dt;
      const t = b.t;
      if (t >= b.dur) { this.bubble.visible = false; return; }
      // Pop with an overshoot, a tremble while it holds, then shrink away.
      const pop = t < 0.14 ? easeOutBack(t / 0.14) : 1;
      const out = t > b.dur - 0.18 ? Math.max(0, (b.dur - t) / 0.18) : 1;
      // Trembles with rage, calming as it goes.
      const rage = Math.max(0, 1 - t / b.dur);
      const tremble = 1 + 0.06 * rage * Math.sin(t * 60);
      const s = b.size * pop * out * tremble;
      this.bubble.scale.set(s * 1.6, s, 1);
      this.bubble.position.copy(b.at).add(new THREE.Vector3(Math.sin(t * 47) * 0.02 * rage, t * 0.12 + Math.sin(t * 53) * 0.012 * rage, 0));
      /** @type {THREE.SpriteMaterial} */ (this.bubble.material).rotation = Math.sin(t * 31) * 0.05;
    }
  }
}

function easeOutBack(x) {
  const c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/**
 * @typedef {object} TantrumStage
 * @property {{A: import('./geese.js').Goose|null, B: import('./geese.js').Goose|null}} geese
 * @property {{A: string|null, B: string|null}} cast
 * @property {(atSec: number, fn: () => void) => void} later   run fn this many seconds from now (scene time)
 * @property {(seat: Seat, sec: number) => void} flail          the seat's far hand lets go of the handle and flaps
 * @property {(amount: number) => void} kickCamera
 */

/**
 * The geese's side of a tantrum. The saw and the fx are kicked by the scene.
 * @param {TantrumStage} st @param {Seat|null} blame @param {'push'|'tug'} kind @param {boolean} [small] a repeat: a smaller take
 */
export function geeseTantrum(st, blame, kind, small = false) {
  const seats = /** @type {Seat[]} */ (['A', 'B']);
  // Which way the camera is for each goose, in its own frame (A faces +x,
  // so the camera at +z is on its right; B faces −x, camera on its left).
  const toCam = { A: -1, B: 1 };
  const hit = blame ? [blame] : seats;
  const other = blame ? (blame === 'A' ? 'B' : 'A') : null;

  for (const seat of seats) {
    const g = st.geese[seat];
    if (!g) continue;
    const R = g.react;
    const isHit = hit.includes(seat);
    // Back-to-back tantrums get a smaller take, so a rough patch stays funny.
    const k = (isHit ? 1 : 0.45) * (small ? 0.6 : 1);
    const grandma = st.cast[seat] === 'grandma';
    if (kind === 'push') {
      // The pusher is kicked back by the buckling blade; the partner flinches.
      R.lean.kick(-13 * k);
      R.neck.kick(-20 * k);
      R.shove.kick(-2.3 * k);
      R.hop.kick(1.4 * k);
    } else {
      // A tug: both were hauling back, heels dug in. The blade twangs and
      // yanks them both forward toward the trunk; the springs rock them back.
      R.lean.nudge(-0.3 * k);
      R.shove.nudge(-0.06 * k);
      st.later(0.07, () => { R.lean.kick(15 * k); R.neck.kick(20 * k); R.shove.kick(2.4 * k); R.hop.kick(0.8 * k); });
    }
    R.fluff.nudge(0.16 * k);
    R.tail.kick(22 * k * (seat === 'A' ? 1 : -1));
    R.tilt.kick((seat === 'A' ? 4 : -4) * k);
    if ((!grandma || isHit) && !small) {
      g.popHat(isHit ? 2.7 : 1.5);
      R.hatSpin.kick((seat === 'A' ? 9 : -9) * k);
    }
    if (kind === 'tug' && !grandma) {
      // A tug-of-war: nobody lets go. Yanked in, snapped back, then a honking
      // match across the saw (they face each other: beaks forward and down).
      R.jaw.target = 0.7;
      st.later(0.25, () => { R.jaw.target = 0; });
      st.later(0.42, () => { R.neck.target = 0.28; R.lean.target = 0.12; R.jaw.target = 1; R.fluff.nudge(0.08); });
      st.later(0.56, () => { R.jaw.target = 0.1; });
      st.later(0.66, () => { R.jaw.target = 1; R.neck.kick(2); });
      st.later(0.8, () => { R.jaw.target = 0; });
      st.later(1.05, () => { R.neck.target = 0; R.lean.target = 0; });
    } else if (isHit) {
      // SQUAWK, and one wing loses the handle.
      R.jaw.target = 1;
      st.later(0.42, () => { R.jaw.target = 0; });
      st.flail(seat, small ? 0.45 : 0.6);
      // Shake it off.
      st.later(0.5, () => R.look.kick(11));
      st.later(0.61, () => R.look.kick(-19));
      st.later(0.72, () => R.look.kick(15));
      st.later(0.83, () => R.look.kick(-7));
    } else if (small) {
      // A repeat: just a weary flinch.
    } else if (grandma) {
      // Grandma doesn't flap. She draws herself up, peers over her
      // spectacles (head down, tilted) and shakes her head: tut-tut.
      st.later(0.3, () => { R.lean.target = -0.12; R.neck.target = 0.32; R.tilt.target = 0.22 * toCam[seat]; });
      st.later(0.45, () => R.look.kick(8));
      st.later(0.7, () => R.look.kick(-14));
      st.later(0.95, () => R.look.kick(12));
      st.later(1.2, () => R.look.kick(-6));
      st.later(1.3, () => { R.lean.target = 0; R.neck.target = 0; R.tilt.target = 0; });
    } else {
      // The take to camera: a flat look at the audience, chin tucked,
      // head cocked, one dry honk.
      st.later(0.3, () => { R.look.target = 1.05 * toCam[seat]; R.neck.target = -0.18; R.lean.target = -0.08; R.tilt.target = -0.18 * toCam[seat]; });
      st.later(0.42, () => { R.jaw.target = 0.4; });
      st.later(0.58, () => { R.jaw.target = 0; });
      st.later(1.1, () => { R.look.target = 0; R.neck.target = 0; R.lean.target = 0; R.tilt.target = 0; });
    }
  }
  void other;
  st.kickCamera((kind === 'push' ? 1 : 0.8) * (small ? 0.5 : 1));
}
