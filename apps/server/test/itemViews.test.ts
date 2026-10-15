/**
 * Loot visibility: an item (a death crate) behind a wall is not sent until the
 * viewer can see its spot; an item picked up behind a wall stays as a stale
 * copy until the viewer sees the spot; changes go out the same way.
 */
import type { StateView } from '@colyseus/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimWorld, initPhysics, Item, type BoxDef, type MapDef } from '@qwakk/shared';
import { ItemViews } from '../src/br/itemViews.ts';
import { LootWorld, type LootEvents } from '../src/br/loot.ts';
import type { ViewerPoint } from '../src/interest.ts';
import { Visibility } from '../src/visibility.ts';

beforeAll(async () => {
  await initPhysics();
});

function world(boxes: BoxDef[]) {
  const cells = 20;
  const map: MapDef = {
    id: 'test', seed: 0, size: 200, seaLevel: -10,
    terrain: { cells, cellSize: 10, heights: new Float32Array((cells + 1) * (cells + 1)) },
    boxes, rocks: [], spawns: [], arena: { x: 0, z: 0, radius: 50 }, arenaSpawns: [], shapes: [], water: null, br: null,
  };
  return createSimWorld(map);
}

const WALL: BoxDef = { kind: 'wall', c: [0, 3, -15], h: [6, 3, 0.3], q: [0, 0, 0, 1] };
const eye = (x: number, z: number): ViewerPoint => ({ x, y: 0, z, vx: 0, vz: 0, yaw: 0, crouch: 0, watchId: null, halfRttMs: 0 });

function setup() {
  const sim = world([WALL]);
  const map = new Map<string, unknown>();
  const views: ItemViews = new ItemViews(map as never, new Visibility(sim), () => loot);
  const ev: LootEvents = { added: (e) => views.added(e), changed: (e) => views.changed(e), removed: (e) => views.removed(e) };
  const loot = new LootWorld(sim, ev);
  const held = new Set<unknown>();
  const view = { add: (r: unknown) => void held.add(r), remove: (r: unknown) => void held.delete(r) } as unknown as StateView;
  views.addViewer('v');
  return { loot, views, map, held, view };
}

describe('loot visibility', () => {
  it('a death crate behind a wall is revealed only once its spot is in sight', () => {
    const { loot, views, view } = setup();
    loot.dropCrate(0, 0, -30, [{ kind: Item.Bandage, amount: 2 }]);
    views.update([{ id: 'v', view, point: eye(0, 0) }]);
    expect(views.heldBy('v')).toEqual([]);
    // Step out past the end of the wall: now it is in sight.
    views.update([{ id: 'v', view, point: eye(20, 0) }]);
    expect(views.heldBy('v').length).toBe(1);
  });

  it('an item taken behind a wall stays as a stale copy until its spot is seen', () => {
    const { loot, views, map, view, held } = setup();
    const e = loot.add(Item.Medkit, 1, 0, 0, -30, null);
    views.update([{ id: 'v', view, point: eye(20, 0) }]);
    const [key] = views.heldBy('v');
    expect(key).toBeDefined();
    // Behind the wall now, and someone takes it.
    loot.remove(e);
    views.update([{ id: 'v', view, point: eye(0, 0) }]);
    expect(views.heldBy('v')).toEqual([key]);
    expect(map.has(key!)).toBe(true);
    expect(views.isLive(key!)).toBe(false);
    // Back in sight: gone for this viewer, and gone from the state.
    views.update([{ id: 'v', view, point: eye(20, 0) }]);
    expect(views.heldBy('v')).toEqual([]);
    expect(held.size).toBe(0);
    expect(map.has(key!)).toBe(false);
  });

  it('close items are sent without a line-of-sight test; far ones leave the view', () => {
    const { loot, views, view } = setup();
    loot.add(Item.Rifle, 1, 0, 0, -18, null); // behind the wall, but 4 m from a viewer at z = -14
    views.update([{ id: 'v', view, point: eye(0, -14) }]);
    expect(views.heldBy('v').length).toBe(1);
    views.update([{ id: 'v', view, point: eye(0, 150) }]);
    expect(views.heldBy('v')).toEqual([]);
  });
});
