// @ts-check
// ============================================================
// saw — Old Misery, the two-person crosscut saw, and the hatchets
// ============================================================
// Blade lies flat in x-z (teeth toward -z), with a belly. It bends with
// strain: compression (e < 0) bows it up in y; tension (e > 0) makes it
// taut and shimmer. Handles are vertical wooden posts at each end with a
// band in the seat colour; the blamed handle glows red.
// ============================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, placed } from './environment.js';
import { Spring } from './geese.js';

/** Blade length between the handles (m). */
export const BLADE_L = 1.9;
/** How far the saw slides each way from centre (m). */
export const TRAVEL = 0.26;
/** Handle post height (m). */
export const HANDLE_H = 0.34;

const SEAT_COLORS = { A: 0xe8743b, B: 0x3b9be8 };

export class Saw {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'saw';
    this.tilt = new THREE.Group(); // lean (roll about x)
    this.group.add(this.tilt);

    // ---- blade (with belly + teeth), bendable ----
    const segs = 40;
    const verts = [];
    const idx = [];
    const width = (u) => 0.1 + 0.1 * Math.sin(Math.PI * u); // belly
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const x = -BLADE_L / 2 + u * BLADE_L;
      verts.push(x, 0, 0, x, 0, width(u)); // teeth edge (z=0), back edge
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    // Teeth: small triangles along the front edge pointing -z.
    const teethStart = verts.length / 3;
    const nTeeth = 46;
    for (let i = 0; i < nTeeth; i++) {
      const x0 = -BLADE_L / 2 + 0.05 + (i / nTeeth) * (BLADE_L - 0.1);
      const x1 = x0 + (BLADE_L - 0.1) / nTeeth;
      const k = teethStart + i * 3;
      verts.push(x0, 0, 0.002, x1, 0, 0.002, (x0 + x1) / 2, 0, -0.024);
      idx.push(k, k + 2, k + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.bladeBase = Float32Array.from(verts);
    this.bladeGeo = geo;
    // Low metalness: with no environment map, real metal renders near-black.
    this.bladeMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 0.3, roughness: 0.35, side: THREE.DoubleSide, emissive: 0x1c1f22 });
    this.blade = new THREE.Mesh(geo, this.bladeMat);
    this.blade.castShadow = true;
    this.tilt.add(this.blade);

    // ---- handles ----
    /** @type {Record<'A'|'B', {mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial, x: number}>} */
    this.handles = /** @type {any} */ ({});
    for (const seat of /** @type {const} */ (['A', 'B'])) {
      const x = seat === 'A' ? -BLADE_L / 2 - 0.03 : BLADE_L / 2 + 0.03;
      const parts = [
        paint(new THREE.CylinderGeometry(0.03, 0.034, HANDLE_H, 8), 0x8a5a33),
        placed(paint(new THREE.CylinderGeometry(0.038, 0.038, 0.05, 8), SEAT_COLORS[seat]), new THREE.Matrix4().makeTranslation(0, -HANDLE_H * 0.42, 0)),
        placed(paint(new THREE.BoxGeometry(0.06, 0.05, 0.05), 0x5b5f63), new THREE.Matrix4().makeTranslation(seat === 'A' ? 0.03 : -0.03, 0, 0.04)),
      ];
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true, emissive: 0x000000 });
      const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false), mat);
      mesh.position.set(x, 0.0, 0.05);
      mesh.castShadow = true;
      this.tilt.add(mesh);
      this.handles[seat] = { mesh, mat, x };
    }

    this.time = 0;
    this.bow = 0;
    this.shimmer = 0;
    this.buck = 0;     // tantrum shake, decays
    this.jitter = 0;   // chatter, decays
    this.flash = { A: 0, B: 0 };
    // Tantrum: the blade's bend modes (m), and the whole saw's jump out of the
    // kerf, kick along the stroke, roll and yaw. All springs at rest at 0.
    this.fit = {
      bow: new Spring(6.5, 0.12),    // first mode: a bow up
      wave: new Spring(10.5, 0.09),  // second mode: an S
      twang: new Spring(19, 0.05),   // third mode, fast: a plucked-string twang
      jump: new Spring(3.6, 0.3),    // m up out of the kerf
      kick: new Spring(3.2, 0.42),   // m along x
      roll: new Spring(7, 0.18),     // rad about the stroke axis
      yaw: new Spring(5, 0.25),      // rad about up
    };
    this.heat = 0;
  }

  /** World positions where a goose's two hands grip its handle. @param {'A'|'B'} seat */
  gripPoints(seat) {
    const h = this.handles[seat].mesh;
    const top = new THREE.Vector3(0, HANDLE_H * 0.3, 0);
    const low = new THREE.Vector3(0, -HANDLE_H * 0.12, 0);
    h.localToWorld(top); h.localToWorld(low);
    return { top, low };
  }

  /**
   * @param {number} dt seconds
   * @param {{s:number, e:number, zone:string, blame:'A'|'B'|null, lean:number}} v
   */
  update(dt, v) {
    this.time += dt;
    const targetBow = Math.max(0, -v.e) * 0.24;
    this.bow += (targetBow - this.bow) * Math.min(1, dt * 18);
    this.shimmer += (Math.max(0, v.e) - this.shimmer) * Math.min(1, dt * 18);
    this.buck = Math.max(0, this.buck - dt * 1.6);
    this.jitter = Math.max(0, this.jitter - dt * 4);
    this.heat = Math.max(0, this.heat - dt * 0.9);
    const F = this.fit;
    for (const k of Object.keys(F)) /** @type {any} */ (F)[k].step(dt);

    const pos = this.bladeGeo.attributes.position;
    const base = this.bladeBase;
    const shakeY = this.buck > 0 ? Math.sin(this.time * 70) * 0.03 * this.buck : 0;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const u = (x + BLADE_L / 2) / BLADE_L;
      const uc = THREE.MathUtils.clamp(u, 0, 1);
      let y = this.bow * Math.sin(Math.PI * uc);
      y += F.bow.x * Math.sin(Math.PI * uc) + F.wave.x * Math.sin(2 * Math.PI * uc) + F.twang.x * Math.sin(3 * Math.PI * uc);
      if (this.shimmer > 0.02) y += Math.sin(this.time * 90 + x * 28) * 0.006 * this.shimmer;
      y += shakeY * Math.sin(Math.PI * u * 2);
      if (this.jitter > 0) y += Math.sin(this.time * 140 + x * 60) * 0.004 * this.jitter;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    this.bladeGeo.computeVertexNormals();

    // Lean tilts the whole saw (roll about the stroke axis).
    this.tilt.rotation.x = THREE.MathUtils.degToRad(12) * THREE.MathUtils.clamp(v.lean, -1, 1) + F.roll.x;
    this.tilt.rotation.y = F.yaw.x;
    /** Height above the kerf (m): the scene adds it to the cut height. */
    this.lift = Math.max(-0.01, F.jump.x);

    // Slide along x: s = +1 means slid fully toward A (−x).
    this.group.position.x = -v.s * TRAVEL + F.kick.x;

    // Strain colour on the steel, blame glow on the handle.
    const zoneEm = v.zone === 'red' ? 0x6a0e00 : v.zone === 'amber' ? 0x3a2000 : 0x1c1f22;
    this.bladeMat.emissive.setHex(zoneEm);
    this.bladeMat.color.setHex(0xdfe4ea);
    if (this.heat > 0.01) {
      this.bladeMat.color.lerp(_ember, Math.min(1, this.heat) * 0.85);
      // Red-hot temper: flickers, then cools through orange.
      const h = Math.min(1, this.heat) * (0.75 + 0.25 * Math.sin(this.time * 38));
      this.bladeMat.emissive.lerp(_hot.setRGB(0.95, 0.22 + 0.2 * (1 - this.heat), 0.04), h);
    }
    for (const seat of /** @type {const} */ (['A', 'B'])) {
      const want = v.blame === seat && v.zone !== 'green' ? 1 : 0;
      this.flash[seat] = Math.max(want ? 0.8 : 0, this.flash[seat] - dt * 1.4);
      const k = Math.min(1, this.flash[seat]);
      this.handles[seat].mat.emissive.setRGB(0.9 * k, 0.08 * k, 0.02 * k);
      this.handles[seat].mesh.position.y = this.buck > 0 ? Math.sin(this.time * 55 + (seat === 'A' ? 0 : 1)) * 0.025 * this.buck : 0;
      this.handles[seat].mesh.rotation.z = this.buck > 0 ? Math.sin(this.time * 41 + (seat === 'A' ? 2 : 0)) * 0.12 * this.buck : 0;
    }
  }

  /**
   * Old Misery throws a fit. A push buckles the blade up and kicks it back at
   * the pusher; a tug (both pulling) twangs it like a plucked string.
   * @param {'A'|'B'|null} blame @param {'push'|'tug'} [kind] @param {boolean} [small] a repeat
   */
  tantrum(blame, kind = 'push', small = false) {
    const F = this.fit;
    const g = small ? 0.6 : 1;
    const side = blame === 'A' ? -1 : blame === 'B' ? 1 : 0; // toward the blamed handle (x)
    this.buck = 1;
    this.heat = 1.25;
    if (blame) this.flash[blame] = 1.8;
    if (kind === 'push') {
      F.bow.nudge(0.3 * g);
      F.wave.kick((side * 3.4 || 2) * g);
      F.twang.kick(0.9 * g);
      F.jump.kick(1.3 * g);
      F.kick.kick(side * 1.1 * g);
      F.roll.kick(3.5 * (side || 1) * g);
      F.yaw.kick(1.2 * (side || 1) * g);
    } else {
      F.twang.nudge(0.1 * g);
      F.wave.nudge(0.05 * g);
      F.jump.kick(0.8 * g);
      F.roll.kick(6 * g);
      F.yaw.kick(0.5 * (side || 1) * g);
    }
  }

  chatter() { this.jitter = 1; }
}

const _hot = new THREE.Color();
const _ember = new THREE.Color(0x7a2410);

/** A small hatchet: handle + head, vertex coloured. Grip at the origin, head up +y. */
export function makeHatchet() {
  const parts = [
    placed(paint(new THREE.CylinderGeometry(0.016, 0.02, 0.36, 6), 0x9a6a3a), new THREE.Matrix4().makeTranslation(0, 0.12, 0)),
    placed(paint(new THREE.BoxGeometry(0.03, 0.06, 0.13), 0x6d737a), new THREE.Matrix4().makeTranslation(0, 0.29, 0.04)),
    placed(paint(new THREE.BoxGeometry(0.008, 0.08, 0.03), 0xd8dde2), new THREE.Matrix4().makeTranslation(0, 0.29, 0.115)),
  ];
  const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3, flatShading: true }));
  mesh.castShadow = true;
  return mesh;
}
