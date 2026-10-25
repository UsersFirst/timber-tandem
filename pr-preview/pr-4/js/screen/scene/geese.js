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

/** @typedef {'winston'|'victoria'|'grandma'|'grandpa'} CastId */

const ASSET = new URL('../../../assets/geese/', import.meta.url).href;
const FILES = {
  winston: { model: 'goose_captain.glb', clips: 'goose_captain_clips.glb' },
  victoria: { model: 'goose_stoker_victorian.glb', clips: 'goose_stoker_victorian_clips.glb' },
  // The grandparents are shorter and wider (their own bone lengths), so they
  // keep their true size and borrow the young geese's clips, retargeted.
  grandma: { model: 'goose_grandma.glb', clips: 'goose_stoker_georgian_clips.glb', retarget: true },
  grandpa: { model: 'goose_grandpa.glb', clips: 'goose_captain_clips.glb', retarget: true },
};

/** Model metres → world metres for geese kept at their true size (the young geese's 1.72 m rig stands GOOSE_HEIGHT). */
const TRUE_SCALE = 1.6 / 1.72;

/**
 * Fit a clip made for the young geese to a goose with different bone
 * lengths: keep only rotations (and scale), plus the hips' travel scaled to
 * this goose's leg length. Tracks for bones it doesn't have are dropped.
 * @param {THREE.AnimationClip} clip @param {Record<string, THREE.Bone>} bones @param {number} hipRatio
 */
function retargetClip(clip, bones, hipRatio) {
  const tracks = [];
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    const node = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
    if (!bones[node]) continue;
    if (prop === 'position') {
      if (node !== 'Hips') continue;
      const c = t.clone();
      for (let i = 0; i < c.values.length; i++) c.values[i] *= hipRatio;
      tracks.push(c);
    } else tracks.push(t);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

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
  /** @param {CastId} id @param {any} gltf @param {any} clipsGltf @param {boolean} [retarget] */
  constructor(id, gltf, clipsGltf, retarget = false) {
    this.id = id;
    this.root = new THREE.Group();
    this.root.name = 'goose:' + id;
    this.model = gltf.scene;
    hatOnSocket(this.model);
    mergeSkinned(this.model);
    const box = new THREE.Box3().setFromObject(this.model);
    const h = box.max.y - box.min.y;
    this.scale = retarget ? TRUE_SCALE : GOOSE_HEIGHT / h;
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
    // Clips: the model's own first, then the shared set (retargeted if the
    // bones are a different length). The model's own idle wins over nothing.
    let hipRatio = 1;
    if (retarget) {
      const src = clipsGltf.scene?.getObjectByName?.('Hips');
      if (src && this.bones.Hips && src.position.y > 0) hipRatio = this.bones.Hips.position.y / src.position.y;
    }
    for (const c of gltf.animations) this.clips[c.name] = c;
    for (const c of clipsGltf.animations) this.clips[c.name] = retarget ? retargetClip(c, this.bones, hipRatio) : c;
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
    /** Seconds of talking left: the beak works while a line is up. */
    this.talk = 0;
    this._talkT = 0;
    /** The hat in flight: height above the head (m) and vertical speed. */
    this.hat = { y: 0, v: 0, tip: 0 };
    // Bones the reactions and poses touch go back to rest before each mixer update, so
    // a bone no clip animates (jaw, tail, hat) can't pile rotations up.
    /** @type {[THREE.Bone, THREE.Quaternion, THREE.Vector3][]} */
    this._rest = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Neck1', 'Neck2', 'Neck3', 'Head', 'Jaw', 'Tail', 'HatSocket',
      'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftShoulder', 'RightShoulder']
      .filter((n) => this.bones[n]).map((n) => [this.bones[n], this.bones[n].quaternion.clone(), this.bones[n].position.clone()]);
    this._modelScale = this.model.scale.clone();
    this._modelY = this.model.position.y;

    // The sawing stance (see _sawPose): two-bone IK on the legs, and the
    // rest-pose ankles in the root's frame, which the planted feet start from.
    this.legL = b.LeftUpLeg && b.LeftLeg && b.LeftFoot ? new ArmIK(b.LeftUpLeg, b.LeftLeg, b.LeftFoot) : null;
    this.legR = b.RightUpLeg && b.RightLeg && b.RightFoot ? new ArmIK(b.RightUpLeg, b.RightLeg, b.RightFoot) : null;
    this.root.updateMatrixWorld(true);
    const ank = (n) => this.root.worldToLocal(b[n].getWorldPosition(new THREE.Vector3()));
    this._ankle = { L: ank('LeftFoot'), R: ank('RightFoot') };
    // Leg length against the young geese's (hips ≈ 0.775 m): short legs get a
    // proportionally shallower crouch and a shorter stance.
    this._legK = THREE.MathUtils.clamp(b.Hips ? b.Hips.getWorldPosition(new THREE.Vector3()).y / 0.775 : 1, 0.5, 1.2);
    this._footLen = b.LeftToeBase ? b.LeftFoot.getWorldPosition(new THREE.Vector3()).distanceTo(b.LeftToeBase.getWorldPosition(new THREE.Vector3())) : 0.12;
    /** @type {[THREE.Bone, number][]} cloth panels (coat tails, skirts) and how much each swings */
    this._cloth = [];
    this.model.traverse((o) => {
      const m = /^Cloth_.*_([0-9])$/.exec(o.name);
      if (m && /** @type {any} */ (o).isBone) this._cloth.push([/** @type {THREE.Bone} */ (o), m[1] === '1' ? 1 : m[1] === '2' ? 0.3 : 0.15]);
    });
    // A long skirt can't hide a wide lunge: those geese stand narrower, and
    // the skirt flares out over the feet (each panel swings out from the hips).
    this._skirt = this._cloth.some(([bn]) => /skirt|petticoat/.test(bn.name));
    /** @type {Map<THREE.Bone, THREE.Vector3>} panel → its flare axis, root frame */
    this._flare = new Map();
    if (this._skirt && b.Hips) {
      const hipP = this.root.worldToLocal(b.Hips.getWorldPosition(new THREE.Vector3()));
      for (const [bn] of this._cloth) {
        const d = this.root.worldToLocal(bn.getWorldPosition(new THREE.Vector3())).sub(hipP);
        d.y = 0;
        if (d.lengthSq() < 1e-6) continue;
        d.normalize();
        // Rotating about up × out swings the hem outward.
        this._flare.set(bn, new THREE.Vector3(0, 1, 0).cross(d).normalize());
      }
    }
    /**
     * Sawing, set by the scene every frame. w: blend 0..1. shift: the hips'
     * travel toward the work (m, + forward). effort 0..1 and tug (+1 both
     * hauling back, −1 a push buckling the blade). open: which side the
     * camera is on (+1 its left, −1 its right): it stands open to it.
     */
    this.saw = { w: 0, shift: 0, effort: 0, tug: 0, open: 1 };
    /**
     * Sitting (Grandpa in his rocking chair), set by its owner. w: blend.
     * hipY/hipZ: where the hip joint sits, root frame (m). footZ: how far
     * forward the feet rest. recline: pelvis tipped back (rad).
     */
    this.sit = { w: 0, hipY: 0.42, hipZ: -0.02, footZ: 0.3, recline: 0.2 };
    this._sawSt = { vel: 0, last: 0, yaw: 0, t: Math.random() * 10, cloth: new Spring(1.9, 0.22), wag: new Spring(2.6, 0.3) };

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
    if (this.talk > 0) {
      // Syllables: the beak opens and shuts in bursts, with a pause now and then.
      this.talk -= dt;
      this._talkT += dt;
      const t = this._talkT;
      this.react.jaw.target = this.talk > 0 ? Math.max(0, Math.sin(t * 15)) * (0.3 + 0.2 * Math.sin(t * 3.7)) * (Math.sin(t * 1.3) > -0.75 ? 1 : 0) : 0;
    }
    this._applyReactions(dt);
    this._sawPose(dt);
    this._sitPose();
    this.root.updateMatrixWorld(true);
    const w = this.ikWeight;
    if (w <= 0.001) return;
    if (hands.left && this.armL) this.armL.solve(hands.left, hands.poleL || this.defaultPole(1), w);
    if (hands.right && this.armR) this.armR.solve(hands.right, hands.poleR || this.defaultPole(-1), w);
  }

  /**
   * The sawyer's stance, layered on the clip: feet planted wide and
   * staggered (the camera-side foot back), knees bent, hips rocking fore and
   * aft with the stroke and turning open on the pull, the spine leaning into
   * it, the head held level (a goose keeps its head still), and the coat
   * tails or skirts and the tail swinging after the hips.
   * @param {number} dt
   */
  _sawPose(dt) {
    const S = this.saw, st = this._sawSt, b = this.bones, root = this.root;
    const w = S.w;
    // Keep the swing springs moving even while blending out.
    const vel = dt > 0 ? (S.shift - st.last) / dt : 0;
    st.last = S.shift;
    st.vel += (vel - st.vel) * Math.min(1, dt * 12);
    st.t += dt;
    if (w < 0.001 || !b.Hips) return;
    root.updateMatrixWorld(true);
    const rq = root.getWorldQuaternion(new THREE.Quaternion());
    const rqi = rq.clone().invert();
    // What the clip (and any tantrum) wanted for the head and feet, in the
    // root's frame, before the body moves under them.
    const headRel = b.Head ? rqi.clone().multiply(b.Head.getWorldQuaternion(new THREE.Quaternion())) : null;
    const footRel = {
      L: rqi.clone().multiply(b.LeftFoot.getWorldQuaternion(new THREE.Quaternion())),
      R: rqi.clone().multiply(b.RightFoot.getWorldQuaternion(new THREE.Quaternion())),
    };
    // The hips lead the hands a little (the weight goes first).
    const sh = S.shift + st.vel * 0.05; // ±≈0.13 m
    const u = THREE.MathUtils.clamp(sh / 0.13, -1.3, 1.3);
    const eff = S.effort;
    // Hips: forward and back with the stroke, sitting down into the knees,
    // lowest at the ends of the stroke (weight on one leg), a strain tremble.
    const tremble = eff > 0.5 ? Math.sin(st.t * 47) * 0.004 * (eff - 0.5) * 2 : 0;
    const drop = (0.06 + 0.018 * u * u + 0.035 * eff) * this._legK * this._legK + tremble;
    const off = new THREE.Vector3(0.012 * S.open * u, -drop, sh).multiplyScalar(w).applyQuaternion(rq);
    const hp = b.Hips.getWorldPosition(new THREE.Vector3()).add(off);
    if (b.Hips.parent) b.Hips.position.copy(b.Hips.parent.worldToLocal(hp));
    b.Hips.updateMatrixWorld(true);
    // Hips turn open toward the camera, more on the pull (hips back).
    const yaw = S.open * (0.16 - 0.14 * u);
    st.yaw = yaw;
    rotateInRoot(b.Hips, root, 0, 1, 0, yaw * w);
    // Spine: bent over the work, leaning back into the pull, forward on the
    // return; a tug hauls them back, a push hunches them over.
    const lean = 0.14 + 0.22 * u + 0.12 * eff * (S.tug < 0 ? 1 : -1.2);
    rotateInRoot(b.Spine, root, 1, 0, 0, lean * 0.35 * w);
    rotateInRoot(b.Spine1, root, 1, 0, 0, lean * 0.35 * w);
    rotateInRoot(b.Spine2, root, 1, 0, 0, lean * 0.3 * w);
    // The shoulders square back up a little toward the saw.
    rotateInRoot(b.Spine2, root, 0, 1, 0, -yaw * 0.45 * w);
    // The neck takes up the lean, so the head stays nearly put in space
    // (a goose's head lock), and is held level whatever the body does.
    const nk = -(0.22 * u + lean * 0.5) * w;
    rotateInRoot(b.Neck, root, 1, 0, 0, nk * 0.3);
    rotateInRoot(b.Neck1, root, 1, 0, 0, nk * 0.35);
    rotateInRoot(b.Neck2, root, 1, 0, 0, nk * 0.35);
    // The pulling shoulder draws back on the pull.
    const shN = S.open > 0 ? 'LeftShoulder' : 'RightShoulder';
    rotateInRoot(b[shN], root, 0, 1, 0, S.open * -0.12 * u * w);
    if (b.Head && headRel) {
      const want = rq.clone().multiply(headRel);
      const now = b.Head.getWorldQuaternion(new THREE.Quaternion());
      now.slerp(want, 0.8 * w);
      const pq = (b.Head.parent || root).getWorldQuaternion(new THREE.Quaternion()).invert();
      b.Head.quaternion.copy(pq.multiply(now));
      b.Head.updateMatrixWorld(true);
    }
    // Feet: planted, wide and staggered. The camera-side foot is the back one.
    const backSide = S.open > 0 ? 'L' : 'R';
    for (const side of /** @type {const} */ (['L', 'R'])) {
      const leg = side === 'L' ? this.legL : this.legR;
      const foot = side === 'L' ? b.LeftFoot : b.RightFoot;
      const hip = side === 'L' ? b.LeftUpLeg : b.RightUpLeg;
      if (!leg || !foot || !hip) continue;
      const out = side === 'L' ? 1 : -1;
      const isBack = side === backSide;
      const a0 = this._ankle[side];
      // Heel up on the back foot as the weight goes forward; the front toe
      // lifts a touch as they sit back.
      const k = (this._skirt ? 0.5 : 1) * this._legK;
      const heel = (isBack ? Math.max(0, u) * 0.38 : -Math.max(0, -u) * 0.12) * (this._skirt ? 0.6 : 1);
      const toeOut = out * (isBack ? 0.42 : 0.12) * (this._skirt ? 0.6 : 1);
      const tgt = new THREE.Vector3(a0.x + out * (isBack ? 0.07 : 0.045) * k, a0.y, a0.z + (isBack ? -0.17 : 0.11) * k);
      if (heel > 0) tgt.y += this._footLen * Math.sin(heel) * 0.85;
      const T = root.localToWorld(tgt);
      // Knees forward and a little out.
      const hipW = hip.getWorldPosition(new THREE.Vector3());
      const pole = hipW.add(new THREE.Vector3(out * 0.07, -0.25, 0.6).applyQuaternion(rq));
      // Blend: from the clip's foot to the planted one.
      const cur = foot.getWorldPosition(new THREE.Vector3());
      leg.solve(cur.lerp(T, w), pole, 1);
      // The foot flat on the ground (plus toe-out and the heel lift).
      const fq = rq.clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), toeOut))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), heel))
        .multiply(footRel[side]);
      const nowF = foot.getWorldQuaternion(new THREE.Quaternion()).slerp(fq, w);
      const pq = (foot.parent || root).getWorldQuaternion(new THREE.Quaternion()).invert();
      foot.quaternion.copy(pq.multiply(nowF));
      foot.updateMatrixWorld(true);
    }
    // Coat tails and skirts swing after the hips; the tail wags against them.
    st.cloth.target = THREE.MathUtils.clamp(st.vel * 0.35, -0.1, 0.1);
    st.cloth.step(dt);
    for (const [bone, k] of this._cloth) {
      rotateInRoot(bone, root, 1, 0, 0, st.cloth.x * k * w);
      const ax = this._flare.get(bone);
      if (ax && k === 1) rotateInRoot(bone, root, ax.x, ax.y, ax.z, -(0.1 + 0.03 * Math.abs(u)) * w);
    }
    st.wag.target = -yaw * 1.6;
    st.wag.step(dt);
    rotateInRoot(b.Tail, root, 0, 1, 0, st.wag.x * w);
  }

  /** Seated: the hips on the chair seat, thighs forward, feet flat on the floor in front. */
  _sitPose() {
    const S = this.sit, b = this.bones, root = this.root, w = S.w;
    if (w < 0.001 || !b.Hips) return;
    root.updateMatrixWorld(true);
    const rq = root.getWorldQuaternion(new THREE.Quaternion());
    const rqi = rq.clone().invert();
    const footRel = {
      L: rqi.clone().multiply(b.LeftFoot.getWorldQuaternion(new THREE.Quaternion())),
      R: rqi.clone().multiply(b.RightFoot.getWorldQuaternion(new THREE.Quaternion())),
    };
    // The hip joints' midpoint is a little below the Hips bone: move the
    // bone so the joints land on the seat.
    const hipsW = b.Hips.getWorldPosition(new THREE.Vector3());
    const jointMid = b.LeftUpLeg.getWorldPosition(new THREE.Vector3()).add(b.RightUpLeg.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    const want = root.localToWorld(new THREE.Vector3(0, S.hipY, S.hipZ)).add(hipsW.clone().sub(jointMid));
    hipsW.lerp(want, w);
    if (b.Hips.parent) b.Hips.position.copy(b.Hips.parent.worldToLocal(hipsW));
    b.Hips.updateMatrixWorld(true);
    // Settled back into the chair; the spine curls forward again over the belly.
    rotateInRoot(b.Hips, root, 1, 0, 0, -S.recline * w);
    rotateInRoot(b.Spine1, root, 1, 0, 0, S.recline * 0.45 * w);
    rotateInRoot(b.Spine2, root, 1, 0, 0, S.recline * 0.35 * w);
    for (const side of /** @type {const} */ (['L', 'R'])) {
      const leg = side === 'L' ? this.legL : this.legR;
      const foot = side === 'L' ? b.LeftFoot : b.RightFoot;
      const hip = side === 'L' ? b.LeftUpLeg : b.RightUpLeg;
      if (!leg || !foot || !hip) continue;
      const out = side === 'L' ? 1 : -1;
      const a0 = this._ankle[side];
      const T = root.localToWorld(new THREE.Vector3(a0.x + out * 0.03, a0.y, S.footZ));
      // Knees up and forward, a touch apart.
      const pole = hip.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(out * 0.25, 0.5, 1).applyQuaternion(rq));
      const cur = foot.getWorldPosition(new THREE.Vector3());
      leg.solve(cur.lerp(T, w), pole, 1);
      const fq = rq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), out * 0.25)).multiply(footRel[side]);
      const nowF = foot.getWorldQuaternion(new THREE.Quaternion()).slerp(fq, w);
      const pq = (foot.parent || root).getWorldQuaternion(new THREE.Quaternion()).invert();
      foot.quaternion.copy(pq.multiply(nowF));
      foot.updateMatrixWorld(true);
    }
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
    rotateInRoot(b.Jaw, root, 1, 0, 0, Math.max(0, R.jaw.x) * 0.3);
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
  return new Goose(id, { scene, animations: g.animations }, c, !!f.retarget);
}
