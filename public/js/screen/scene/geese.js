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
 * One goose on the set.
 */
export class Goose {
  /** @param {CastId} id @param {any} gltf @param {any} clipsGltf */
  constructor(id, gltf, clipsGltf) {
    this.id = id;
    this.root = new THREE.Group();
    this.root.name = 'goose:' + id;
    this.model = gltf.scene;
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

    if (id === 'grandma') this._dressGrandma();
  }

  /** Small cheap tweaks so the Georgian goose reads as Grandma: round spectacles and a warm shawl tint. */
  _dressGrandma() {
    const head = this.bones.Head;
    if (head) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.9, roughness: 0.3 });
      const ring = new THREE.TorusGeometry(0.028, 0.004, 6, 16);
      const bridge = new THREE.CylinderGeometry(0.003, 0.003, 0.03, 4);
      const specs = new THREE.Group();
      const l = new THREE.Mesh(ring, mat), r = new THREE.Mesh(ring, mat), br = new THREE.Mesh(bridge, mat);
      l.position.set(0.035, 0, 0); r.position.set(-0.035, 0, 0); br.rotation.z = Math.PI / 2;
      specs.add(l, r, br);
      // Head bone space: the rig's head points +z (beak). Spectacles sit just above the beak base.
      specs.position.set(0, 0.02 / this.scale, 0.11 / this.scale);
      specs.scale.setScalar(1 / this.scale);
      head.add(specs);
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
    this.mixer.update(dt);
    // Body language on top of the clip.
    const sp = this.bones.Spine1;
    if (sp) sp.rotation.x += this.sway * 0.12;
    const sp2 = this.bones.Spine2;
    if (sp2) sp2.rotation.x += this.sway * 0.06;
    const nk = this.bones.Neck;
    if (nk) nk.rotation.x += this.bob * 0.05;
    this.root.updateMatrixWorld(true);
    const w = this.ikWeight;
    if (w <= 0.001) return;
    if (hands.left && this.armL) this.armL.solve(hands.left, hands.poleL || this.defaultPole(1), w);
    if (hands.right && this.armR) this.armR.solve(hands.right, hands.poleR || this.defaultPole(-1), w);
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
