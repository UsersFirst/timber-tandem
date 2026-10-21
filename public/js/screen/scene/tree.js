// @ts-check
// ============================================================
// tree — the tree being felled, its notch, kerf, skid and fall
// ============================================================
// The trunk is split at CUT_Y (saw height): the stump stays, the upper tree
// hangs on a pivot at the hinge (the -z side, where the notch is). The fall
// rotates that pivot about the hinge axis. Notch (pale wedge on the -z face)
// and kerf (dark slot from the +z face) are thin meshes that grow with
// notchFrac / cutFrac.
// ============================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, paint, placed, flatMat, rng } from './environment.js';

/** Saw / back-cut height above the ground (m). */
export const CUT_Y = 0.82;

export const TREES = {
  small: { diameter: 0.45, height: 7, tiers: 5, foliage: PALETTE.pine },
  big: { diameter: 0.8, height: 12, tiers: 7, foliage: PALETTE.pineLight },
};

const M = (x = 0, y = 0, z = 0, ry = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s, s));

/** A trunk segment with bark sides and pale cut caps (vertex coloured). */
function trunkPiece(r0, r1, h, capColorTop, capColorBottom) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 9, 1).toNonIndexed();
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const bark = new THREE.Color(PALETTE.bark), barkD = new THREE.Color(PALETTE.barkDark);
  const top = capColorTop != null ? new THREE.Color(capColorTop) : bark;
  const bot = capColorBottom != null ? new THREE.Color(capColorBottom) : bark;
  for (let i = 0; i < pos.count; i += 3) {
    const y0 = pos.getY(i), y1 = pos.getY(i + 1), y2 = pos.getY(i + 2);
    let c;
    if (Math.abs(y0 - y1) < 1e-6 && Math.abs(y1 - y2) < 1e-6) c = y0 > 0 ? top : bot;
    else c = (i / 3) % 2 ? bark : barkD;
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

export class FellingTree {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'felling-tree';
    scene.add(this.group);
    this.mat = flatMat();
    this.kind = 'small';
    this.targetDeg = 0;
    this.fallDeg = 0;
    this.phi = 0;        // fall angle (rad): 0 standing, ~π/2 down
    this.omega = 0;
    this.falling = false;
    this.landed = false;
    this.build('small', 0);
  }

  get def() { return TREES[/** @type {'small'|'big'} */ (this.kind)]; }
  get radius() { return this.def.diameter / 2; }

  /** @param {'small'|'big'} kind @param {number} targetDeg */
  build(kind, targetDeg) {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => { const m = /** @type {any} */ (o); if (m.geometry) m.geometry.dispose(); });
    }
    this.kind = kind;
    this.targetDeg = targetDeg;
    const d = TREES[kind];
    const R = d.diameter / 2;
    const r = rng(kind === 'small' ? 7 : 11);

    // Stump: ground to cut height, flared root, pale top.
    const stumpGeo = trunkPiece(R * 1.25, R, CUT_Y, PALETTE.woodCut, null);
    stumpGeo.translate(0, CUT_Y / 2, 0);
    this.stump = new THREE.Mesh(stumpGeo, this.mat);
    this.stump.castShadow = true;
    this.stump.receiveShadow = true;
    this.group.add(this.stump);

    // Upper tree on a pivot at the hinge (-z side of the trunk at CUT_Y).
    this.pivot = new THREE.Group();
    this.pivot.position.set(0, CUT_Y, -R * 0.75);
    this.group.add(this.pivot);
    const parts = [];
    const H = d.height - CUT_Y;
    const trunk = trunkPiece(R, R * 0.35, H, null, PALETTE.woodCut);
    trunk.translate(0, H / 2, 0);
    parts.push(trunk);
    // Layered foliage cones, chunky low-poly.
    const foliageStart = H * 0.28;
    for (let i = 0; i < d.tiers; i++) {
      const f = i / (d.tiers - 1);
      const rad = THREE.MathUtils.lerp(d.height * 0.2, d.height * 0.06, f);
      const h = THREE.MathUtils.lerp(d.height * 0.22, d.height * 0.14, f);
      const y = foliageStart + f * (H - foliageStart - h * 0.4);
      const cone = new THREE.ConeGeometry(rad, h, 7, 1);
      const shade = new THREE.Color(d.foliage).multiplyScalar(0.85 + r() * 0.3).getHex();
      parts.push(placed(paint(cone, shade), M(0, y + h / 2, 0, r() * 6)));
    }
    const upperGeo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    upperGeo.translate(0, 0, R * 0.75); // relative to the pivot
    this.upper = new THREE.Mesh(upperGeo, this.mat);
    this.upper.castShadow = true;
    this.pivot.add(this.upper);

    // Notch: a pale wedge on the -z face, opening toward the fall.
    const wedge = new THREE.BufferGeometry();
    const w = R * 1.6;
    // Triangular prism: mouth on the face (z = 0), apex inside the trunk (z = 1).
    const v = [
      -w / 2, 0.0, 1, w / 2, 0.0, 1, -w / 2, 0.22, 0, w / 2, 0.22, 0, -w / 2, -0.03, 0, w / 2, -0.03, 0,
    ];
    wedge.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    wedge.setIndex([0, 2, 3, 0, 3, 1, 0, 1, 5, 0, 5, 4, 2, 4, 5, 2, 5, 3, 0, 4, 2, 1, 3, 5]);
    wedge.computeVertexNormals();
    this.notchMat = new THREE.MeshStandardMaterial({ color: PALETTE.woodCut, emissive: 0x000000, roughness: 0.8, flatShading: true, side: THREE.DoubleSide });
    this.notch = new THREE.Mesh(wedge, this.notchMat);
    // The trunk is a 9-gon: its -z face sits a little inside R.
    this.notch.position.set(0, CUT_Y + 0.01, -R * Math.cos(Math.PI / 9) - 0.004);
    this.notch.scale.set(1, 0.001, 0.001);
    this.group.add(this.notch);

    // Kerf: a dark slot entering from the +z face.
    const kerfGeo = new THREE.BoxGeometry(R * 2.05, 0.02, 1);
    kerfGeo.translate(0, 0, -0.5);
    this.kerf = new THREE.Mesh(kerfGeo, new THREE.MeshBasicMaterial({ color: 0x1b120b }));
    this.kerf.position.set(0, CUT_Y, R + 0.004);
    this.kerf.scale.set(1, 1, 0.001);
    this.group.add(this.kerf);

    // The skid: two poles across the fall line at the target angle.
    if (this.skid) { this.scene.remove(this.skid); }
    this.skid = new THREE.Group();
    this.skid.name = 'skid';
    const pole = new THREE.CylinderGeometry(0.11, 0.11, 2.6, 7);
    pole.rotateZ(Math.PI / 2);
    const skidMat = new THREE.MeshStandardMaterial({ color: 0xb98a4e, roughness: 0.9, flatShading: true, emissive: 0x332000, emissiveIntensity: 0.4 });
    for (const dist of [d.height * 0.42, d.height * 0.72]) {
      const p = new THREE.Mesh(pole, skidMat);
      p.position.set(0, 0.11, -dist);
      p.castShadow = true;
      this.skid.add(p);
    }
    // Chalk target line on the ground.
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, d.height * 0.9), new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.55, depthWrite: false }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.02, -d.height * 0.5);
    this.skid.add(line);
    this.skid.rotation.y = -THREE.MathUtils.degToRad(targetDeg);
    this.scene.add(this.skid);

    // Ghost fall arrow (predicted direction), shown while sawing.
    if (this.ghost) this.scene.remove(this.ghost);
    const arrowShape = new THREE.Shape();
    const L = d.height * 0.8, wd = 0.22;
    arrowShape.moveTo(-wd / 2, 0); arrowShape.lineTo(wd / 2, 0); arrowShape.lineTo(wd / 2, L - 0.7);
    arrowShape.lineTo(wd * 2, L - 0.7); arrowShape.lineTo(0, L); arrowShape.lineTo(-wd * 2, L - 0.7); arrowShape.lineTo(-wd / 2, L - 0.7);
    const ag = new THREE.ShapeGeometry(arrowShape);
    ag.rotateX(-Math.PI / 2); // lies on ground pointing -z
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0, depthWrite: false });
    this.ghost = new THREE.Mesh(ag, this.ghostMat);
    this.ghost.position.set(0, 0.03, -R - 0.2);
    this.scene.add(this.ghost);

    this.phi = 0; this.omega = 0; this.falling = false; this.landed = false;
    this.pivot.quaternion.identity();
    this.setNotch(0); this.setCut(0);
  }

  /** @param {number} f 0..1 */
  setNotch(f) {
    const R = this.radius;
    const k = Math.max(0.001, f);
    this.notch.scale.set(1, Math.max(0.001, f), R * 0.7 * k);
  }

  /** @param {number} f 0..1 */
  setCut(f) {
    const R = this.radius;
    // The back cut stops at the hinge (leaves ~15% of the diameter).
    this.kerf.scale.z = Math.max(0.001, f * R * 2 * 0.82);
  }

  /** Depth of the cut from the +z face, m. */
  cutDepth(f) { return f * this.radius * 2 * 0.82; }

  /** @param {number} lean -1..1 @param {number} opacity */
  setGhost(lean, opacity) {
    this.ghost.rotation.y = -THREE.MathUtils.degToRad(lean * 25);
    this.ghostMat.opacity += (opacity - this.ghostMat.opacity) * 0.15;
  }

  /** Glow the notch face on a player's turn, in their seat colour. @param {number|null} color @param {number} pulse 0..1 */
  setLit(color, pulse = 1) {
    this.notchMat.emissive.setHex(color ?? 0x000000);
    this.notchMat.emissiveIntensity = color == null ? 0 : 0.45 + 0.55 * pulse;
  }

  /** Start the fall toward the given angle (deg, + = toward +x). */
  startFall(angleDeg) {
    this.fallDeg = angleDeg;
    this.falling = true;
    // A firm first push off the hinge, so the fall reads at once (~3 s to impact with slow-mo).
    this.phi = 0.04;
    this.omega = 0.2;
    const th = THREE.MathUtils.degToRad(angleDeg);
    const dir = new THREE.Vector3(Math.sin(th), 0, -Math.cos(th));
    this.fallAxis = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    this.fallDir = dir;
  }

  /**
   * Physics step of the fall. Returns 'impact' on the frame it lands.
   * @param {number} dt seconds (already slow-mo scaled)
   */
  stepFall(dt) {
    if (!this.falling || this.landed) return null;
    const Lcm = (this.def.height - CUT_Y) * 0.45;
    const g = 9.8;
    // A rigid rod pivoting at its base: phi'' = (3g / 2L) sin(phi).
    const alpha = ((3 * g) / (2 * Lcm * 2)) * Math.sin(this.phi);
    this.omega += alpha * dt;
    this.phi += this.omega * dt;
    // Lands when the crown meets the ground: the pivot is CUT_Y up, so a bit past horizontal.
    const rest = Math.PI / 2 + Math.atan2(CUT_Y * 0.9, this.def.height * 0.6);
    let ev = null;
    if (this.phi >= rest) {
      this.phi = rest;
      if (this.omega > 0.6) { this.omega = -this.omega * 0.18; ev = this.bounced ? 'bounce' : 'impact'; this.bounced = true; }
      else { this.omega = 0; this.landed = true; ev = 'settled'; }
    }
    this.pivot.quaternion.setFromAxisAngle(/** @type {THREE.Vector3} */ (this.fallAxis), this.phi);
    return ev;
  }

  /** World points along the fallen trunk (for dust). @param {number} n */
  trunkPoints(n) {
    const pts = [];
    const H = this.def.height - CUT_Y;
    for (let i = 1; i <= n; i++) {
      const p = new THREE.Vector3(0, (i / n) * H, this.radius * 0.75);
      this.upper.localToWorld(p);
      p.y = 0.15;
      pts.push(p);
    }
    return pts;
  }
}
