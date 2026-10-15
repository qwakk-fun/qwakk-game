/**
 * World-space bone helpers. They work from world directions, so they do not
 * depend on how the art's bone rolls are set up (our rig's rolls are not
 * Mixamo's).
 */
import * as THREE from 'three/webgpu';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Vector3();
const _e = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _goal = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

/** Rotate `bone` by a world-space rotation `q` (applied on top of its current pose). */
export function rotateBoneWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
  bone.getWorldQuaternion(_qw);
  const parent = bone.parent;
  if (parent) parent.getWorldQuaternion(_qp);
  else _qp.identity();
  // local = parentWorld^-1 * q * boneWorld
  bone.quaternion.copy(_qp.invert().multiply(_q.copy(q).multiply(_qw)));
  bone.updateMatrixWorld(true);
}

/** Turn `bone` so the direction toward `child` points along world direction `dir`. */
export function aimBone(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3): void {
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  _c.subVectors(_b, _a).normalize();
  _q.setFromUnitVectors(_c, _t.copy(dir).normalize());
  rotateBoneWorld(bone, _q);
}

/**
 * Two-bone IK: bend `upper` and `lower` so `end` reaches `target`, with the
 * middle joint (elbow, knee) bending toward `pole`.
 */
export function twoBoneIK(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3): void {
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b);
  const l2 = _b.distanceTo(_c);
  _t.subVectors(target, _a);
  const dist = Math.min(Math.max(_t.length(), 1e-4), (l1 + l2) * 0.999);
  _n.copy(_t).normalize();
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  // Bend plane: the pole direction with its component along the reach removed.
  _m.subVectors(pole, _a);
  _m.addScaledVector(_n, -_m.dot(_n));
  if (_m.lengthSq() < 1e-8) _m.set(0, -1, 0);
  _m.normalize();
  _e.copy(_a).addScaledVector(_n, l1 * cosA).addScaledVector(_m, l1 * sinA);
  _goal.copy(_a).addScaledVector(_n, dist);
  aimBone(upper, lower, _d1.subVectors(_e, _a));
  // Now the lower bone toward the target.
  lower.getWorldPosition(_d2);
  aimBone(lower, end, _d2.subVectors(_goal, _d2));
}
