// @ts-check
// ============================================================
// fx — chips, sawdust and dust (pooled; 2 draw calls total)
// ============================================================
import * as THREE from 'three';
import { softSprite } from './environment.js';

const CHIP_N = 260;
const DUST_N = 160;

export class Fx {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    // Chips and sawdust: tiny instanced boxes with per-instance colour.
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.chips = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), CHIP_N);
    this.chips.frustumCulled = false;
    this.chips.name = 'fx-chips';
    this.chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.chips);
    /** @type {{p:THREE.Vector3, v:THREE.Vector3, r:THREE.Euler, w:THREE.Vector3, s:number, life:number, max:number}[]} */
    this.c = [];
    for (let i = 0; i < CHIP_N; i++) {
      this.c.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 0, life: 0, max: 1 });
      this.chips.setColorAt(i, new THREE.Color(0xe8c48c));
      this.chips.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    }
    this.nextChip = 0;

    // Dust: soft points.
    const dg = new THREE.BufferGeometry();
    this.dpos = new Float32Array(DUST_N * 3);
    this.dsize = new Float32Array(DUST_N);
    dg.setAttribute('position', new THREE.BufferAttribute(this.dpos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 1.2, map: softSprite(), color: 0xd9c19a, transparent: true, opacity: 0.55, depthWrite: false }));
    this.dust.frustumCulled = false;
    this.dust.name = 'fx-dust';
    scene.add(this.dust);
    /** @type {{p:THREE.Vector3, v:THREE.Vector3, life:number, max:number}[]} */
    this.d = [];
    for (let i = 0; i < DUST_N; i++) { this.d.push({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), life: 0, max: 1 }); }
    this.nextDust = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  /**
   * @param {THREE.Vector3} at @param {THREE.Vector3} dir  main throw direction
   * @param {{n?:number, speed?:number, size?:number, color?:number, spread?:number, life?:number}} o
   */
  burst(at, dir, o = {}) {
    const n = o.n ?? 12;
    const col = new THREE.Color(o.color ?? 0xe8c48c);
    for (let k = 0; k < n; k++) {
      const i = this.nextChip;
      this.nextChip = (this.nextChip + 1) % CHIP_N;
      const c = this.c[i];
      c.p.copy(at);
      const sp = (o.speed ?? 2.2) * (0.5 + Math.random());
      const spread = o.spread ?? 0.8;
      c.v.copy(dir).normalize().multiplyScalar(sp).add(new THREE.Vector3((Math.random() - 0.5) * spread * sp, Math.random() * sp * 0.8, (Math.random() - 0.5) * spread * sp));
      c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.w.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
      c.s = (o.size ?? 0.035) * (0.6 + Math.random() * 0.8);
      c.max = (o.life ?? 1.4) * (0.7 + Math.random() * 0.6);
      c.life = c.max;
      this.chips.setColorAt(i, col.clone().multiplyScalar(0.85 + Math.random() * 0.3));
    }
    if (this.chips.instanceColor) this.chips.instanceColor.needsUpdate = true;
  }

  /** @param {THREE.Vector3} at @param {{n?:number, spread?:number, rise?:number, life?:number}} o */
  puff(at, o = {}) {
    const n = o.n ?? 8;
    for (let k = 0; k < n; k++) {
      const d = this.d[this.nextDust];
      this.nextDust = (this.nextDust + 1) % DUST_N;
      const s = o.spread ?? 0.6;
      d.p.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * s, Math.random() * 0.2, (Math.random() - 0.5) * s));
      d.v.set((Math.random() - 0.5) * s * 1.5, (o.rise ?? 0.6) * (0.5 + Math.random()), (Math.random() - 0.5) * s * 1.5);
      d.max = (o.life ?? 1.6) * (0.7 + Math.random() * 0.6);
      d.life = d.max;
    }
  }

  /** @param {number} dt seconds */
  update(dt) {
    const g = -9.8;
    for (let i = 0; i < CHIP_N; i++) {
      const c = this.c[i];
      if (c.life <= 0) continue;
      c.life -= dt;
      c.v.y += g * dt;
      c.p.addScaledVector(c.v, dt);
      if (c.p.y < 0.02) { c.p.y = 0.02; c.v.multiplyScalar(0.3); c.v.y = Math.abs(c.v.y) * 0.2; c.w.multiplyScalar(0.5); }
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      const s = c.life <= 0 ? 0 : c.s * Math.min(1, c.life / 0.3);
      this._m.compose(c.p, this._q.setFromEuler(c.r), this._s.set(s, s * 0.35, s * 0.7));
      this.chips.setMatrixAt(i, this._m);
    }
    this.chips.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < DUST_N; i++) {
      const d = this.d[i];
      if (d.life > 0) {
        d.life -= dt;
        d.p.addScaledVector(d.v, dt);
        d.v.multiplyScalar(1 - dt * 1.5);
        if (d.life <= 0) d.p.set(0, -99, 0);
      }
      this.dpos[i * 3] = d.p.x; this.dpos[i * 3 + 1] = d.p.y; this.dpos[i * 3 + 2] = d.p.z;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }
}
