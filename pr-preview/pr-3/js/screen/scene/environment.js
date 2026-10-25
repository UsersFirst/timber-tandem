// @ts-check
// ============================================================
// environment — Goose Hollow: the clearing behind Grandma's cottage
// ============================================================
// Chunky low-poly, warm autumn palette, few draw calls: everything static is
// either instanced or merged into a vertex-coloured mesh.
//   sky dome 1 · ground 1 · pines 1 · autumn trees 2 · cottage 2 (+glow)
//   props 1 · leaves 1 · smoke (points) 1
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ASSET = new URL('../../../assets/landscape/', import.meta.url).href;

/** Deterministic random, so the set looks the same every load. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const PALETTE = {
  skyTop: 0x6f9fd8, skyHorizon: 0xf6d6a8, fog: 0xe9cfa4,
  grass: 0x7c8f3f, grassDry: 0xa58d45, dirt: 0x8a6a45,
  bark: 0x6b4a2f, barkDark: 0x4a3220, woodCut: 0xe8c48c, woodCutRing: 0xc99a5b,
  pine: 0x2f5a3a, pineLight: 0x3d7048,
  autumn: [0xd9662b, 0xe8a33a, 0xc23b22, 0xe0c341, 0xb85a1d],
  wallCream: 0xead9b8, timber: 0x4b3424, roof: 0x8c3b2e, brick: 0x9a5a44, door: 0x3d5a46, window: 0xffc66b,
};

/** Paint a geometry one colour (adds a vertex colour attribute). */
export function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** @param {THREE.BufferGeometry} g @param {THREE.Matrix4} m */
export function placed(g, m) { g.applyMatrix4(m); return g; }

const M = (x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

export const flatMat = (opts = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0, ...opts });

/**
 * Build the set.
 * @param {THREE.Scene} scene @param {{quality: string}} o
 */
export async function buildEnvironment(scene, o) {
  const r = rng(42);
  const root = new THREE.Group();
  root.name = 'environment';
  scene.add(root);

  // ---- sky dome (vertex-coloured gradient) ----
  {
    const geo = new THREE.SphereGeometry(120, 24, 12);
    const top = new THREE.Color(PALETTE.skyTop), hor = new THREE.Color(PALETTE.skyHorizon);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 120;
      const c = hor.clone().lerp(top, THREE.MathUtils.smoothstep(y, -0.05, 0.6));
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    root.add(sky);
  }

  // ---- ground: a gently rolling grid with a worn dirt clearing in the middle ----
  {
    const geo = new THREE.PlaneGeometry(140, 140, 70, 70);
    geo.rotateX(-Math.PI / 2);
    const g = geo.toNonIndexed();
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = Math.hypot(x, z);
      const y = d > 9 ? (Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.35 + Math.sin(x * 0.07 + z * 0.05) * 0.5) * Math.min(1, (d - 9) / 10) : 0;
      pos.setY(i, y);
    }
    const col = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(PALETTE.grass), dry = new THREE.Color(PALETTE.grassDry), dirt = new THREE.Color(PALETTE.dirt);
    // One colour per quad (two triangles), so the patchwork reads as chunky low-poly.
    for (let f = 0; f < pos.count; f += 6) {
      const cx = pos.getX(f), cz = pos.getZ(f);
      const d = Math.hypot(cx, cz + 0.5);
      const c = grass.clone().lerp(dry, 0.15 + r() * 0.35);
      c.lerp(dirt, THREE.MathUtils.smoothstep(5 - d, 0, 3) * 0.8);
      for (let k = 0; k < 6; k++) col.set([c.r, c.g, c.b], (f + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, flatMat());
    ground.receiveShadow = true;
    ground.name = 'ground';
    root.add(ground);
  }

  // ---- pines: the GLB, recentred, instanced in a ring ----
  try {
    const gltf = await new GLTFLoader().loadAsync(ASSET + 'lowpoly_pine_tree.glb');
    /** @type {THREE.Mesh|null} */
    let src = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((m) => { if (!src && /** @type {any} */ (m).isMesh) src = /** @type {THREE.Mesh} */ (m); });
    if (src) {
      const s = /** @type {THREE.Mesh} */ (src);
      const geo = s.geometry.clone().applyMatrix4(s.matrixWorld);
      geo.computeBoundingBox();
      const bb = /** @type {THREE.Box3} */ (geo.boundingBox);
      const h = bb.max.y - bb.min.y;
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      geo.scale(1 / h, 1 / h, 1 / h);
      const mat = /** @type {THREE.Material} */ (s.material);
      const count = o.quality === 'low' ? 40 : 70;
      const inst = new THREE.InstancedMesh(geo, mat, count);
      inst.name = 'pines';
      let n = 0;
      for (let tries = 0; n < count && tries < 1000; tries++) {
        const a = r() * Math.PI * 2;
        const rad = 13 + r() * 22;
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        if (x < -5 && x > -14 && z < -6 && z > -15) continue; // the cottage
        if (z > 6 && Math.abs(x) < 10) continue;               // keep the camera's view open
        const H = 7 + r() * 9;
        inst.setMatrixAt(n++, M(x, -0.1, z, r() * 6.28, H * (0.75 + r() * 0.2), H, H * (0.75 + r() * 0.2)));
      }
      inst.count = n;
      inst.castShadow = o.quality === 'high';
      root.add(inst);
    }
  } catch (e) { console.warn('pines failed', e); }

  // ---- autumn trees: trunk + chunky canopy, two instanced meshes ----
  {
    const count = o.quality === 'low' ? 14 : 24;
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6); trunkGeo.translate(0, 0.5, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: PALETTE.barkDark, flatShading: true, roughness: 1 }), count);
    const canopy = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85 }), count * 2);
    let n = 0, c = 0;
    for (let tries = 0; n < count && tries < 500; tries++) {
      const a = r() * Math.PI * 2;
      const rad = 10 + r() * 18;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (z > 5 && Math.abs(x) < 9) continue;
      if (x < -5 && x > -14 && z < -6 && z > -15) continue;
      const H = 2.2 + r() * 2.2;
      trunks.setMatrixAt(n++, M(x, 0, z, 0, 1, H, 1));
      for (let k = 0; k < 2; k++) {
        const s = 1.1 + r() * 1.1;
        canopy.setMatrixAt(c, M(x + (r() - 0.5) * 0.9, H + s * 0.55 + k * 0.7, z + (r() - 0.5) * 0.9, r() * 6, s, s * 0.85, s));
        canopy.setColorAt(c++, new THREE.Color(PALETTE.autumn[Math.floor(r() * PALETTE.autumn.length)]));
      }
    }
    trunks.count = n; canopy.count = c;
    trunks.name = 'autumn-trunks'; canopy.name = 'autumn-canopy';
    canopy.castShadow = o.quality === 'high';
    root.add(trunks, canopy);
  }

  // ---- Grandma's cottage (back-left), merged, plus its warm windows ----
  const cottage = new THREE.Group();
  cottage.name = 'cottage';
  cottage.position.set(-9.5, 0, -10.5);
  cottage.rotation.y = 0.55;
  root.add(cottage);
  {
    const parts = [];
    // Walls, timber frame, roof, chimney, door.
    parts.push(placed(paint(new THREE.BoxGeometry(5, 2.6, 3.6), PALETTE.wallCream), M(0, 1.3, 0)));
    for (const x of [-2.45, 2.45]) for (const z of [-1.75, 1.75]) parts.push(placed(paint(new THREE.BoxGeometry(0.16, 2.7, 0.16), PALETTE.timber), M(x, 1.35, z)));
    parts.push(placed(paint(new THREE.BoxGeometry(5.1, 0.16, 0.16), PALETTE.timber), M(0, 2.6, 1.78)));
    parts.push(placed(paint(new THREE.BoxGeometry(5.1, 0.16, 0.16), PALETTE.timber), M(0, 1.2, 1.78)));
    // Gable roof: two slabs.
    for (const s of [-1, 1]) parts.push(placed(paint(new THREE.BoxGeometry(5.6, 0.18, 2.5), PALETTE.roof), M(0, 3.3, s * 0.95, 0, 1, 1, 1, s * -0.62)));
    // Gable ends (triangles).
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1.8, 0, 0, 1.8, 0, 0, 0, 1.25, 0], 3));
    tri.computeVertexNormals();
    for (const x of [-2.5, 2.5]) {
      const g = paint(tri.clone(), PALETTE.wallCream);
      parts.push(placed(g, M(x, 2.6, 0, x > 0 ? Math.PI / 2 : -Math.PI / 2)));
    }
    parts.push(placed(paint(new THREE.BoxGeometry(0.6, 1.8, 0.6), PALETTE.brick), M(1.5, 3.9, -0.6)));
    parts.push(placed(paint(new THREE.BoxGeometry(0.8, 1.6, 0.08), PALETTE.door), M(-0.9, 0.8, 1.82)));
    parts.push(placed(paint(new THREE.BoxGeometry(5.4, 0.2, 4), PALETTE.timber), M(0, 0.1, 0)));
    const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const m = new THREE.Mesh(merged, flatMat());
    m.castShadow = o.quality === 'high';
    m.receiveShadow = true;
    cottage.add(m);
    // Windows glow (one emissive mesh).
    const wins = [];
    for (const x of [0.6, 1.7]) wins.push(placed(paint(new THREE.BoxGeometry(0.7, 0.7, 0.06), PALETTE.window), M(x, 1.55, 1.81)));
    wins.push(placed(paint(new THREE.BoxGeometry(0.06, 0.7, 0.7), PALETTE.window), M(2.51, 1.55, 0)));
    const glow = new THREE.Mesh(mergeGeometries(wins, false), new THREE.MeshStandardMaterial({ vertexColors: true, emissive: PALETTE.window, emissiveIntensity: 0.9, roughness: 0.4 }));
    cottage.add(glow);
  }

  // ---- props: woodpile, chopping block, a fence: one merged mesh ----
  {
    const parts = [];
    const log = (len, rad, m4) => {
      const g = new THREE.CylinderGeometry(rad, rad, len, 7, 1);
      const side = paint(g.clone(), PALETTE.bark);
      // End caps pale: paint the cap triangles (CylinderGeometry: side first, then caps).
      const col = side.attributes.color;
      const pos = side.attributes.position;
      const cap = new THREE.Color(PALETTE.woodCut);
      for (let i = 0; i < pos.count; i += 3) {
        const y0 = pos.getY(i), y1 = pos.getY(i + 1), y2 = pos.getY(i + 2);
        if (Math.abs(y0 - y1) < 1e-6 && Math.abs(y1 - y2) < 1e-6) for (let k = 0; k < 3; k++) col.setXYZ(i + k, cap.r, cap.g, cap.b);
      }
      return placed(side, m4);
    };
    // Woodpile against the cottage side.
    for (let row = 0; row < 4; row++) for (let i = 0; i < 7 - row; i++) {
      parts.push(log(1.1, 0.13, M(-6.3 + i * 0.27 + row * 0.13, 0.13 + row * 0.23, -7.2, 0.55, 1, 1, 1, Math.PI / 2, 0)));
    }
    // Chopping block with a split round on it.
    parts.push(log(0.55, 0.32, M(3.4, 0.27, -2.6)));
    parts.push(log(0.35, 0.18, M(3.4, 0.72, -2.6)));
    // Split-rail fence along the back.
    for (let i = 0; i < 8; i++) {
      const x = -2 + i * 1.6;
      parts.push(placed(paint(new THREE.BoxGeometry(0.12, 1, 0.12), PALETTE.timber), M(x, 0.5, -12)));
      if (i < 7) for (const y of [0.45, 0.85]) parts.push(placed(paint(new THREE.BoxGeometry(1.65, 0.08, 0.08), PALETTE.bark), M(x + 0.8, y, -12)));
    }
    const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const m = new THREE.Mesh(merged, flatMat());
    m.castShadow = o.quality === 'high';
    m.receiveShadow = true;
    m.name = 'props';
    root.add(m);
  }

  // ---- scattered leaves: one instanced mesh ----
  {
    const count = o.quality === 'low' ? 250 : 600;
    const leaf = new THREE.PlaneGeometry(0.16, 0.11);
    leaf.rotateX(-Math.PI / 2);
    const leaves = new THREE.InstancedMesh(leaf, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1 }), count);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, d = 1.2 + Math.pow(r(), 0.7) * 14;
      leaves.setMatrixAt(i, M(Math.cos(a) * d, 0.012 + r() * 0.01, Math.sin(a) * d, r() * 6.28, 0.7 + r() * 0.8, 1, 0.7 + r() * 0.8));
      leaves.setColorAt(i, new THREE.Color(PALETTE.autumn[Math.floor(r() * PALETTE.autumn.length)]).multiplyScalar(0.8 + r() * 0.3));
    }
    leaves.name = 'leaves';
    leaves.receiveShadow = true;
    root.add(leaves);
  }

  // ---- chimney smoke: a small points system ----
  const smoke = makeSmoke();
  const chimneyTop = new THREE.Vector3(1.5, 4.9, -0.6);
  cottage.localToWorld(chimneyTop);
  smoke.points.position.copy(chimneyTop);
  root.add(smoke.points);

  // ---- light ----
  const hemi = new THREE.HemisphereLight(0xffe9c7, 0x4a3a28, 0.95);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xffcf8a, 2.1);
  sun.position.set(9, 12, 8);
  sun.target.position.set(0, 0, -1);
  root.add(sun, sun.target);
  // A cool back fill so the far (notch) side of the trunk isn't black.
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
  fill.position.set(-5, 6, -9);
  root.add(fill);
  if (o.quality === 'high') {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -9; c.right = 9; c.top = 9; c.bottom = -9; c.near = 1; c.far = 40;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
  }
  scene.fog = new THREE.Fog(PALETTE.fog, 22, 75);
  scene.background = new THREE.Color(PALETTE.skyHorizon);

  return {
    root, sun,
    /** @param {number} dt seconds */
    update(dt) { smoke.update(dt); },
  };
}

/** Soft round sprite texture drawn on a canvas. */
export function softSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSmoke() {
  const N = 28;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const life = new Float32Array(N);
  for (let i = 0; i < N; i++) life[i] = i / N;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 1.4, map: softSprite(), color: 0xd8d2c8, transparent: true, opacity: 0.45, depthWrite: false, sizeAttenuation: true });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'smoke';
  return {
    points,
    /** @param {number} dt */
    update(dt) {
      for (let i = 0; i < N; i++) {
        life[i] += dt * 0.12;
        if (life[i] > 1) life[i] -= 1;
        const L = life[i];
        pos[i * 3] = Math.sin(L * 5 + i) * 0.25 + L * 1.6;
        pos[i * 3 + 1] = L * 5;
        pos[i * 3 + 2] = Math.cos(L * 4 + i) * 0.2;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
