/**
 * The menu's 3D hero duck (src/menuHero): the aim math, and the pose staying
 * steady and upright however long the cursor moves (the procedural offsets are
 * applied to the restored base pose every frame, never stacked).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { AIM, aimFromScreen, settled, softLimit, stepSpring, type Spring } from '../src/menuHero/aim.ts';
import { HeroDuck } from '../src/menuHero/heroDuck.ts';

describe('menu hero aim math', () => {
  it('eases with a critically damped spring: no overshoot, stable for long frames', () => {
    const s: Spring = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 120; i++) {
      stepSpring(s, 1, AIM.omega, 1 / 60);
      max = Math.max(max, s.x);
    }
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
    expect(settled(s, 1)).toBe(true);
    const big: Spring = { x: 0, v: 0 };
    for (let i = 0; i < 5; i++) stepSpring(big, -0.5, AIM.omega, 0.5);
    expect(Math.abs(big.x + 0.5)).toBeLessThan(1e-3);
  });

  it('soft limits never pass the limit and are about 1:1 near zero', () => {
    expect(softLimit(0.01, 0.5)).toBeCloseTo(0.01, 4);
    for (const x of [1, 10, 1e6]) expect(softLimit(x, 0.5)).toBeLessThanOrEqual(0.5);
    expect(softLimit(-1e6, 0.5)).toBeGreaterThanOrEqual(-0.5);
  });

  it('aims from the screen: tilts toward the cursor, turns right only past the grip, inside natural ranges', () => {
    // Level and left of the grip: the authored pose (the rifle already points there).
    const level = aimFromScreen(-0.8, 0);
    expect(Math.abs(level.yaw)).toBeLessThan(0.1);
    expect(level.pitch).toBeCloseTo(0, 6);
    expect(aimFromScreen(-0.8, 0.4).pitch).toBeGreaterThan(0.2);
    expect(aimFromScreen(-0.8, -0.4).pitch).toBeLessThan(-0.2);
    expect(aimFromScreen(0.8, 0).yaw).toBeGreaterThan(0.25);
    // Anywhere on or far off the page stays inside the limits.
    for (const u of [-50, -3, -0.2, 0, 0.1, 1, 3, 50]) {
      for (const v of [-50, -2, -0.1, 0, 0.1, 2, 50]) {
        const a = aimFromScreen(u, v);
        expect(a.yaw).toBeLessThanOrEqual(AIM.yawRight);
        expect(a.yaw).toBeGreaterThanOrEqual(-AIM.yawLeft);
        expect(a.pitch).toBeLessThanOrEqual(AIM.pitchUp);
        expect(a.pitch).toBeGreaterThanOrEqual(-AIM.pitchDown);
        expect(Number.isFinite(a.yaw) && Number.isFinite(a.pitch)).toBe(true);
      }
    }
  });
});

/** A small duck skeleton with the bone names the hero needs, a rifle with Muzzle and Grip, and two static clips. */
function fixture() {
  const scene = new THREE.Group();
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Bone => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  const hips = bone('Hips', scene, 0, 0.8);
  const spine2 = bone('Spine2', bone('Spine1', bone('Spine', hips, 0, 0.1), 0, 0.1), 0, 0.1);
  bone('Jaw', bone('Head', bone('Neck', spine2, 0, 0.15), 0, 0.15), 0, 0, 0.1);
  bone('RightHand', bone('RightForeArm', bone('RightArm', spine2, -0.15, 0.05), -0.2, 0, 0.1), -0.1, 0, 0.15);
  for (const [side, s] of [['Left', 1], ['Right', -1]] as const) bone(`${side}Foot`, bone(`${side}Leg`, bone(`${side}UpLeg`, hips, 0.12 * s, -0.05), 0, -0.35), 0, -0.35);
  const bones: THREE.Bone[] = [];
  scene.traverse((o) => (o as THREE.Bone).isBone && bones.push(o as THREE.Bone));
  const clip = (name: string, tilt: number) =>
    new THREE.AnimationClip(name, 1, bones.map((b) => {
      const q = b.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
      return new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, 1], [...q.toArray(), ...q.toArray()]);
    }));
  const jaw = new THREE.QuaternionKeyframeTrack('Jaw.quaternion', [0, 0.5, 1], [0, 0, 0, 1, 0.3, 0, 0, 0.954, 0, 0, 0, 1]);
  const rifle = new THREE.Group();
  for (const [name, z] of [['Grip', 0], ['Muzzle', 0.6]] as const) {
    const n = new THREE.Object3D();
    n.name = name;
    n.position.z = z;
    rifle.add(n);
  }
  rifle.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.6), new THREE.MeshStandardMaterial({ color: 0x25272e })));
  const anims = { animations: [clip('Idle', 0), clip('Rifle_Aim', 0.05), new THREE.AnimationClip('Quack', 1, [jaw])] };
  const attach = { position: new THREE.Vector3(0, 0.05, 0), quaternion: new THREE.Quaternion() };
  return { duck: new HeroDuck({ scene }, anims, { scene: rifle }, attach), bones: new Map(bones.map((b) => [b.name, b])), scene };
}

const snapshot = (bones: Map<string, THREE.Bone>) => [...bones.values()].map((b) => b.quaternion.toArray().map((x) => Math.round(x * 1e6) / 1e6));

describe('menu hero pose', () => {
  it('holds the same pose for the same input, frame after frame, and returns to the authored pose', () => {
    const { duck, bones } = fixture();
    duck.pose(0, 0, 0, -1);
    const rest = snapshot(bones);
    duck.pose(0.35, -0.2, 0, -1);
    const aimed = snapshot(bones);
    for (let i = 0; i < 500; i++) duck.pose(0.35, -0.2, 0, -1);
    expect(snapshot(bones)).toEqual(aimed);
    // A long random sweep with recoil and quacks, then back to rest: exactly the authored pose again.
    for (let i = 0; i < 2000; i++) duck.pose(Math.sin(i) * AIM.yawRight, Math.cos(i * 0.7) * AIM.pitchUp, (i % 7) / 7, (i % 11) / 11);
    duck.pose(0, 0, 0, -1);
    expect(snapshot(bones)).toEqual(rest);
  });

  it('stays upright at the limits (the head stays above the hips)', () => {
    const { duck, bones, scene } = fixture();
    const head = bones.get('Head') as THREE.Bone;
    const hips = bones.get('Hips') as THREE.Bone;
    for (const [yaw, pitch] of [[AIM.yawRight, AIM.pitchUp], [-AIM.yawLeft, -AIM.pitchDown], [AIM.yawRight, -AIM.pitchDown], [-AIM.yawLeft, AIM.pitchUp]] as const) {
      for (let i = 0; i < 300; i++) duck.pose(yaw, pitch, 1, 0.5);
      scene.updateMatrixWorld(true);
      const up = head.getWorldPosition(new THREE.Vector3()).sub(hips.getWorldPosition(new THREE.Vector3())).normalize();
      expect(up.y).toBeGreaterThan(0.8);
    }
  });

  it('frees what it owns', () => {
    const { duck } = fixture();
    expect(() => duck.dispose()).not.toThrow();
    expect(duck.scene.children.length).toBe(0);
  });
});
