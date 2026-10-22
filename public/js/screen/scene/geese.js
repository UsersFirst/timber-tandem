// @ts-check
// ============================================================
// geese — Sir Winston, Lady Victoria and Grandma on the saw
// ============================================================
//
// Loads a goose GLB (rigged, Mixamo-like skeleton; 1.72 m tall, faces +z,
// left = +x) plus its animation-only *_clips.glb, merges its skinned pieces
// by material (≈50 meshes → ≈15 draw calls), and drives:
//   - a base clip (idle_shift / walk / celebrate…) through an AnimationMixer
//   - two-bone IK on both arms each frame, after the mixer (saw handles,
//     the hatchet), plus a little spine sway and head bob.
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** @typedef {'winston'|'victoria'|'grandma'} CastId */

const ASSET = new URL('../../../assets/geese/', import.meta.url).href;
const FILES = {
  winston: { model: 'goose_captain.glb', clips: 'goose_captain_clips.glb' },
  victoria: { model: 'goose_stoker_victorian.glb', clips: 'goose_stoker_victorian_clips.glb' },
  grandma: { model: 'goose_stoker_georgian.glb', clips: 'goose_stoker_georgian_clips.glb' },
};

/** World height of a goose (m). The source rig is 1.72 m; slightly smaller reads better next to the trees. */
export const GOOSE_HEIGHT = 1.6;

const loader = new GLTFLoader();
/** @type {Map<string, Promise<any>>} */
const cache = new Map();
function load(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return /** @type {Promise<any>} */ (cache.get(url));
}

/**
 * Merge every SkinnedMesh that shares a material look into one SkinnedMesh.
 * All pieces share one skeleton and bind matrix (checked); attributes are
 * trimmed to a common set. Rigid bone-parented pieces (eyes) are kept.
 * @param {THREE.Object3D} root
 */
function mergeSkinned(root) {
  /** @type {THREE.SkinnedMesh[]} */
  const skinned = [];
  root.traverse((o) => { if (/** @type {any} */ (o).isSkinnedMesh) skinned.push(/** @type {THREE.SkinnedMesh} */ (o)); });
  if (skinned.length < 2) return;
  const skel = skinned[0].skeleton;
  const bind = skinned[0].bindMatrix;
  // SkeletonUtils.clone gives each mesh its own Skeleton object over the same
  // bones, so compare the bone lists, not the Skeleton objects.
  const sameBones = (m) => m.skeleton.bones.length === skel.bones.length && m.skeleton.bones.every((b, i) => b === skel.bones[i]);
  if (!skinned.every((m) => sameBones(m) && m.bindMatrix.equals(bind))) { console.warn('goose merge skipped: pieces do not share a rig'); return; }
  /** @type {Map<string, THREE.SkinnedMesh[]>} */
  const groups = new Map();
  for (const m of skinned) {
    const mat = /** @type {THREE.MeshStandardMaterial} */ (m.material);
    const key = [mat.type, mat.map?.source?.uuid ?? '-', mat.normalMap?.source?.uuid ?? '-', mat.color?.getHexString(),
      mat.roughness.toFixed(2), mat.metalness.toFixed(2), mat.transparent, mat.side].join('|');
    if (!groups.has(key)) groups.set(key, []);
    /** @type {THREE.SkinnedMesh[]} */ (groups.get(key)).push(m);
  }
  const KEEP = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      // Bake the mesh's local transform relative to the first mesh's parent.
      const g = m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const first = list[0];
    const mesh = new THREE.SkinnedMesh(merged, first.material);
    mesh.name = 'merged:' + first.name;
    mesh.frustumCulled = false;
    first.parent?.add(mesh);
    mesh.position.copy(first.position); mesh.quaternion.copy(first.quaternion); mesh.scale.copy(first.scale);
    mesh.bind(skel, bind);
    for (const m of list) m.parent?.remove(m);
  }
}

/**
 * The hats are skinned to the Head bone. Move their weights onto HatSocket
 * (a child of Head, so the rest pose is unchanged) so a tantrum can knock the
 * hat off. Geometry is shared between clones: do it once per geometry.
 * @param {THREE.Object3D} root
 */
function hatOnSocket(root) {
  root.traverse((o) => {
    const m = /** @type {THREE.SkinnedMesh} */ (o);
    if (!m.isSkinnedMesh || !/_hat_/.test(/** @type {any} */ (m.material).name || '') || m.geometry.userData.hatOnSocket) return;
    const bones = m.skeleton.bones;
    const head = bones.findIndex((b) => b.name === 'Head');
    const sock = bones.findIndex((b) => b.name === 'HatSocket');
    if (head < 0 || sock < 0) return;
    const si = m.geometry.attributes.skinIndex;
    for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === head) si.setComponent(i, k, sock);
    si.needsUpdate = true;
    m.geometry.userData.hatOnSocket = true;
  });
}

/** Analytic two-bone IK on one arm. */
class ArmIK {
  /** @param {THREE.Bone} upper @param {THREE.Bone} lower @param {THREE.Bone} hand */
  constructor(upper, lower, hand) {
    this.upper = upper; this.lower = lower; this.hand = hand;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    upper.getWorldPosition(a); lower.getWorldPosition(b); hand.getWorldPosition(c);
    // Lengths in the bone's own scale-free units are measured at solve time.
    this._a = a; this._b = b; this._c = c;
  }

  /**
   * Place the hand at `target` (world), elbow toward `pole` (world).
   * @param {THREE.Vector3} target @param {THREE.Vector3} pole @param {number} [weight]
   */
  solve(target, pole, weight = 1) {
    const { upper, lower, hand } = this;
    const A = upper.getWorldPosition(_v1);
    const B = lower.getWorldPosition(_v2);
    const C = hand.getWorldPosition(_v3);
    const l1 = A.distanceTo(B), l2 = B.distanceTo(C);
    const toT = _v4.copy(target).sub(A);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
    const u = _u.copy(toT).normalize();
    const pv = _v5.copy(pole).sub(A);
    pv.sub(_v6.copy(u).multiplyScalar(pv.dot(u)));
    if (pv.lengthSq() < 1e-8) pv.set(0, -1, 0);
    pv.normalize();
    const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const E = _v7.copy(A).addScaledVector(u, l1 * cosA).addScaledVector(pv, l1 * sinA);
    rotateBoneToward(upper, _v8.copy(B).sub(A).normalize(), _v9.copy(E).sub(A).normalize(), weight);
    upper.updateMatrixWorld(true);
    const B2 = lower.getWorldPosition(_v2);
    const C2 = hand.getWorldPosition(_v3);
    const T2 = _v4.copy(A).addScaledVector(u, d);
    rotateBoneToward(lower, _v8.copy(C2).sub(B2).normalize(), _v9.copy(T2).sub(B2).normalize(), weight);
    lower.updateMatrixWorld(true);
  }
}

const _u = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3(), _v7 = new THREE.Vector3(), _v8 = new THREE.Vector3(), _v9 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

/**
 * Rotate `bone` (in world space) so that world direction `from` turns to `to`.
 * @param {THREE.Bone} bone @param {THREE.Vector3} from @param {THREE.Vector3} to @param {number} weight
 */
function rotateBoneToward(bone, from, to, weight) {
  const delta = _q1.setFromUnitVectors(from, to);
  if (weight < 1) delta.slerp(_q3.identity(), 1 - weight);
  const world = bone.getWorldQuaternion(_q2);
  const newWorld = delta.multiply(world);
  const parentWorld = bone.parent ? bone.parent.getWorldQuaternion(_q3) : _q3.identity();
  bone.quaternion.copy(parentWorld.invert().multiply(newWorld));
}

/**
 * A damped spring toward a target (semi-implicit Euler). `kick(v)` adds
 * velocity, `nudge(x)` adds displacement. f = natural frequency (Hz),
 * z = damping ratio (1 = no overshoot, lower = bouncier).
 */
export class Spring {
  /** @param {number} f @param {number} z */
  constructor(f, z) { this.f = f; this.z = z; this.x = 0; this.v = 0; this.target = 0; }
  /** @param {number} dt */
  step(dt) {
    const w = 2 * Math.PI * this.f;
    // Sub-step so a long frame can't blow a stiff spring up.
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-w * w * (this.x - this.target) - 2 * this.z * w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  /** @param {number} v */
  kick(v) { this.v += v; return this; }
  /** @param {number} x */
  nudge(x) { this.x += x; return this; }
  get busy() { return Math.abs(this.x - this.target) > 1e-3 || Math.abs(this.v) > 1e-3; }
}

/**
 * Reaction channels layered on top of the clip, all in the goose's own frame
 * (+z forward, +x its left, +y up). Each is a spring at rest at 0; the
 * choreography (scene/tantrum.js) kicks them.
 */
function makeReactor() {
  return {
    /** Spine pitch, rad: + leans forward (over the saw), − rears back. */
    lean: new Spring(3.2, 0.32),
    /** Spine yaw, rad: + turns to its left. */
    twist: new Spring(3, 0.4),
    /** Neck pitch, rad, spread down the neck: + head forward/down, − whipped back. */
    neck: new Spring(4.5, 0.28),
    /** Head yaw, rad: + looks to its left. */
    look: new Spring(5, 0.55),
    /** Head roll, rad (a confused tilt). */
    tilt: new Spring(4, 0.35),
    /** Beak open 0..1 (squawk). */
    jaw: new Spring(9, 0.7),
    /** Root hop, m. */
    hop: new Spring(4.2, 0.35),
    /** Root shove along its forward axis, m: − knocked back. */
    shove: new Spring(2.6, 0.55),
    /** Feathers ruffled: body scale − 1. */
    fluff: new Spring(5.5, 0.22),
    /** Hat spin, rad (the lift is ballistic: `popHat`). */
    hatSpin: new Spring(2.2, 0.5),
    /** Tail flick, rad. */
    tail: new Spring(6, 0.25),
  };
}
/** @typedef {ReturnType<typeof makeReactor>} Reactor */

const _axis = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qr = new THREE.Quaternion();
/**
 * Rotate a bone by `angle` about an axis given in the goose root's frame.
 * @param {THREE.Bone|undefined} bone @param {THREE.Object3D} root @param {number} ax @param {number} ay @param {number} az @param {number} angle
 */
function rotateInRoot(bone, root, ax, ay, az, angle) {
  if (!bone || Math.abs(angle) < 1e-5) return;
  root.getWorldQuaternion(_qr);
  (bone.parent || root).getWorldQuaternion(_qp);
  _axis.set(ax, ay, az).applyQuaternion(_qr).applyQuaternion(_qp.invert()).normalize();
  bone.quaternion.premultiply(_qa.setFromAxisAngle(_axis, angle));
  bone.updateMatrixWorld(true);
}

/**
 * One goose on the set.
 */
export class Goose {
  /** @param {CastId} id @param {any} gltf @param {any} clipsGltf */
  constructor(id, gltf, clipsGltf) {
    this.id = id;
    this.root = new THREE.Group();
    this.root.name = 'goose:' + id;
    this.model = gltf.scene;
    hatOnSocket(this.model);
    mergeSkinned(this.model);
    const box = new THREE.Box3().setFromObject(this.model);
    const h = box.max.y - box.min.y;
    this.scale = GOOSE_HEIGHT / h;
    this.model.scale.setScalar(this.scale);
    this.model.position.y = -box.min.y * this.scale;
    this.root.add(this.model);
    this.model.traverse((o) => {
      if (/** @type {any} */ (o).isMesh) {
        o.castShadow = true;
        /** @type {any} */ (o).frustumCulled = false;
      }
    });

    /** @type {Record<string, THREE.Bone>} */
    this.bones = {};
    this.model.traverse((o) => { if (/** @type {any} */ (o).isBone) this.bones[o.name] = /** @type {THREE.Bone} */ (o); });

    this.mixer = new THREE.AnimationMixer(this.model);
    /** @type {Record<string, THREE.AnimationClip>} */
    this.clips = {};
    for (const c of [...gltf.animations, ...clipsGltf.animations]) this.clips[c.name] = c;
    /** @type {THREE.AnimationAction|null} */
    this.current = null;
    this.currentName = '';
    this.play('idle_shift');

    const b = this.bones;
    this.armL = b.LeftArm && b.LeftForeArm && b.LeftHand ? new ArmIK(b.LeftArm, b.LeftForeArm, b.LeftHand) : null;
    this.armR = b.RightArm && b.RightForeArm && b.RightHand ? new ArmIK(b.RightArm, b.RightForeArm, b.RightHand) : null;
    this.ikWeight = 1;
    this.sway = 0;   // -1..1 spine pitch (+ = leaning back, pulling)
    this.bob = 0;
    this.yaw = 0;
    /** Tantrum and flinch reactions (springs, kicked by scene/tantrum.js). */
    this.react = makeReactor();
    /** The hat in flight: height above the head (m) and vertical speed. */
    this.hat = { y: 0, v: 0, tip: 0 };
    // Bones the reactions touch go back to rest before each mixer update, so
    // a bone no clip animates (jaw, tail, hat) can't pile rotations up.
    /** @type {[THREE.Bone, THREE.Quaternion, THREE.Vector3][]} */
    this._rest = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Neck1', 'Neck2', 'Neck3', 'Head', 'Jaw', 'Tail', 'HatSocket']
      .filter((n) => this.bones[n]).map((n) => [this.bones[n], this.bones[n].quaternion.clone(), this.bones[n].position.clone()]);
    this._modelScale = this.model.scale.clone();
    this._modelY = this.model.position.y;

    if (id === 'grandma') this._dressGrandma();
  }

  /** Small cheap tweaks so the Georgian goose reads as Grandma: round spectacles and a warm shawl tint. */
  _dressGrandma() {
    // Gold spectacles. A goose's eyes are on the sides of its head, so each
    // lens sits over its own eye, facing out (a pair of side lenses, like
    // pince-nez), found from the eye bones in the rest pose.
    const head = this.bones.Head, eyes = [this.bones.LeftEye, this.bones.RightEye];
    if (head && eyes[0] && eyes[1]) {
      this.root.updateMatrixWorld(true);
      const mat = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.85, roughness: 0.3 });
      const ring = new THREE.TorusGeometry(0.021, 0.003, 6, 20);
      const hs = head.getWorldScale(new THREE.Vector3()).x;
      const pL = eyes[0].getWorldPosition(new THREE.Vector3()), pR = eyes[1].getWorldPosition(new THREE.Vector3());
      const mid = pL.clone().add(pR).multiplyScalar(0.5);
      for (const p of [pL, pR]) {
        const out = p.clone().sub(mid).normalize();
        const at = p.clone().addScaledVector(out, 0.026);
        const lens = new THREE.Mesh(ring, mat);
        head.add(lens);
        lens.position.copy(head.worldToLocal(at.clone()));
        // Face the ring (its +z) outward, in head space.
        const hq = head.getWorldQuaternion(new THREE.Quaternion()).invert();
        lens.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out.clone().applyQuaternion(hq).normalize());
        lens.scale.setScalar(1 / hs);
      }
    }
    // Warm the jacket's blue toward a heathery shawl.
    this.model.traverse((o) => {
      const m = /** @type {any} */ (o).material;
      if (m && m.color && /jacket|bowtie|cuffs|hat/.test(m.name || '')) {
        m.color.lerp(new THREE.Color(0x8a5a7a), 0.55);
      }
    });
  }

  /** @param {string} name @param {{fade?:number, once?:boolean, timeScale?:number}} [o] */
  play(name, o = {}) {
    const clip = this.clips[name] || this.clips.idle_shift || this.clips.idle;
    if (!clip || this.currentName === name) return;
    const act = this.mixer.clipAction(clip);
    act.reset();
    act.timeScale = o.timeScale ?? 1;
    if (o.once) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
    else act.setLoop(THREE.LoopRepeat, Infinity);
    act.play();
    if (this.current) this.current.crossFadeTo(act, o.fade ?? 0.3, false);
    this.current = act;
    this.currentName = name;
  }

  /**
   * Advance the animation and solve the arms.
   * @param {number} dt seconds
   * @param {{left?: THREE.Vector3|null, right?: THREE.Vector3|null, poleL?: THREE.Vector3, poleR?: THREE.Vector3}} hands  world targets
   */
  update(dt, hands) {
    for (const [bone, q, p] of this._rest) { bone.quaternion.copy(q); bone.position.copy(p); }
    this.mixer.update(dt);
    // Body language on top of the clip.
    const sp = this.bones.Spine1;
    if (sp) sp.rotation.x += this.sway * 0.12;
    const sp2 = this.bones.Spine2;
    if (sp2) sp2.rotation.x += this.sway * 0.06;
    const nk = this.bones.Neck;
    if (nk) nk.rotation.x += this.bob * 0.05;
    this._applyReactions(dt);
    this.root.updateMatrixWorld(true);
    const w = this.ikWeight;
    if (w <= 0.001) return;
    if (hands.left && this.armL) this.armL.solve(hands.left, hands.poleL || this.defaultPole(1), w);
    if (hands.right && this.armR) this.armR.solve(hands.right, hands.poleR || this.defaultPole(-1), w);
  }

  /** Knock the hat up off the head; it falls back under gravity and bounces once. @param {number} v m/s */
  popHat(v) { this.hat.v = Math.max(this.hat.v, v); this.hat.tip = Math.sign(Math.random() - 0.5) || 1; }

  /** Step the reaction springs and pose the bones (after the clip). @param {number} dt */
  _applyReactions(dt) {
    const R = this.react, b = this.bones, root = this.root;
    for (const k of Object.keys(R)) /** @type {any} */ (R)[k].step(dt);
    const H = this.hat;
    if (H.y > 0 || H.v > 0) {
      H.v -= 9.8 * dt;
      H.y += H.v * dt;
      if (H.y <= 0) { H.y = 0; H.v = H.v < -1 ? -H.v * 0.25 : 0; }
    }
    // Root-level offsets: the scene reads these when it places the goose.
    this.offset = { up: Math.max(-0.02, R.hop.x), fwd: R.shove.x };
    // Feathers ruffle: puff out sideways and front-back, squash a touch.
    const f = R.fluff.x;
    this.model.scale.set(this._modelScale.x * (1 + f), this._modelScale.y * (1 - f * 0.35), this._modelScale.z * (1 + f * 0.8));
    this.model.position.y = this._modelY * (1 - f * 0.35);
    this.model.updateMatrixWorld(true);
    // Spine: pitch (about its left axis) and yaw, spread over three bones.
    rotateInRoot(b.Spine, root, 1, 0, 0, R.lean.x * 0.3);
    rotateInRoot(b.Spine1, root, 1, 0, 0, R.lean.x * 0.35);
    rotateInRoot(b.Spine2, root, 1, 0, 0, R.lean.x * 0.35);
    rotateInRoot(b.Spine1, root, 0, 1, 0, R.twist.x * 0.5);
    rotateInRoot(b.Spine2, root, 0, 1, 0, R.twist.x * 0.5);
    // Neck: a whip travels up the chain (each link a little more).
    const nk = R.neck.x;
    rotateInRoot(b.Neck, root, 1, 0, 0, nk * 0.18);
    rotateInRoot(b.Neck1, root, 1, 0, 0, nk * 0.22);
    rotateInRoot(b.Neck2, root, 1, 0, 0, nk * 0.26);
    rotateInRoot(b.Neck3, root, 1, 0, 0, nk * 0.34);
    // Head: yaw about the root's up (looks round at the partner), and roll.
    rotateInRoot(b.Neck2, root, 0, 1, 0, R.look.x * 0.35);
    rotateInRoot(b.Head, root, 0, 1, 0, R.look.x * 0.65);
    rotateInRoot(b.Head, root, 0, 0, 1, R.tilt.x);
    // Beak: the jaw hinges about the goose's left axis.
    rotateInRoot(b.Jaw, root, 1, 0, 0, Math.max(0, R.jaw.x) * 0.55);
    rotateInRoot(b.Tail, root, 0, 1, 0, R.tail.x);
    // Hat: lifts off the head and spins (it's skinned to HatSocket).
    if (b.HatSocket && b.HatSocket.parent) {
      const lift = H.y;
      // Straight up in the world, converted into the head's space.
      const w = b.HatSocket.getWorldPosition(new THREE.Vector3());
      w.y += lift;
      b.HatSocket.position.copy(b.HatSocket.parent.worldToLocal(w));
      b.HatSocket.updateMatrixWorld(true);
      rotateInRoot(b.HatSocket, root, 0, 1, 0, R.hatSpin.x);
      rotateInRoot(b.HatSocket, root, 1, 0, 0, -Math.min(0.6, lift * 2.4) * H.tip);
    }
  }

  /** Elbow hint: below and out to the side of the shoulder, a little behind. @param {1|-1} side */
  defaultPole(side) {
    const s = this.bones[side > 0 ? 'LeftArm' : 'RightArm'].getWorldPosition(new THREE.Vector3());
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    const out = new THREE.Vector3(side, 0, 0).applyQuaternion(q);
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    return s.addScaledVector(out, 0.4).addScaledVector(back, 0.25).add(new THREE.Vector3(0, -0.5, 0));
  }
}

/**
 * @param {CastId} id
 * @returns {Promise<Goose>}
 */
export async function loadGoose(id) {
  const f = FILES[id] || FILES.winston;
  const [g, c] = await Promise.all([load(ASSET + f.model), load(ASSET + f.clips)]);
  // Each Goose needs its own copy of the skinned scene.
  const { clone } = await import('three/addons/utils/SkeletonUtils.js');
  const scene = clone(g.scene);
  // Materials are shared by the cache: give Grandma her own so her tint stays hers.
  if (id === 'grandma') scene.traverse((o) => { const m = /** @type {any} */ (o); if (m.isMesh) m.material = m.material.clone(); });
  return new Goose(id, { scene, animations: g.animations }, c);
}
