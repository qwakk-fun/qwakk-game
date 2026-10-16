/**
 * Regression: a hit flinch or a quack started between frames bound the bones
 * no running clip held (an unarmed duck's torso and arms) while they still
 * carried last frame's procedural layer. When the clip stopped, the mixer
 * restored that pose, it became the next base pose, and the procedural layer
 * went on top again: every hit turned the arms and torso a bit further.
 * One-shots now start inside the frame, after the base pose is restored.
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
  bone('Jaw', bone('Head', bone('Neck', spine2, 0, 0.15), 0, 0.15), 0, 0.05, 0.1);
  for (const [side, s] of [['Left', 1], ['Right', -1]] as const) {
    bone(`${side}Hand`, bone(`${side}ForeArm`, bone(`${side}Arm`, spine2, 0.15 * s, 0.05), 0.25 * s, 0), 0.22 * s, 0);
    bone(`${side}Foot`, bone(`${side}Leg`, bone(`${side}UpLeg`, hips, 0.12 * s, -0.05), 0, -0.35), 0, -0.35);
  }
  return root;
}

/** Idle on the legs only (so an unarmed duck's upper body is held by no clip), plus a full-body flinch and a quack. */
function clipsFor(root: THREE.Object3D): ClipSet {
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const clip = (name: string, tilt: number, only?: (n: string) => boolean) =>
    new THREE.AnimationClip(name, 0.4, bones.filter((b) => !only || only(b.name)).map((b) => {
      const q0 = b.quaternion.clone();
      const q1 = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
      return new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, 0.2, 0.4], [...q0.toArray(), ...q1.toArray(), ...q0.toArray()]);
    }));
  const full = new Map([
    ['Idle', clip('Idle', 0, (n) => !UPPER_BONES.has(n))],
    ['Hit_React', clip('Hit_React', 0.4)],
    ['Quack', clip('Quack', 0.5)],
  ]);
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

describe('one-shot clips on an unarmed duck', () => {
  it('hit flinches and quacks between frames leave no lasting offset', () => {
    const model = skeleton();
    clipSet = clipsFor(model);
    const avatar = new Avatar();
    avatar.setModel(model);
    const pose = { x: 0, y: 0, z: 0, yaw: 0.4, pitch: -0.35, crouch: 0, grounded: true, alive: true, weapon: 2, act: 0, fly: 0, vest: 0, helmet: 0 };
    const names = ['Spine', 'Spine2', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm'];
    for (let i = 0; i < 30; i++) avatar.update(pose, 1 / 60);
    const settled = names.map((n) => worldQuat(avatar, n));
    for (let round = 0; round < 6; round++) {
      // Called from network events, between two frames.
      if (round % 2) avatar.quack();
      else avatar.hitReact();
      for (let i = 0; i < 60; i++) avatar.update(pose, 1 / 60);
    }
    names.forEach((n, i) => {
      expect(worldQuat(avatar, n).angleTo(settled[i] as THREE.Quaternion), n).toBeLessThan(1e-3);
    });
    clipSet = null;
  });
});
