import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createSimWorld, initPhysics, type DmKillcam, type DmReplayPose, type SimWorld } from '@qwakk/shared';
import { DeathReplay } from '../src/game/deathReplay.ts';
import type { Avatar } from '../src/player/avatar.ts';

let sim: SimWorld;
beforeAll(initPhysics);
beforeEach(() => {
  sim = createSimWorld({ id: 'greybox', seed: 1, size: 400, seaLevel: -1,
    terrain: { cells: 1, cellSize: 400, heights: new Float32Array(4) },
    boxes: [], rocks: [], spawns: [], arena: { x: 0, z: 0, radius: 200 }, arenaSpawns: [], shapes: [], water: null, br: null });
});
afterEach(() => sim.dispose());
const pose = (x: number): DmReplayPose => ({ x, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, alive: true, weapon: 0, act: 0, aim: 0 });
function clip(): DmKillcam {
  return { killerId: 'killer', victimId: 'me', victimLife: 1,
    frames: [0, 100, 200, 300, 400].map(at => ({ at, killer: pose(20 + at / 100), victim: pose(0) })) };
}
function actor(): Avatar {
  const object = new THREE.Group();
  object.visible = false;
  return { object, update: vi.fn(), setDetail: vi.fn(), onMagEvent: null } as unknown as Avatar;
}

describe('killer replay', () => {
  it('follows the killer even when previously hidden, hides others and restores the live camera', () => {
    const replay = new DeathReplay(sim), camera = new THREE.PerspectiveCamera();
    const killer = actor(), me = actor(), unrelated = actor();
    replay.start(1000, clip());
    camera.position.set(0, 50, 0);
    expect(replay.draw(1050, camera, [['me', me], ['killer', killer], ['other', unrelated]], 0.016)).toBe(true);
    expect(camera.position.x).toBeGreaterThan(20); // near killer, never the victim at x=0
    expect(camera.position.x).toBeLessThan(22);
    expect(killer.object.visible).toBe(true);
    expect(killer.update).toHaveBeenLastCalledWith(expect.objectContaining({ x: 20.5 }), 0.016);
    expect(unrelated.object.visible).toBe(false);
    expect(unrelated.update).not.toHaveBeenCalled();
    replay.restoreCamera();
    expect(camera.position.toArray()).toEqual([0, 50, 0]);
    replay.syncLife(2);
    expect(replay.active).toBe(false);
  });

  it('bounds duration, ends playback and supports immediate skip', () => {
    const replay = new DeathReplay(sim), camera = new THREE.PerspectiveCamera();
    const data = clip();
    data.frames = Array.from({ length: 200 }, (_, i) => ({ at: i * 100, killer: pose(i), victim: pose(0) }));
    const killer = actor();
    replay.start(20000, data);
    replay.draw(20000, camera, [['killer', killer]], 0.016);
    expect(camera.position.x).toBeGreaterThanOrEqual(174);
    replay.restoreCamera();
    expect(replay.draw(22600, camera, [], 0.016)).toBe(false);
    replay.start(23000, clip());
    expect(replay.active).toBe(true);
    replay.clear();
    expect(replay.active).toBe(false);
  });

  it('does not glide across teleports and shows the terminal death pose', () => {
    const replay = new DeathReplay(sim), camera = new THREE.PerspectiveCamera(), killer = actor(), me = actor();
    const data = clip();
    data.frames = [{ at: 0, killer: pose(20), victim: pose(0) }, { at: 100, killer: pose(100), victim: { ...pose(0), alive: false } }];
    replay.start(0, data);
    replay.draw(50, camera, [['killer', killer], ['me', me]], 0.016);
    expect(killer.update).toHaveBeenLastCalledWith(expect.objectContaining({ x: 20 }), 0.016);
    replay.restoreCamera();
    replay.draw(100, camera, [['killer', killer], ['me', me]], 0.016);
    expect(me.update).toHaveBeenLastCalledWith(expect.objectContaining({ alive: false }), 0.016);
    replay.restoreCamera();
  });
});
