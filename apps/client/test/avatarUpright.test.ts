/**
 * Regression: the local duck spun around itself (torso and head flipping over,
 * arms whirling) whenever the camera pitch was not zero. The animation mixer
 * only writes a bone when its blended value changes, so under a static pose
 * the procedural layer (spine and neck pitch, arm pose, hand IK) stacked up
 * frame after frame. The avatar must hold a steady, upright pose with no input,
 * armed and unarmed.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { ClipSet } from '../src/player/animations.ts';

let clipSet: ClipSet | null = null;
vi.mock('../src/player/animations.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/player/animations.ts')>();
  return { ...real, clips: () => clipSet };
});
const { UPPER_BONES } = await import('../src/player/animations.ts');
const { Avatar } = await import('../src/player/avatar.ts');

/** A minimal duck skeleton with the bone names the avatar needs, feet at y = 0. */
function skeleton(): THREE.Object3D {
  const root = new THREE.Group();
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Bone => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  const hips = bone('Hips', root, 0, 0.8);
  const spine2 = bone('Spine2', bone('Spine1', bone('Spine', hips, 0, 0.1), 0, 0.1), 0, 0.1);
  bone('Head', bone('Neck', spine2, 0, 0.15), 0, 0.15);
  for (const [side, s] of [['Left', 1], ['Right', -1]] as const) {
    bone(`${side}Hand`, bone(`${side}ForeArm`, bone(`${side}Arm`, spine2, 0.15 * s, 0.05), 0.25 * s, 0), 0.22 * s, 0);
    bone(`${side}Foot`, bone(`${side}Leg`, bone(`${side}UpLeg`, hips, 0.12 * s, -0.05), 0, -0.35), 0, -0.35);
  }
  return root;
}

/** Clips that hold one static pose (the worst case: the mixer never sees a change). */
function staticClips(root: THREE.Object3D): ClipSet {
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const clip = (name: string, tilt: number) =>
    new THREE.AnimationClip(name, 1, bones.map((b) => {
      const q = b.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
      return new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, 1], [...q.toArray(), ...q.toArray()]);
    }));
  const full = new Map([['Idle', clip('Idle', 0)], ['Rifle_Aim', clip('Rifle_Aim', 0.05)], ['Pistol_Aim', clip('Pistol_Aim', 0.05)]]);
  const part = (c: THREE.AnimationClip, upper: boolean) =>
    new THREE.AnimationClip(c.name, c.duration, c.tracks.filter((t) => UPPER_BONES.has(t.name.split('.')[0] ?? '') === upper));
  return {
    full,
    lower: new Map([...full].map(([n, c]) => [n, part(c, false)])),
    upper: new Map([...full].map(([n, c]) => [n, part(c, true)])),
    missing: [],
  };
}

function worldQuat(avatar: InstanceType<typeof Avatar>, name: string): THREE.Quaternion {
  const b = avatar.bone(name);
  if (!b) throw new Error(`no bone ${name}`);
  return b.getWorldQuaternion(new THREE.Quaternion());
}

describe.each([
  ['unarmed', 2],
  ['rifle', 0],
])('local duck with clips, %s, no input', (_label, weapon) => {
  it('holds a steady upright pose and its yaw', () => {
    const model = skeleton();
    clipSet = staticClips(model);
    const avatar = new Avatar();
    avatar.setModel(model);
    const pose = { x: 3, y: 0, z: -2, yaw: 0.7, pitch: -0.3, crouch: 0, grounded: true, alive: true, weapon, act: 0, fly: 0, vest: 0, helmet: 0 };
    const names = ['Spine', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm'];
    for (let i = 0; i < 10; i++) avatar.update(pose, 1 / 60);
    const settled = names.map((n) => worldQuat(avatar, n));
    for (let i = 0; i < 240; i++) avatar.update(pose, 1 / 60);
    names.forEach((n, i) => {
      expect(worldQuat(avatar, n).angleTo(settled[i] as THREE.Quaternion), n).toBeLessThan(1e-3);
    });
    // Upright: the head leans with the camera pitch, never past it.
    const headUp = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat(avatar, 'Head'));
    expect(headUp.y).toBeGreaterThan(0.85);
    expect(avatar.object.rotation.y).toBeCloseTo(pose.yaw, 6);
    clipSet = null;
  });
});
