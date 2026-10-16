/**
 * Anti-wallhack interest: enemies behind opaque walls are not sent, close
 * ones always are, a short grace keeps a duck that just ducked behind cover,
 * and ducks in the plane are never sent as poses.
 */
import type { StateView } from '@colyseus/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimWorld, initPhysics, VIS, type BoxDef, type MapDef } from '@qwakk/shared';
import { Interest, type InterestSeat, type ViewerPoint } from '../src/interest.ts';
import { Visibility } from '../src/visibility.ts';

beforeAll(async () => {
  await initPhysics();
});

function world(boxes: BoxDef[]) {
  const cells = 20;
  const map: MapDef = {
    id: 'test',
    seed: 0,
    size: 200,
    seaLevel: -10,
    terrain: { cells, cellSize: 10, heights: new Float32Array((cells + 1) * (cells + 1)) },
    boxes,
    rocks: [],
    spawns: [],
    arena: { x: 0, z: 0, radius: 50 },
    arenaSpawns: [],
    shapes: [],
    water: null,
    br: null,
  };
  return createSimWorld(map);
}

/** A 12 m wide, 6 m tall wall across z = -15. */
const WALL: BoxDef = { kind: 'wall', c: [0, 3, -15], h: [6, 3, 0.3], q: [0, 0, 0, 1] };

function fakeView(): StateView & { has: Set<unknown> } {
  const has = new Set<unknown>();
  return { has, add: (r: unknown) => void has.add(r), remove: (r: unknown) => void has.delete(r) } as unknown as StateView & { has: Set<unknown> };
}

/** One near and one far pose object per id, like the schema entries. */
const refs = new Map<string, { pose: never; farPose: never }>();
function seat(id: string, x: number, z: number, inWorld = true): InterestSeat {
  let r = refs.get(id);
  if (!r) refs.set(id, (r = { pose: { id: `${id}-near` } as never, farPose: { id: `${id}-far` } as never }));
  return { id, x, y: 0, z, vx: 0, vz: 0, yaw: 0, crouch: 0, inWorld, ...r };
}

const eye = (x: number, z: number): ViewerPoint => ({ x, y: 0, z, vx: 0, vz: 0, yaw: 0, crouch: 0, watchId: null, halfRttMs: 20 });

function setup(boxes: BoxDef[]) {
  const sim = world(boxes);
  const interest = new Interest({ enabled: true, cull: true }, new Visibility(sim));
  const view = fakeView();
  interest.addViewer('v', view);
  return { interest, view };
}

describe('anti-wallhack interest', () => {
  it('an enemy behind a wall is not sent; in the open it is', () => {
    const walled = setup([WALL]);
    walled.interest.update([seat('v', 0, 0), seat('t', 0, -30)], 0, () => eye(0, 0));
    expect(walled.interest.sees('v', 't')).toBe(false);
    expect(walled.view.has.size).toBe(0);
    const open = setup([]);
    open.interest.update([seat('v', 0, 0), seat('t', 0, -30)], 0, () => eye(0, 0));
    expect(open.interest.sees('v', 't')).toBe(true);
  });

  it('peeking: an enemy past the end of the wall is sent', () => {
    const { interest } = setup([WALL]);
    interest.update([seat('v', 0, 0), seat('t', 11, -30)], 0, () => eye(0, 0));
    expect(interest.sees('v', 't')).toBe(true);
  });

  it('close enemies are always sent, wall or not', () => {
    const { interest } = setup([{ ...WALL, c: [0, 3, -4] }]);
    interest.update([seat('v', 0, 0), seat('t', 0, -8)], 0, () => eye(0, 0));
    expect(interest.sees('v', 't')).toBe(true);
  });

  it('a duck that goes behind cover stays for the grace period, then is removed', () => {
    const { interest, view } = setup([WALL]);
    interest.update([seat('v', 0, 0), seat('t', 11, -30)], 0, () => eye(0, 0));
    expect(interest.sees('v', 't')).toBe(true);
    interest.update([seat('v', 0, 0), seat('t', 0, -30)], VIS.graceMs / 2, () => eye(0, 0));
    expect(interest.sees('v', 't')).toBe(true);
    interest.update([seat('v', 0, 0), seat('t', 0, -30)], VIS.graceMs + 50, () => eye(0, 0));
    expect(interest.sees('v', 't')).toBe(false);
    expect(view.has.size).toBe(0);
  });

  it('ducks in the plane and enemies beyond the max range are never sent', () => {
    const { interest } = setup([]);
    interest.update([seat('v', 0, 0), seat('p', 0, -20, false), seat('far', 0, -VIS.maxRange - 30)], 0, () => eye(0, 0));
    expect(interest.sees('v', 'p')).toBe(false);
    expect(interest.sees('v', 'far')).toBe(false);
  });

  it('a spectator always gets the duck it watches', () => {
    const { interest } = setup([WALL]);
    interest.update([seat('v', 0, 0), seat('t', 0, -30)], 0, () => ({ ...eye(0, 0), watchId: 't' }));
    expect(interest.sees('v', 't')).toBe(true);
  });
});

describe('allies (teams, party allies)', () => {
  it("an ally's pose reaches its ally through a wall and at any range; an enemy's never does", () => {
    const sim = world([WALL]);
    const ally = (a: string, b: string) => (a === 'v' && b === 'mate') || (a === 'mate' && b === 'v');
    const interest = new Interest({ enabled: true, cull: true, ally }, new Visibility(sim));
    interest.addViewer('v', fakeView());
    const seats = [seat('v', 0, 0), seat('mate', 0, -30), seat('foe', 1, -30), seat('farMate', 0, -VIS.maxRange - 30)];
    interest.update(seats, 0, () => eye(0, 0));
    expect(interest.sees('v', 'mate')).toBe(true);
    expect(interest.sees('v', 'foe')).toBe(false);
    // Long after any grace period, still the same.
    interest.update(seats, VIS.graceMs * 5, () => eye(0, 0));
    expect(interest.sees('v', 'mate')).toBe(true);
    expect(interest.sees('v', 'foe')).toBe(false);
    // A teammate still in the plane is not in the world: not sent.
    interest.update([seat('v', 0, 0), seat('mate', 0, -30, false)], VIS.graceMs * 6, () => eye(0, 0));
    expect(interest.sees('v', 'mate')).toBe(false);
  });
});
