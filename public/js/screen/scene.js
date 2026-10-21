// @ts-check
// ============================================================
// scene — Timber Tandem's three.js stage (PLAN §4.8, §3.1)
// ============================================================
//
// World scale: metres. Geese stand 1.6 m (GOOSE_HEIGHT); the saw runs at
// CUT_Y = 0.82 m. The tree stands at the origin; the saw runs along x.
//   Seat A stands at −x (screen-left), seat B at +x; they face each other.
//   The camera is on +z, raised ~19°, side-on.
//   Blade flat in x-z, teeth toward −z: the back cut enters from the +z
//   (camera) face; the notch is on the −z face; the tree falls toward −z,
//   rotated about y by the steering angle (+ = toward B, +x).
//
// API (the game calls it): createScene(canvas, {quality}) → TimberScene with
// setCast, setTree, update, hit, bite, tantrum, chatter, fall, celebrate,
// setCamera, resize, info, dispose. See SceneView below.
// ============================================================

import * as THREE from 'three';
import { buildEnvironment } from './scene/environment.js';
import { FellingTree, CUT_Y } from './scene/tree.js';
import { Saw, makeHatchet, BLADE_L, TRAVEL } from './scene/saw.js';
import { loadGoose } from './scene/geese.js';
import { Fx } from './scene/fx.js';

/**
 * @typedef {object} SceneView
 * @property {'idle'|'notch'|'saw'|'fall'|'done'} phase
 * @property {number} s        saw position −1..1 (+1 = slid fully toward A)
 * @property {number} e        strain −1..1
 * @property {'green'|'amber'|'red'} zone
 * @property {'A'|'B'|null} blame
 * @property {number} lean     steering −1..1
 * @property {number} cutFrac  0..1
 * @property {number} notchFrac 0..1
 * @property {'A'|'B'|null} litFace
 */

/** @typedef {'winston'|'victoria'|'grandma'} CastId */

const SEAT_COLOR = { A: 0xe8743b, B: 0x3b9be8 };
/** Distance from a goose's root to its handle along x, at s = 0 (m). */
const STANDOFF = 0.3;
/** Share of the handle's slide the goose's body follows (the rest is arms). */
const BODY_FOLLOW = 0.4;

const CAMERAS = {
  intro: { pos: [5.2, 3.1, 7.2], at: [-2.2, 1.4, -4.0], fov: 46 },
  saw: { pos: [0, 2.6, 4.3], at: [0, 0.85, 0], fov: 38 },
  notch: { pos: [0, 2.15, -3.3], at: [0, 0.85, -0.25], fov: 42 },
  wide: { pos: [7.5, 4.6, 6.5], at: [0.5, 1.2, -4.5], fov: 46 },
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{quality?: 'high'|'medium'|'low'}} [opts]
 */
export async function createScene(canvas, opts = {}) {
  const quality = opts.quality || 'high';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 300);
  const env = await buildEnvironment(scene, { quality });
  const tree = new FellingTree(scene);
  const saw = new Saw();
  scene.add(saw.group);
  const fx = new Fx(scene);

  // Seat rings on the ground (who is who; brighten on your notch turn).
  /** @type {Record<'A'|'B', THREE.Mesh>} */
  const rings = /** @type {any} */ ({});
  for (const seat of /** @type {const} */ (['A', 'B'])) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 28), new THREE.MeshBasicMaterial({ color: SEAT_COLOR[seat], transparent: true, opacity: 0.55, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.015;
    scene.add(m);
    rings[seat] = m;
  }

  const hatchets = { A: makeHatchet(), B: makeHatchet() };
  scene.add(hatchets.A, hatchets.B);

  /** @type {{A: import('./scene/geese.js').Goose|null, B: import('./scene/geese.js').Goose|null}} */
  const geese = { A: null, B: null };
  /** @type {{A: CastId|null, B: CastId|null}} */
  const castIds = { A: null, B: null };
  /** @type {Promise<void>} */
  let castQueue = Promise.resolve();
  /** @type {Record<'A'|'B', CastId>} */
  let wantedCast = { A: 'winston', B: 'victoria' };

  // ---- camera rig ----
  const cam = { pos: new THREE.Vector3(...CAMERAS.intro.pos), at: new THREE.Vector3(...CAMERAS.intro.at), fov: CAMERAS.intro.fov, mode: 'intro' };
  const camGoal = { pos: cam.pos.clone(), at: cam.at.clone(), fov: cam.fov };
  let shake = 0;

  /** @param {'intro'|'notch'|'saw'|'wide'} mode */
  function setCamera(mode) {
    const c = CAMERAS[mode] || CAMERAS.saw;
    cam.mode = mode;
    camGoal.pos.set(c.pos[0], c.pos[1], c.pos[2]);
    camGoal.at.set(c.at[0], c.at[1], c.at[2]);
    camGoal.fov = c.fov;
    if (mode === 'wide' && tree.falling) {
      // Side-on to the fall: the tree sweeps from upright to flat across the frame.
      const th = THREE.MathUtils.degToRad(tree.fallDeg);
      const d = new THREE.Vector3(Math.sin(th), 0, -Math.cos(th));
      const side = new THREE.Vector3(Math.cos(th), 0, Math.sin(th)); // toward +x (B's side)
      const H = tree.def.height;
      const mid = d.clone().multiplyScalar(H * 0.38);
      const dist = H * 0.95 + 3;
      camGoal.pos.copy(mid).addScaledVector(side, dist).addScaledVector(d, -dist * 0.35).add(new THREE.Vector3(0, 2.6, 0));
      camGoal.at.copy(mid).add(new THREE.Vector3(0, H * 0.22, 0));
      camGoal.fov = 50;
    }
  }

  // ---- per-goose state ----
  /** @typedef {{t:number, kind:string, struck:boolean}} Chop */
  const chop = { A: /** @type {Chop|null} */ (null), B: /** @type {Chop|null} */ (null) };
  const body = {
    A: { pos: new THREE.Vector3(-1.5, 0, 0.3), yaw: Math.PI / 2 },
    B: { pos: new THREE.Vector3(1.5, 0, 0.3), yaw: -Math.PI / 2 },
  };
  let phase = 'idle';
  let time = 0;
  let timeScale = 1;
  /** @type {null | {resolve: () => void, settledAt: number|null}} */
  let fallJob = null;
  let celebrating = false;
  /** Seconds left of a goose's tantrum reaction. */
  const react = { A: 0, B: 0 };
  /** @type {SceneView} */
  let lastView = { phase: 'idle', s: 0, e: 0, zone: 'green', blame: null, lean: 0, cutFrac: 0, notchFrac: 0, litFace: null };

  /** Where the notch strike lands (world). */
  const notchPoint = () => new THREE.Vector3(0, CUT_Y + 0.06, -tree.radius * 0.95);

  /** Body target for a seat in a phase. @param {'A'|'B'} seat @param {SceneView} v */
  function bodyGoal(seat, v) {
    const sg = seat === 'A' ? -1 : 1;
    const R = tree.radius;
    if (v.phase === 'notch') {
      const p = new THREE.Vector3(sg * (0.62 + R * 0.5), 0, -R - 0.32);
      const n = notchPoint();
      const yaw = Math.atan2(n.x - p.x, n.z - p.z);
      return { pos: p, yaw };
    }
    const handleZ = sawZ(v) + 0.05;
    const hx0 = sg * (BLADE_L / 2 + 0.03);
    const hx = hx0 - v.s * TRAVEL;
    const back = v.phase === 'fall' || v.phase === 'done' ? 0.55 : 0;
    const x = hx0 + sg * STANDOFF + BODY_FOLLOW * (hx - hx0) + sg * back;
    return { pos: new THREE.Vector3(x, 0, handleZ + (back ? 0.5 : 0)), yaw: seat === 'A' ? Math.PI / 2 : -Math.PI / 2 };
  }

  /** The blade's teeth edge z for a view. @param {SceneView} v */
  function sawZ(v) {
    const R = tree.radius;
    if (v.phase === 'fall' || v.phase === 'done') return R + 0.25;
    if (v.phase === 'notch') return R + 0.6;
    return R - tree.cutDepth(v.cutFrac) + 0.005;
  }

  const ease = (x) => x * x * (3 - 2 * x);

  /** Hatchet + right-hand target for a chopping goose. @param {'A'|'B'} seat @param {number} dt */
  function chopPose(seat, dt) {
    const g = geese[seat];
    const h = hatchets[seat];
    if (!g) return null;
    const c = chop[seat];
    const root = g.root;
    const q = root.quaternion;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(q); // goose's own right side
    const up = new THREE.Vector3(0, 1, 0);
    const base = root.position.clone();
    const rest = base.clone().addScaledVector(up, 0.78).addScaledVector(fwd, 0.22).addScaledVector(right, 0.2);
    const wind = base.clone().addScaledVector(up, 1.12).addScaledVector(fwd, 0.08).addScaledVector(right, 0.26);
    const n = notchPoint();
    const toN = n.clone().sub(base.clone().addScaledVector(up, 1.0)).normalize();
    const strike = n.clone().addScaledVector(toN, -0.3).addScaledVector(up, -0.02);
    let hand = rest, headDir = fwd.clone().addScaledVector(up, 1).normalize();
    if (c) {
      c.t += dt;
      const W = 0.16, S = 0.1, B = 0.28;
      if (c.t < W) {
        const k = ease(c.t / W);
        hand = rest.clone().lerp(wind, k);
        headDir = fwd.clone().addScaledVector(up, 1).normalize().lerp(up.clone().addScaledVector(fwd, -0.5).normalize(), k).normalize();
      } else if (c.t < W + S) {
        const k = (c.t - W) / S;
        hand = wind.clone().lerp(strike, k * k);
        headDir = up.clone().addScaledVector(fwd, -0.5).normalize().lerp(toN, k).normalize();
      } else if (c.t < W + S + B) {
        if (!c.struck) {
          c.struck = true;
          const away = new THREE.Vector3(Math.sign(n.x - base.x) || (seat === 'A' ? 1 : -1), 0.6, -0.8);
          if (c.kind === 'clang') {
            fx.burst(n, new THREE.Vector3(0, 1, -0.5), { n: 16, speed: 3.5, size: 0.015, color: 0xffd36b, life: 0.5 });
          } else {
            fx.burst(n, away, { n: c.kind === 'tok' ? 14 : 4, speed: c.kind === 'tok' ? 2.6 : 1.4, size: 0.045, color: 0xe8c48c });
          }
        }
        const k = ease((c.t - W - S) / B);
        hand = strike.clone().lerp(rest, k);
        headDir = toN.clone().lerp(fwd.clone().addScaledVector(up, 1).normalize(), k).normalize();
      } else chop[seat] = null;
    }
    h.position.copy(hand);
    h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), headDir);
    // Turn the head's edge to face the cut.
    h.rotateY(seat === 'A' ? -Math.PI / 2 : Math.PI / 2);
    return hand;
  }

  /** @param {number} dtMs @param {SceneView} view */
  function update(dtMs, view) {
    const dtReal = Math.min(0.1, Math.max(0, dtMs / 1000));
    lastView = view;
    phase = view.phase;
    const dt = dtReal * timeScale;
    time += dt;

    // Tree visuals.
    tree.setNotch(view.notchFrac);
    tree.setCut(view.cutFrac);
    tree.setLit(view.phase === 'notch' && view.litFace ? SEAT_COLOR[view.litFace] : null, 0.5 + 0.5 * Math.sin(time * 7));
    tree.setGhost(view.lean, view.phase === 'saw' ? 0.6 : 0);

    // Fall physics (slow-mo during the main fall).
    if (tree.falling && !tree.landed) {
      timeScale = tree.phi > 0.35 && tree.phi < 1.35 ? 0.4 : 1;
      const ev = tree.stepFall(dt);
      if (ev === 'impact' || ev === 'bounce') {
        shake = ev === 'impact' ? 1 : 0.4;
        for (const p of tree.trunkPoints(9)) fx.puff(p, { n: ev === 'impact' ? 5 : 2, spread: 1.0, rise: 0.9, life: 2.2 });
        fx.burst(tree.trunkPoints(1)[0], new THREE.Vector3(0, 1, 0), { n: 18, speed: 3, size: 0.05, color: 0x6e8a3a, life: 1.6 });
      }
      if (ev === 'settled' && fallJob) fallJob.settledAt = time;
    } else timeScale = 1;
    if (fallJob && fallJob.settledAt !== null && time - fallJob.settledAt > 0.9) {
      const r = fallJob.resolve;
      fallJob = null;
      r();
    }

    // Saw.
    saw.group.position.y = CUT_Y;
    saw.group.position.z = THREE.MathUtils.damp(saw.group.position.z, sawZ(view), 6, dtReal);
    saw.update(dt, view);
    saw.group.visible = true;

    // Geese.
    for (const seat of /** @type {const} */ (['A', 'B'])) {
      const g = geese[seat];
      const ring = rings[seat];
      const goal = bodyGoal(seat, view);
      const b = body[seat];
      const dist = b.pos.distanceTo(goal.pos);
      const walking = dist > 0.12 && view.phase !== 'saw';
      if (walking) {
        b.pos.addScaledVector(goal.pos.clone().sub(b.pos).normalize(), Math.min(dist, 1.3 * dt));
        const moveYaw = Math.atan2(goal.pos.x - b.pos.x, goal.pos.z - b.pos.z);
        b.yaw = dampAngle(b.yaw, moveYaw, 10, dt);
      } else {
        b.pos.lerp(goal.pos, 1 - Math.exp(-dt * 14));
        b.yaw = dampAngle(b.yaw, goal.yaw, 8, dt);
      }
      ring.position.set(b.pos.x, 0.015, b.pos.z);
      const litMine = view.phase === 'notch' && view.litFace === seat;
      /** @type {THREE.MeshBasicMaterial} */ (ring.material).opacity = litMine ? 0.75 + 0.25 * Math.sin(time * 8) : 0.45;
      ring.scale.setScalar(litMine ? 1.15 : 1);
      const h = hatchets[seat];
      h.visible = view.phase === 'notch' && !!g && !walking;
      if (!g) continue;
      g.root.position.copy(b.pos);
      g.root.rotation.y = b.yaw;
      if (react[seat] > 0) { react[seat] -= dtReal; g.play('flap_startle', { fade: 0.1 }); }
      else if (celebrating) g.play('celebrate');
      else if (walking) g.play('walk', { fade: 0.2 });
      else g.play('idle_shift', { fade: 0.35 });

      // Body language: lean back on your pull.
      const pull = seat === 'A' ? view.s : -view.s;
      g.sway = view.phase === 'saw' ? pull * 0.9 : 0;
      g.bob = view.phase === 'saw' ? Math.sin(time * 6) * 0.3 : 0;

      // Arms.
      /** @type {{left?: THREE.Vector3|null, right?: THREE.Vector3|null}} */
      let hands = {};
      const holdSaw = !walking && !celebrating && (view.phase === 'saw' || view.phase === 'idle' || view.phase === 'fall');
      if (holdSaw) {
        const grip = saw.gripPoints(seat);
        // The camera-side hand on top. A's right hand and B's left hand face +z.
        const camSide = seat === 'A' ? 'right' : 'left';
        const far = camSide === 'right' ? 'left' : 'right';
        hands[camSide] = grip.top.clone().add(new THREE.Vector3(0, 0, 0.03));
        hands[far] = grip.low.clone().add(new THREE.Vector3(0, 0, -0.03));
        g.ikWeight = THREE.MathUtils.damp(g.ikWeight, 1, 10, dtReal);
      } else if (view.phase === 'notch' && !walking) {
        const hand = chopPose(seat, dt);
        hands = { right: hand };
        g.ikWeight = THREE.MathUtils.damp(g.ikWeight, 1, 12, dtReal);
      } else {
        g.ikWeight = THREE.MathUtils.damp(g.ikWeight, 0, 8, dtReal);
        hands = g.ikWeight > 0.02 ? { left: g.bones.LeftHand.getWorldPosition(new THREE.Vector3()), right: g.bones.RightHand.getWorldPosition(new THREE.Vector3()) } : {};
      }
      g.update(dt, hands);
    }

    fx.update(dt);
    env.update(dt);

    // Camera follow: orbit around the look-at point (azimuth, elevation and
    // distance damped separately), so a move from the saw side to the notch
    // side swings around the tree instead of cutting through it.
    const k = 1 - Math.exp(-dtReal * 2.4);
    cam.at.lerp(camGoal.at, k);
    const cur = _sph1.setFromVector3(_off1.copy(cam.pos).sub(cam.at));
    const goal = _sph2.setFromVector3(_off2.copy(camGoal.pos).sub(camGoal.at));
    let dTheta = goal.theta - cur.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    cur.theta += dTheta * k;
    cur.phi += (goal.phi - cur.phi) * k;
    cur.radius += (goal.radius - cur.radius) * k;
    cam.pos.copy(cam.at).add(_off1.setFromSpherical(cur));
    cam.fov += (camGoal.fov - cam.fov) * k;
    shake = Math.max(0, shake - dtReal * 1.8);
    camera.position.copy(cam.pos);
    if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * 0.25 * shake, (Math.random() - 0.5) * 0.25 * shake, 0));
    camera.lookAt(cam.at);
    if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    renderer.render(scene, camera);
  }

  const _sph1 = new THREE.Spherical(), _sph2 = new THREE.Spherical();
  const _off1 = new THREE.Vector3(), _off2 = new THREE.Vector3();

  function dampAngle(a, b, lambda, dt) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * (1 - Math.exp(-lambda * dt));
  }

  /** Kerf ends (world) for sawdust. */
  function kerfEnds() {
    const R = tree.radius;
    const z = sawZ(lastView) + 0.02;
    return [new THREE.Vector3(-R * 0.95, CUT_Y - 0.01, z), new THREE.Vector3(R * 0.95, CUT_Y - 0.01, z)];
  }

  /** @type {TimberScene} */
  const api = {
    // Calls can overlap (the game sends the cast as seats change): queue
    // them, and always build toward the newest cast, so a seat never ends up
    // with two geese.
    setCast(cast) {
      wantedCast = { ...cast };
      castQueue = castQueue.then(async () => {
        for (const seat of /** @type {const} */ (['A', 'B'])) {
          const id = wantedCast[seat];
          if (castIds[seat] === id && geese[seat]) continue;
          const g = await loadGoose(id);
          if (wantedCast[seat] !== id) continue; // changed again while loading
          const old = geese[seat];
          if (old) scene.remove(old.root);
          geese[seat] = g;
          castIds[seat] = id;
          g.root.position.copy(body[seat].pos);
          g.root.rotation.y = body[seat].yaw;
          scene.add(g.root);
        }
      }).catch((err) => console.error('setCast', err));
      return castQueue;
    },
    setTree(def) {
      tree.build(def.kind, def.targetDeg);
      celebrating = false;
      for (const seat of /** @type {const} */ (['A', 'B'])) chop[seat] = null;
    },
    update,
    hit(seat, kind) { chop[seat] = { t: 0, kind, struck: false }; },
    bite() {
      const ends = kerfEnds();
      fx.burst(ends[0], new THREE.Vector3(-1, -0.2, 0.3), { n: 7, speed: 1.3, size: 0.018, color: 0xf0d3a0, spread: 0.6, life: 1.0 });
      fx.burst(ends[1], new THREE.Vector3(1, -0.2, 0.3), { n: 7, speed: 1.3, size: 0.018, color: 0xf0d3a0, spread: 0.6, life: 1.0 });
    },
    tantrum(blame) {
      saw.tantrum(blame);
      const at = blame ? saw.gripPoints(blame).low : kerfEnds()[0];
      fx.puff(at, { n: 6, spread: 0.3, rise: 0.5, life: 0.9 });
      fx.burst(kerfEnds()[blame === 'B' ? 1 : 0], new THREE.Vector3(blame === 'B' ? 1 : -1, 0.5, 0.6), { n: 10, speed: 2.4, size: 0.02, color: 0xf0d3a0 });
      if (blame) react[blame] = 0.9;
    },
    chatter() { saw.chatter(); },
    fall(angleDeg) {
      return new Promise((resolve) => {
        tree.startFall(angleDeg);
        tree.bounced = false;
        fallJob = { resolve, settledAt: null };
        setCamera('wide');
        fx.burst(new THREE.Vector3(0, CUT_Y, -tree.radius * 0.6), new THREE.Vector3(0, 0.4, -1), { n: 10, speed: 1.2, size: 0.03 });
      });
    },
    celebrate() { celebrating = true; },
    setCamera,
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    get info() { return { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }; },
    /** Internals for dev tools and smokes (not part of the game API). */
    get _debug() { return { scene, camera, renderer, geese, saw, tree, fx }; },
    dispose() {
      renderer.dispose();
      scene.traverse((o) => { const m = /** @type {any} */ (o); if (m.geometry) m.geometry.dispose(); });
    },
  };
  api.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
  setCamera('intro');
  cam.pos.copy(camGoal.pos); cam.at.copy(camGoal.at);
  return api;
}

/**
 * @typedef {object} TimberScene
 * @property {(cast: {A: CastId, B: CastId}) => Promise<void>} setCast
 * @property {(def: {kind: 'small'|'big', targetDeg: number}) => void} setTree
 * @property {(dtMs: number, view: SceneView) => void} update
 * @property {(seat: 'A'|'B', kind: 'tok'|'chip'|'clang') => void} hit
 * @property {() => void} bite
 * @property {(blame: 'A'|'B'|null) => void} tantrum
 * @property {() => void} chatter
 * @property {(angleDeg: number) => Promise<void>} fall
 * @property {() => void} celebrate
 * @property {(mode: 'intro'|'notch'|'saw'|'wide') => void} setCamera
 * @property {(w: number, h: number) => void} resize
 * @property {{drawCalls: number, triangles: number}} info
 * @property {() => void} dispose
 */
