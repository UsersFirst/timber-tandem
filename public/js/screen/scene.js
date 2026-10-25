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
import { TantrumFx, geeseTantrum } from './scene/tantrum.js';
import { Grandpa, WatchingGrandma, headTop } from './scene/grandpa.js';

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
 * @property {number} [aimDeg]    where the fall is heading now (deg, + toward B)
 * @property {'skid'|'close'|'wide'|'privy'} [aimGrade]
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
  const tfx = new TantrumFx(scene);
  // Grandpa watches from his rocking chair (loads after the cast; not a player).
  const grandpa = new Grandpa(scene, (at, fn) => later(at, fn));
  // Grandma watches beside him whenever she isn't on the saw.
  const nana = new WatchingGrandma(scene, (at, fn) => later(at, fn));

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

  /** @param {'intro'|'notch'|'saw'|'wide'|'skid'} mode */
  function setCamera(mode) {
    const c = CAMERAS[/** @type {keyof typeof CAMERAS} */ (mode)] || CAMERAS.saw;
    const cut = mode === 'notch' || cam.mode === 'notch' || mode === 'skid';
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
    if (mode === 'skid') {
      // Three-quarters from behind, off to the left of the skid line: the
      // fall sweeps across the picture (not straight away from the lens),
      // the skid runs diagonally into the frame, and the privy sits beyond
      // it on the right, so where it lands still reads at a glance.
      const th = THREE.MathUtils.degToRad(tree.targetDeg);
      const d = new THREE.Vector3(Math.sin(th), 0, -Math.cos(th));
      const side = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
      const H = tree.def.height;
      // Far enough back that the whole tree, upright to flat, stays in frame.
      camGoal.pos.copy(d).multiplyScalar(-H * 0.2).addScaledVector(side, -(H * 1.05 + 2.4)).add(new THREE.Vector3(0, H * 0.42 + 1.8, 0));
      camGoal.at.copy(d).multiplyScalar(H * 0.38).add(new THREE.Vector3(0, H * 0.3, 0));
      camGoal.fov = 54;
    }
    // The notch is on the far (−z) face, so its camera looks back toward the
    // couch. Cut to it (no swing) and mirror the picture, so Sir Winston
    // (orange, seat A) stays on screen-left in every shot.
    if (cut) {
      cam.pos.copy(camGoal.pos);
      cam.at.copy(camGoal.at);
      cam.fov = camGoal.fov;
    }
    canvas.style.transform = mode === 'notch' ? 'scaleX(-1)' : '';
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
  /** A wing that let go of the handle in a tantrum: seconds in, and for how long. */
  const flail = { A: { t: 0, dur: 0 }, B: { t: 0, dur: 0 } };
  /** Timed tantrum beats, in scene seconds. @type {{t:number, fn:() => void}[]} */
  let cues = [];
  /** The camera's tantrum kick (a punch-in), decays. */
  let camKick = 0;
  /** Scene time of the last tantrum (repeats get a smaller take). */
  let lastTantrum = -1e9;
  // The fall's direction: slow motion state, the privy's hold, the landing grade.
  let slowMo = false, smashHold = 0, clatterReady = false, voiceOn = false;
  /** @type {string|undefined} */
  let fallGrade;
  /** Scene → presenter: sounds, the fall voice, slow motion, the landing. @type {(kind: string, data: any) => void} */
  let listener = () => {};
  /** @param {string} kind @param {any} data */
  const emit = (kind, data) => { try { listener(kind, data); } catch (e) { console.error(e); } };
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
    // Sawing, the feet stay put: the hips carry the stroke (Goose.saw.shift).
    const follow = v.phase === 'saw' || v.phase === 'idle' ? 0 : BODY_FOLLOW;
    const x = hx0 + sg * STANDOFF + follow * (hx - hx0) + sg * back;
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
    if (cues.length) {
      const due = cues.filter((c) => c.t <= time);
      if (due.length) { cues = cues.filter((c) => c.t > time); for (const c of due) c.fn(); }
    }

    // Tree visuals.
    tree.setNotch(view.notchFrac);
    tree.setCut(view.cutFrac);
    tree.setLit(view.phase === 'notch' && view.litFace ? SEAT_COLOR[view.litFace] : null, 0.5 + 0.5 * Math.sin(time * 7));
    tree.setGhost(view.aimDeg ?? view.lean * 25, view.aimGrade || 'wide', view.phase === 'saw' ? 1 : 0);
    tree.updateProps(dt);
    const thumps = tree.takeLandings();
    if (thumps && clatterReady) { clatterReady = false; emit('sound', { name: 'clatter', gain: 0.9 }); }

    // The fall (PLAN §4.8): crack → slow motion through the middle of the
    // fall → full speed for the impact. A privy hit holds the slow motion
    // while it smashes.
    if (tree.falling && !tree.landed) {
      if (smashHold > 0) smashHold -= dtReal;
      const slow = smashHold > 0 || (tree.phi > 0.35 && tree.phi < 1.32);
      timeScale = smashHold > 0 ? 0.3 : slow ? 0.4 : 1;
      if (slow !== slowMo) { slowMo = slow; emit('slowmo', { on: slow }); }
      const ev = tree.stepFall(dt);
      // Its voice: the hinge creaks as it starts; the crown rushes as it speeds up.
      const tip = tree.omega * (tree.def.height - CUT_Y);
      emit('voice', { creak: Math.max(0, 1 - tree.phi / 0.7), rush: Math.min(1, tip / 16), slow });
      // Needles shed from the crown as it tears through the air.
      if (tip > 3 && Math.random() < 0.6) {
        const crown = new THREE.Vector3(0, (tree.def.height - CUT_Y) * (0.55 + Math.random() * 0.4), tree.radius * 0.75);
        tree.upper.localToWorld(crown);
        fx.burst(crown, new THREE.Vector3(0, 0.3, 0), { n: 2, speed: 0.6, size: 0.03, color: 0x5d7a2e, spread: 2, life: 2.5, grav: 0.12, drag: 1.5 });
      }
      if (tree.privyHit && tree.privyContact()) {
        const c = tree.smashPrivy();
        smashHold = 0.9;
        clatterReady = true;
        shake = Math.max(shake, 0.6);
        fx.puff(c, { n: 14, spread: 1.6, rise: 1.4, life: 2.6 });
        fx.burst(c.clone().add(new THREE.Vector3(0, 0.8, 0)), new THREE.Vector3(0, 1, 0), { n: 30, speed: 4, size: 0.045, color: 0x8a5a33, life: 1.8 });
        emit('sound', { name: 'smash' });
        emit('sound', { name: 'whistle', delay: 0.35 });
      }
      if (ev === 'impact' || ev === 'bounce') {
        const big = ev === 'impact';
        shake = big ? 1.2 : 0.4;
        camKick = Math.max(camKick, big ? 0.7 : 0.2);
        const pts = tree.trunkPoints(9);
        for (const p of pts) fx.puff(p, { n: big ? 6 : 2, spread: 1.1, rise: 1.0, life: 2.4 });
        if (big) {
          fx.ring(pts[4], tree.def.height * 0.55);
          fx.burst(pts[6], new THREE.Vector3(0, 1, 0), { n: 26, speed: 3.4, size: 0.05, color: 0x6e8a3a, life: 1.8 });
          // Needles thrown high, drifting back down for a while.
          fx.burst(pts[7].clone().add(new THREE.Vector3(0, 0.6, 0)), new THREE.Vector3(0, 1, 0), { n: 40, speed: 3, size: 0.03, color: 0x5d7a2e, spread: 1.6, life: 4, grav: 0.08, drag: 2 });
          emit('sound', { name: 'boom' });
          emit('land', { grade: fallGrade });
          grandpa.landed(time, fallGrade === 'privy');
          nana.landed(time, fallGrade === 'privy');
          if (grandpa.goose && fallGrade !== 'privy') emit('sound', { name: 'honk', gain: 0.45, delay: 0.25, pan: -0.6 });
        } else emit('sound', { name: 'thud', gain: 0.45 });
      }
      if (ev === 'settled' && fallJob) fallJob.settledAt = time;
    } else {
      timeScale = 1;
      if (slowMo) { slowMo = false; emit('slowmo', { on: false }); }
      if (tree.landed && voiceOn) { voiceOn = false; emit('voice', { creak: 0, rush: 0, slow: false }); }
    }
    if (fallJob && fallJob.settledAt !== null && time - fallJob.settledAt > 0.9) {
      const r = fallJob.resolve;
      fallJob = null;
      r();
    }

    // Saw.
    saw.group.position.y = CUT_Y + (saw.lift || 0);
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
      // Tantrum offsets (hop, shove along the goose's forward).
      if (g.offset) {
        g.root.position.y += g.offset.up;
        g.root.position.x += Math.sin(b.yaw) * g.offset.fwd;
        g.root.position.z += Math.cos(b.yaw) * g.offset.fwd;
      }
      if (celebrating) g.play('celebrate');
      else if (walking) g.play('walk', { fade: 0.2 });
      else g.play('idle_shift', { fade: 0.35 });

      // Body language: the stance follows the stroke (+pull = the handle
      // coming to you, the hips going back).
      const pull = seat === 'A' ? view.s : -view.s;
      g.sway = 0;
      g.bob = 0;

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
        // Tantrum: the camera-side wing lets go and flaps, then grabs back on.
        const fl = flail[seat];
        if (fl.t < fl.dur) {
          fl.t += dt;
          const sh = g.bones[camSide === 'right' ? 'RightArm' : 'LeftArm'].getWorldPosition(new THREE.Vector3());
          // One arc: thrown up and out (back, away from the partner), a fast
          // flutter at the top, then down onto the handle again.
          const away = seat === 'A' ? -1 : 1; // away from the partner (x)
          const flutter = Math.sin(fl.t * 34) * Math.max(0, 1 - fl.t / fl.dur);
          const wing = sh.add(new THREE.Vector3(away * (0.33 + 0.03 * flutter), 0.1 + 0.07 * flutter, 0.16));
          const w = Math.min(1, fl.t / 0.07) * Math.min(1, (fl.dur - fl.t) / 0.25);
          hands[camSide] = /** @type {THREE.Vector3} */ (hands[camSide]).clone().lerp(wing, THREE.MathUtils.clamp(w, 0, 1));
        }
        g.ikWeight = THREE.MathUtils.damp(g.ikWeight, 1, 10, dtReal);
        const sawing = view.phase === 'saw' || view.phase === 'idle';
        g.saw.w = THREE.MathUtils.damp(g.saw.w, sawing ? 1 : 0, 8, dtReal);
        g.saw.shift = -pull * 0.5 * TRAVEL;
        g.saw.effort = THREE.MathUtils.damp(g.saw.effort, Math.min(1, Math.abs(view.e) * 1.2), 6, dtReal);
        g.saw.tug = view.e >= 0 ? 1 : -1;
        g.saw.open = seat === 'A' ? -1 : 1;
      } else if (view.phase === 'notch' && !walking) {
        g.saw.w = THREE.MathUtils.damp(g.saw.w, 0, 10, dtReal);
        const hand = chopPose(seat, dt);
        hands = { right: hand };
        g.ikWeight = THREE.MathUtils.damp(g.ikWeight, 1, 12, dtReal);
      } else {
        g.saw.w = THREE.MathUtils.damp(g.saw.w, 0, 10, dtReal);
        g.ikWeight = THREE.MathUtils.damp(g.ikWeight, 0, 8, dtReal);
        hands = g.ikWeight > 0.02 ? { left: g.bones.LeftHand.getWorldPosition(new THREE.Vector3()), right: g.bones.RightHand.getWorldPosition(new THREE.Vector3()) } : {};
      }
      g.update(dt, hands);
    }

    // Grandpa watches the falling tree, or else the saw.
    const watchAt = tree.falling && !tree.landed ? tree.trunkPoints(9)[5] : _watch.set(saw.group.position.x, CUT_Y + 0.2, saw.group.position.z);
    grandpa.update(dt, time, watchAt);
    nana.update(dt, time, watchAt);
    fx.update(dt);
    tfx.update(dt);
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
    camKick = Math.max(0, camKick - dtReal * 2.2);
    camera.position.copy(cam.pos);
    if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * 0.25 * shake, (Math.random() - 0.5) * 0.25 * shake, 0));
    camera.lookAt(cam.at);
    // The punch-in: a quick narrowing of the lens that eases back out.
    const fovNow = cam.fov - 5 * camKick * camKick;
    if (Math.abs(camera.fov - fovNow) > 0.01) { camera.fov = fovNow; camera.updateProjectionMatrix(); }
    renderer.render(scene, camera);
  }

  const _watch = new THREE.Vector3();
  const _sph1 = new THREE.Spherical(), _sph2 = new THREE.Spherical();
  const _off1 = new THREE.Vector3(), _off2 = new THREE.Vector3();

  function dampAngle(a, b, lambda, dt) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * (1 - Math.exp(-lambda * dt));
  }

  /** The goose who says a line: Grandpa, or Grandma (watching, or on the saw). @param {'grandpa'|'grandma'} who */
  function speaker(who) {
    if (who === 'grandpa') return grandpa.goose;
    if (nana.on) return nana.goose;
    return castIds.A === 'grandma' ? geese.A : castIds.B === 'grandma' ? geese.B : null;
  }
  const _anchor = new THREE.Vector3();

  /** Run fn this many scene seconds from now. @param {number} at @param {() => void} fn */
  function later(at, fn) { cues.push({ t: time + at, fn }); }

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
      nana.setOn(cast.A !== 'grandma' && cast.B !== 'grandma');
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
      grandpa.reset();
      nana.reset();
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
    tantrum(blame, kind = 'push') {
      // Grandpa shakes his head and heckles from the chair (he sits on the left).
      later(0.3, () => grandpa.tantrum());
      if (nana.on) later(0.5, () => nana.tantrum());
      if (grandpa.goose) emit('sound', { name: 'honk', gain: 0.35, delay: 0.42, pan: -0.6 });
      const small = time - lastTantrum < 2.5;
      lastTantrum = time;
      saw.tantrum(blame, kind, small);
      // Sawdust spits out of both ends of the kerf, harder on the blamed side.
      const ends = kerfEnds();
      for (const [i, sg] of /** @type {const} */ ([[0, -1], [1, 1]])) {
        const mine = blame === null || (blame === 'A') === (i === 0);
        fx.burst(ends[i], new THREE.Vector3(sg, 0.7, 0.8), { n: mine ? 18 : 8, speed: mine ? 3.2 : 2, size: 0.022, color: 0xf0d3a0, spread: 0.9, life: 1.1 });
      }
      fx.burst(new THREE.Vector3(0, CUT_Y + 0.02, tree.radius + 0.05), new THREE.Vector3(0, 1, 1), { n: 10, speed: 2.6, size: 0.012, color: 0xffd36b, spread: 1.2, life: 0.45 });
      // Old Misery lets off steam where the blade leaves the trunk, like a kettle on the boil.
      for (const [i, sg] of /** @type {const} */ ([[0, -1], [1, 1]])) {
        const mine = blame === null || (blame === 'A') === (i === 0);
        tfx.jet(ends[i].clone().add(new THREE.Vector3(sg * 0.08, 0.05, 0.1)), new THREE.Vector3(sg * 0.35, 1, 0.35), { n: mine ? 6 : 4, speed: 1.7, size: 0.3 });
      }
      const dir = blame === 'A' ? -1 : blame === 'B' ? 1 : 0;
      later(0.04, () => tfx.curse(new THREE.Vector3(saw.group.position.x + dir * 0.3, CUT_Y + 0.72, tree.radius + 0.25), dir, small));
      // The blamed goose steams at the head once it has shaken it off.
      if (!small) later(0.85, () => {
        for (const seat of blame ? [blame] : /** @type {const} */ (['A', 'B'])) {
          const g = geese[seat];
          if (g?.bones.Head) tfx.jet(g.bones.Head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0)), new THREE.Vector3(0, 1, 0), { n: 4, speed: 0.9, size: 0.22, life: 0.8 });
        }
      });
      geeseTantrum({
        geese, cast: castIds, later,
        flail(seat, sec) { flail[seat] = { t: 0, dur: sec }; },
        kickCamera(a) { camKick = Math.max(camKick, a); shake = Math.max(shake, 0.45 * a); },
      }, blame, kind, small);
    },
    chatter() { saw.chatter(); },
    fall(angleDeg, grade) {
      later(0.6, () => grandpa.fallStarts());
      later(0.8, () => nana.fallStarts(angleDeg));
      return new Promise((resolve) => {
        tree.startFall(angleDeg);
        tree.bounced = false;
        tree.privyHit = grade === 'privy';
        fallGrade = grade;
        voiceOn = true;
        fallJob = { resolve, settledAt: null };
        // The crack: a beat close on the trunk as the hinge goes, then cut
        // to behind the tree, looking down the skid.
        emit('sound', { name: 'crack' });
        shake = Math.max(shake, 0.35);
        camKick = Math.max(camKick, 0.5);
        later(0.5, () => setCamera('skid'));
        // A slow push in through the slow motion.
        later(1.2, () => { camGoal.pos.lerp(camGoal.at, 0.14); });
        fx.burst(new THREE.Vector3(0, CUT_Y, -tree.radius * 0.6), new THREE.Vector3(0, 0.4, -1), { n: 10, speed: 1.2, size: 0.03 });
      });
    },
    celebrate() { celebrating = true; },
    speak(who, sec) {
      const g = speaker(who);
      if (g) { g.talk = sec; g._talkT = 0; }
    },
    bubbleAnchor(who) {
      const g = speaker(who);
      const p = g ? headTop(g, _anchor) : null;
      if (!p) return null;
      p.project(camera);
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      let x = (p.x * 0.5 + 0.5) * w;
      if (cam.mode === 'notch') x = w - x; // the notch shot is mirrored
      return { x, y: (-p.y * 0.5 + 0.5) * h, on: p.z < 1 && p.x > -1.05 && p.x < 1.05 && p.y > -1.05 && p.y < 1.05 };
    },
    setCamera,
    /** Scene events for the presenter: 'sound' {name, gain?, delay?}, 'voice' {creak, rush, slow}, 'slowmo' {on}, 'land' {grade}. @param {(kind: string, data: any) => void} fn */
    onEvent(fn) { listener = fn; },
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    get info() { return { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }; },
    /** Internals for dev tools and smokes (not part of the game API). */
    get _debug() {
      /** Park the camera (dev captures). @param {number[]} pos @param {number[]} at @param {number} fov */
      const lockCam = (pos, at, fov) => { camGoal.pos.set(pos[0], pos[1], pos[2]); camGoal.at.set(at[0], at[1], at[2]); camGoal.fov = fov; cam.pos.copy(camGoal.pos); cam.at.copy(camGoal.at); cam.fov = fov; };
      return { scene, camera, renderer, geese, saw, tree, fx, tfx, lockCam, grandpa, nana };
    },
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
 * @property {(blame: 'A'|'B'|null, kind?: 'push'|'tug') => void} tantrum
 * @property {() => void} chatter
 * @property {(angleDeg: number, grade?: string) => Promise<void>} fall
 * @property {() => void} celebrate
 * @property {(who: 'grandpa'|'grandma', sec: number) => void} speak  work the beak while a line is up
 * @property {(who: 'grandpa'|'grandma') => {x: number, y: number, on: boolean}|null} bubbleAnchor  screen px above the head
 * @property {(mode: 'intro'|'notch'|'saw'|'wide'|'skid') => void} setCamera
 * @property {(w: number, h: number) => void} resize
 * @property {{drawCalls: number, triangles: number}} info
 * @property {(fn: (kind: string, data: any) => void) => void} onEvent
 * @property {() => void} dispose
 * @property {any} [_debug]  dev tools and smokes only
 */
