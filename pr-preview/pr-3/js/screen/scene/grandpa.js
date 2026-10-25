// @ts-check
// ============================================================
// grandpa — Grandpa Chaos in his rocking chair, watching
// ============================================================
//
// His knees are done (PLAN §5), so he watches from a rocking chair at the
// edge of the clearing, out of every fall's path. He rocks, follows the saw
// with his head, shakes it at a tantrum, leans in when the tree goes, and
// throws his wings up when it lands. Not a player.
// He talks in a speech bubble (the game picks the lines; hud.js draws it).
// Grandma watches beside him when she isn't on the saw (WatchingGrandma).
// ============================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGoose } from './geese.js';

/** Where the chair stands: left of the saw, behind the trunk, ≈66° off the fall line (falls stay within ≈37°). */
export const GRANDPA_SPOT = { x: -2.9, z: -1.3 };
const SEAT_Y = 0.27;
/** Radius of the runners' curve (m): the rock rolls on it. */
const RUNNER_R = 1.1;

/** A low-poly rocking chair, one merged mesh, front = +z. */
function makeRockingChair() {
  /** @type {THREE.BufferGeometry[]} */
  const parts = [];
  const box = (w, h, d, x, y, z, rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1)));
    parts.push(g.toNonIndexed());
  };
  const W = 0.3; // half width between the side frames
  // Runners: an arc of the rocking circle, each side.
  for (const sx of [-W, W]) {
    const arc = new THREE.TorusGeometry(RUNNER_R, 0.022, 4, 14, 0.62);
    arc.rotateZ(-Math.PI / 2 - 0.31);
    arc.rotateY(Math.PI / 2);
    arc.translate(sx, RUNNER_R + 0.02, 0);
    parts.push(arc.toNonIndexed());
  }
  // Legs from the runners to the seat.
  for (const sx of [-W, W]) for (const sz of [-0.2, 0.2]) box(0.045, SEAT_Y - 0.03, 0.045, sx, (SEAT_Y + 0.03) / 2, sz);
  // Seat (with a plump cushion on it, painted separately below).
  box(W * 2 + 0.06, 0.04, 0.48, 0, SEAT_Y, 0);
  // Back: two posts and spindles, raked back.
  const rake = -0.2, bh = 0.78;
  const backAt = (y) => [-0.22 - Math.sin(-rake) * y, SEAT_Y + Math.cos(rake) * y];
  for (const sx of [-W + 0.02, W - 0.02]) { const [z, y] = backAt(bh / 2); box(0.05, bh, 0.05, sx, y, z, rake); }
  for (let i = 0; i < 5; i++) { const [z, y] = backAt(0.36); box(0.022, 0.6, 0.022, -0.2 + i * 0.1, y, z, rake); }
  { const [z, y] = backAt(bh); box(W * 2 + 0.06, 0.07, 0.05, 0, y, z, rake); }
  { const [z, y] = backAt(0.08); box(W * 2, 0.04, 0.04, 0, y, z, rake); }
  // Arm rests on front posts.
  for (const sx of [-W - 0.01, W + 0.01]) {
    box(0.07, 0.035, 0.5, sx, SEAT_Y + 0.24, -0.01);
    box(0.04, 0.24, 0.04, sx, SEAT_Y + 0.12, 0.2);
  }
  const wood = mergeGeometries(parts, false);
  const chair = new THREE.Group();
  const woodMesh = new THREE.Mesh(wood, new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.75 }));
  woodMesh.castShadow = true;
  chair.add(woodMesh);
  // A knitted cushion, Grandma's work.
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(W * 2 - 0.04, 0.06, 0.42), new THREE.MeshStandardMaterial({ color: 0x9c3d3d, roughness: 0.95 }));
  cushion.position.set(0, SEAT_Y + 0.045, 0.01);
  cushion.castShadow = true;
  chair.add(cushion);
  return chair;
}

const _v = new THREE.Vector3();

/**
 * Grandpa and his chair. Add `group` to the scene; call `update` each frame.
 */
export class Grandpa {
  /** @param {THREE.Scene} scene @param {(at: number, fn: () => void) => void} later run on the scene clock */
  constructor(scene, later) {
    this.later = later;
    /** Placed and turned to face the saw. */
    this.group = new THREE.Group();
    this.group.name = 'grandpa';
    this.group.position.set(GRANDPA_SPOT.x, 0, GRANDPA_SPOT.z);
    // Face a point between the saw and the camera, so he reads three-quarter on.
    this.group.rotation.y = Math.atan2(-0.4 - GRANDPA_SPOT.x, 1.4 - GRANDPA_SPOT.z);
    /** Pitches about the runners' contact (the rock). */
    this.rocker = new THREE.Group();
    this.group.add(this.rocker);
    this.rocker.add(makeRockingChair());
    scene.add(this.group);
    /** @type {import('./geese.js').Goose|null} */
    this.goose = null;
    this.t = Math.random() * 10;
    this.phase = 0;
    /** Rock amplitude (rad), eased toward its goal. */
    this.rock = 0.05;
    this.rockGoal = 0.05;
    this.rockRate = 0.55; // Hz
    /** Cheering until this time (s); the wings go up. */
    this.cheerUntil = -1;
    /** Leaning in to watch (the fall). */
    this.watch = false;
    this.ready = loadGoose('grandpa').then((g) => {
      this.goose = g;
      g.play('idle', { fade: 0.2 });
      g.sit.w = 1;
      g.sit.hipY = SEAT_Y + 0.11;
      g.sit.footZ = 0.27;
      this.rocker.add(g.root);
      return true;
    }).catch((err) => { console.warn('grandpa', err); return false; });
  }

  /** Shake the head at a tantrum, beak open (a heckle). */
  tantrum() {
    const g = this.goose;
    if (!g) return;
    const R = g.react;
    R.lean.kick(1.2);
    R.jaw.target = 0.5;
    [0.12, 0.26, 0.4, 0.54].forEach((t, i) => this.later(t, () => R.look.kick(i % 2 ? -7 : 7)));
    this.later(0.45, () => { R.jaw.target = 0; });
  }

  /** The tree's going: stop rocking and lean in. */
  fallStarts() {
    this.watch = true;
    this.rockGoal = 0;
    const g = this.goose;
    if (g) { g.react.lean.target = 0.35; g.react.jaw.target = 0.3; }
  }

  /** It landed: wings up, a honk, a good hard rock. @param {number} now scene seconds @param {boolean} [bad] a privy smash: a slower, sorrier rock */
  landed(now, bad = false) {
    this.watch = false;
    const g = this.goose;
    if (g) { g.react.lean.target = 0; g.react.jaw.target = 0; }
    if (bad) { this.rockGoal = 0.04; if (g) { g.react.look.kick(-5); g.react.tilt.target = 0.25; } return; }
    this.cheerUntil = now + 2.6;
    this.rockGoal = 0.13;
    this.rockRate = 0.9;
    if (g) { g.react.hop.kick(0.6); g.react.jaw.target = 0.6; this.later(0.3, () => { g.react.jaw.target = 0; }); }
  }

  /** A new tree: settle back. */
  reset() {
    this.watch = false;
    this.cheerUntil = -1;
    this.rockGoal = 0.05;
    this.rockRate = 0.55;
    const g = this.goose;
    if (g) { g.react.lean.target = 0; g.react.jaw.target = 0; g.react.tilt.target = 0; }
  }

  /**
   * @param {number} dt scene seconds @param {number} now scene seconds
   * @param {THREE.Vector3} lookAt world point he watches
   */
  update(dt, now, lookAt) {
    this.t += dt;
    const cheering = now < this.cheerUntil;
    if (!cheering && this.cheerUntil > 0 && now > this.cheerUntil) { this.cheerUntil = -1; this.rockGoal = 0.05; this.rockRate = 0.55; }
    // The rock: a rolling pitch on the runners.
    this.rock += (this.rockGoal - this.rock) * Math.min(1, dt * 1.5);
    this.phase += dt * Math.PI * 2 * this.rockRate;
    const th = Math.sin(this.phase) * this.rock - (this.watch ? 0.06 : 0);
    this.rocker.rotation.x = th;
    // Roll without slipping: the contact point moves along the runner.
    this.rocker.position.set(0, RUNNER_R * (1 - Math.cos(th)), RUNNER_R * th - RUNNER_R * Math.sin(th));
    const g = this.goose;
    if (!g) return;
    // Head follows the action (yaw in his own frame).
    this.group.updateMatrixWorld(true);
    const local = g.root.worldToLocal(_v.copy(lookAt));
    g.react.look.target = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.1, 1.1) * 0.8;
    // Hands: folded on the belly, or thrown up and flapping.
    const root = g.root;
    let hands;
    if (cheering) {
      const flap = Math.sin(this.t * 22) * 0.06;
      hands = {
        left: root.localToWorld(new THREE.Vector3(0.3 + flap, 1.15 + flap, 0.12)),
        right: root.localToWorld(new THREE.Vector3(-0.3 - flap, 1.15 + flap, 0.12)),
      };
    } else {
      hands = {
        left: root.localToWorld(new THREE.Vector3(0.05, g.sit.hipY + 0.2, 0.2)),
        right: root.localToWorld(new THREE.Vector3(-0.05, g.sit.hipY + 0.23, 0.21)),
        poleL: root.localToWorld(new THREE.Vector3(0.6, g.sit.hipY, -0.1)),
        poleR: root.localToWorld(new THREE.Vector3(-0.6, g.sit.hipY, -0.1)),
      };
    }
    g.ikWeight = 1;
    g.update(dt, hands);
  }
}

/**
 * Where Grandma stands to watch when she isn't sawing: side by side with
 * Grandpa's chair, at his left hand. (His right is out of the saw shot.) The
 * hardest left fall of a small pine stops ≈0.5 m short of her (scripts/dev-fall-reach.mjs).
 */
export const GRANDMA_SPOT = { x: -2.3, z: -1.6 };

/**
 * Grandma watching from beside Grandpa's chair (the two-player games: the
 * grandchildren have the saw). Hands folded, she tuts at tantrums, puts
 * her hands to her cheeks as the tree goes and claps when it lands.
 */
export class WatchingGrandma {
  /** @param {THREE.Scene} scene @param {(at: number, fn: () => void) => void} later run on the scene clock */
  constructor(scene, later) {
    this.later = later;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'grandma-watching';
    this.group.position.set(GRANDMA_SPOT.x, 0, GRANDMA_SPOT.z);
    // Facing the same way as Grandpa, so they read as a pair.
    this.group.rotation.y = Math.atan2(-0.4 - GRANDMA_SPOT.x, 1.4 - GRANDMA_SPOT.z);
    this.group.visible = false;
    scene.add(this.group);
    /** @type {import('./geese.js').Goose|null} */
    this.goose = null;
    /** @type {Promise<boolean>|null} */
    this.ready = null;
    this.on = false;
    this.t = 0;
    this.clapUntil = -1;
    /** Hands up to the cheeks (the fall). */
    this.gasp = false;
    this.hipY = 0.7;
  }

  /** Show her (load on first use) or hide her (she's on the saw). @param {boolean} on */
  setOn(on) {
    this.on = on;
    this.group.visible = on;
    if (on && !this.ready) {
      this.ready = loadGoose('grandma').then((g) => {
        this.goose = g;
        g.play('idle', { fade: 0.2 });
        this.group.add(g.root);
        g.root.updateMatrixWorld(true);
        const hips = g.bones.Hips;
        if (hips) this.hipY = g.root.worldToLocal(hips.getWorldPosition(new THREE.Vector3())).y;
        return true;
      }).catch((err) => { console.warn('grandma watching', err); return false; });
    }
  }

  /** A slow, disappointed head shake. */
  tantrum() {
    const g = this.goose;
    if (!g || !this.on) return;
    const R = g.react;
    R.tilt.target = 0.12;
    [0, 0.22, 0.44].forEach((t, i) => this.later(t, () => R.look.kick(i % 2 ? -3.5 : 3.5)));
    this.later(0.9, () => { R.tilt.target = 0; });
  }

  /** @param {number} [deg] the fall's heading: well left (toward the chair) and she flinches back */
  fallStarts(deg = 0) {
    this.gasp = true;
    const g = this.goose;
    if (!g) return;
    g.react.lean.target = -0.1;
    if (deg < -15) this.later(0.9, () => { g.react.hop.kick(0.5); g.react.shove.kick(-0.9); g.react.lean.kick(-1.5); });
  }

  /** @param {number} now scene seconds @param {boolean} [bad] the privy */
  landed(now, bad = false) {
    const g = this.goose;
    if (g) g.react.lean.target = 0;
    if (bad) { if (g) g.react.tilt.target = 0.3; this.later(2.4, () => { this.gasp = false; if (g) g.react.tilt.target = 0; }); return; }
    this.gasp = false;
    this.clapUntil = now + 2;
    if (g) g.react.hop.kick(0.35);
  }

  reset() {
    this.gasp = false;
    this.clapUntil = -1;
    const g = this.goose;
    if (g) { g.react.lean.target = 0; g.react.tilt.target = 0; }
  }

  /** @param {number} dt @param {number} now @param {THREE.Vector3} lookAt */
  update(dt, now, lookAt) {
    const g = this.goose;
    if (!g || !this.on) return;
    this.t += dt;
    this.group.updateMatrixWorld(true);
    const root = g.root;
    const local = root.worldToLocal(_v.copy(lookAt));
    g.react.look.target = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1, 1) * 0.7;
    const y = this.hipY;
    let hands;
    if (now < this.clapUntil) {
      const o = 0.025 + 0.11 * Math.abs(Math.sin(this.t * 9));
      hands = { left: root.localToWorld(new THREE.Vector3(o, y + 0.42, 0.26)), right: root.localToWorld(new THREE.Vector3(-o, y + 0.42, 0.26)) };
    } else if (this.gasp) {
      const head = g.bones.Head ? root.worldToLocal(g.bones.Head.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(0, y + 0.6, 0);
      hands = { left: root.localToWorld(new THREE.Vector3(0.1, head.y - 0.06, head.z + 0.06)), right: root.localToWorld(new THREE.Vector3(-0.1, head.y - 0.06, head.z + 0.06)) };
    } else {
      hands = {
        left: root.localToWorld(new THREE.Vector3(0.04, y + 0.1, 0.19)),
        right: root.localToWorld(new THREE.Vector3(-0.04, y + 0.12, 0.2)),
        poleL: root.localToWorld(new THREE.Vector3(0.6, y, -0.1)),
        poleR: root.localToWorld(new THREE.Vector3(-0.6, y, -0.1)),
      };
    }
    g.ikWeight = 1;
    g.update(dt, hands);
  }
}

/** A goose's head (world), a little above the crown: where a speech bubble points. @param {import('./geese.js').Goose|null} g @param {THREE.Vector3} out */
export function headTop(g, out) {
  if (!g?.bones.Head) return null;
  return g.bones.Head.getWorldPosition(out).add(new THREE.Vector3(0, 0.28, 0));
}
