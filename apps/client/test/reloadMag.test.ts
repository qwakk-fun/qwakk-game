import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { magWhere, ReloadMag } from '../src/player/reloadMag.ts';
import type { MagTimeline, WeaponInstance } from '../src/player/weaponModel.ts';

const TL: MagTimeline = {
  seconds: 2.3, out: 0.37, drop: 0.8, fresh: 1.08, in: 1.63,
  hand: { position: new THREE.Vector3(0.05, 0.06, -0.1), quaternion: new THREE.Quaternion() },
};

function rig() {
  const world = new THREE.Scene();
  const gun = new THREE.Group();
  gun.position.set(0.3, 1, -0.4);
  world.add(gun);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.05));
  mag.name = 'Mag';
  mag.position.set(0, -0.01, 0.08);
  gun.add(mag);
  const hand = new THREE.Group();
  world.add(hand);
  const inst: WeaponInstance = {
    root: gun, muzzle: gun, grip: gun, support: gun, eject: gun, mag,
    magSeat: { position: mag.position.clone(), quaternion: mag.quaternion.clone() },
  };
  return { world, gun, mag, hand, inst };
}

describe('reload magazine', () => {
  it('follows the timeline: gun, hand, gone, hand, gun', () => {
    expect([0, 0.5, 1.0, 1.2, 1.7, null].map((t) => magWhere(TL, t))).toEqual(['gun', 'hand', 'none', 'hand', 'gun', 'gun']);
  });

  it('hands the magazine over without a pop, drops a copy, seats the fresh one', () => {
    const { world, gun, mag, hand, inst } = rig();
    const m = new ReloadMag();
    const right = new THREE.Vector3(1, 0, 0);
    const dt = 1 / 60;
    let worldBefore = new THREE.Vector3();
    const children = world.children.length;
    for (let t = 0; t <= 2.3; t += dt) {
      // The clip's hand: at the magazine when it is taken, moving away after.
      hand.position.set(0.3, 0.99 - Math.max(0, t - 0.37) * 0.3, -0.32);
      world.updateMatrixWorld(true);
      worldBefore = mag.getWorldPosition(new THREE.Vector3());
      const was = m.state;
      m.update(dt, inst, TL, t, hand, world, 0, right);
      world.updateMatrixWorld(true);
      if (was === 'gun' && m.state === 'hand') {
        expect(mag.parent).toBe(hand);
        expect(mag.getWorldPosition(new THREE.Vector3()).distanceTo(worldBefore)).toBeLessThan(1e-6);
      }
      if (m.state === 'none') {
        expect(mag.visible).toBe(false);
        expect(m.dropCount).toBe(1);
      }
    }
    expect(m.state).toBe('gun');
    expect(mag.parent).toBe(gun);
    expect(mag.visible).toBe(true);
    expect(mag.position.distanceTo(inst.magSeat!.position)).toBeLessThan(1e-6);
    // The dropped copy is in the world, falling or on the ground, and goes away after a while.
    expect(world.children.length).toBe(children + 1);
    for (let i = 0; i < 400; i++) m.update(dt, inst, TL, null, hand, world, 0, right);
    expect(m.dropCount).toBe(0);
    expect(world.children.length).toBe(children);
  });

  it('a cancelled reload puts the magazine straight back', () => {
    const { world, gun, mag, hand, inst } = rig();
    const m = new ReloadMag();
    m.update(1 / 60, inst, TL, 0.5, hand, world, 0, new THREE.Vector3(1, 0, 0));
    expect(mag.parent).toBe(hand);
    m.update(1 / 60, inst, TL, null, hand, world, 0, new THREE.Vector3(1, 0, 0));
    expect(mag.parent).toBe(gun);
    expect(mag.position.distanceTo(inst.magSeat!.position)).toBeLessThan(1e-6);
  });

  it('without a timeline (old art) or a hand (placeholder duck) nothing moves', () => {
    const { world, gun, mag, hand, inst } = rig();
    const m = new ReloadMag();
    m.update(1 / 60, inst, null, 0.5, hand, world, 0, new THREE.Vector3(1, 0, 0));
    m.update(1 / 60, inst, TL, 0.5, null, world, 0, new THREE.Vector3(1, 0, 0));
    expect(mag.parent).toBe(gun);
  });
});
