/**
 * Loot on the server: crates (open on Use, the lid timer, an opened map crate
 * stays open), pickups that do not fit and why, backpack swaps, inventory
 * requests (drop, take, reach, rate limit), the per-viewer crate state
 * (closed contents are never sent; a crate opened behind a wall stays closed
 * for a viewer until it sees the crate) and what bots make of crates.
 */
import type { StateView } from '@colyseus/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { Container, createPlayerSim, createSimWorld, Deny, groundHeightAt, initPhysics, Item, LOOT, Mode, unpackContents, type Armor, type BoxDef, type MapDef, type PlayerSim } from '@qwakk/shared';
import type { BotLike } from '../src/arena.ts';
import { BattleRoyale, DEFAULT_BR, type BrEvents } from '../src/br/battleRoyale.ts';
import { entityScore } from '../src/br/botLoot.ts';
import { ItemViews } from '../src/br/itemViews.ts';
import { LootWorld, type LootEvents } from '../src/br/loot.ts';
import type { ViewerPoint } from '../src/interest.ts';
import { loadSainteCanard } from '../src/maps.ts';
import { Visibility } from '../src/visibility.ts';

beforeAll(async () => {
  await initPhysics();
});

function flatWorld(boxes: BoxDef[] = []) {
  const cells = 20;
  const map: MapDef = {
    id: 'test', seed: 0, size: 200, seaLevel: -10,
    terrain: { cells, cellSize: 10, heights: new Float32Array((cells + 1) * (cells + 1)) },
    boxes, rocks: [], spawns: [], arena: { x: 0, z: 0, radius: 50 }, arenaSpawns: [], shapes: [], water: null, br: null,
  };
  return createSimWorld(map);
}

const gear = (pack = 0): Armor => ({ vest: 0, vestDur: 0, helmet: 0, helmetDur: 0, pack });

/** A duck at (x, z) on the flat ground, looking along -z (toward items placed in front of it). */
function duck(x = 0, z = 0): PlayerSim {
  const s = createPlayerSim(x, 0, z, 0);
  Object.assign(s, { arms: 0, mag0: 0, mag1: 0, res0: 0, res1: 0, bandages: 0, medkits: 0, pitch: -0.4 });
  return s;
}

function lootWorld(boxes: BoxDef[] = []) {
  let tick = 0;
  const sim = flatWorld(boxes);
  const log: string[] = [];
  const ev: LootEvents = { added: (e) => void log.push(`add ${e.id}`), changed: (e) => void log.push(`change ${e.id}`), removed: (e) => void log.push(`remove ${e.id}`) };
  const loot = new LootWorld(sim, ev, () => tick);
  return { loot, log, sim, step: (n: number) => (tick += n) };
}

describe('crates', () => {
  it('Use opens a closed crate; the contents can be taken once the lid is up; an emptied map crate stays open', () => {
    const { loot, step } = lootWorld();
    const crate = loot.add(Item.Crate, 1, 0, 0.7, -1.2, [{ kind: Item.Bandage, amount: 2 }, { kind: Item.Medkit, amount: 1 }], { box: Container.Small, point: 9, open: false });
    const s = duck();
    const a = gear();
    const opened = loot.tryPickup(s, a);
    expect(opened?.opened).toBe(crate);
    expect(crate.open).toBe(true);
    expect(s.bandages).toBe(0);
    // Too early: the lid is still swinging.
    const early = loot.tryPickup(s, a);
    expect(early?.got).toEqual([]);
    expect(early?.deny).toBe(Deny.Opening);
    step(LOOT.crateOpenTicks);
    const r = loot.tryPickup(s, a);
    expect(r?.got).toEqual([{ kind: Item.Bandage, amount: 2 }, { kind: Item.Medkit, amount: 1 }]);
    expect(s.bandages).toBe(2);
    expect(s.medkits).toBe(1);
    // Still there, open and empty, and no longer a pickup target.
    expect(loot.items.has(crate.id)).toBe(true);
    expect(crate.open).toBe(true);
    expect(crate.contents).toEqual([]);
    expect(loot.tryPickup(s, a)).toBeNull();
  });

  it("a dead duck's crate is open from the start and goes away once empty", () => {
    const { loot } = lootWorld();
    const c = loot.dropCrate(0, 0, -1.2, [{ kind: Item.Bandage, amount: 1 }]);
    expect(c?.open).toBe(true);
    const r = loot.tryPickup(duck(), gear());
    expect(r?.got).toEqual([{ kind: Item.Bandage, amount: 1 }]);
    expect(loot.items.size).toBe(0);
  });

  it('takes what fits from a crate, leaves the rest, and says why', () => {
    const { loot } = lootWorld();
    const c = loot.dropCrate(0, 0, -1.2, [{ kind: Item.RifleAmmo, amount: 120 }, { kind: Item.Medkit, amount: 2 }])!;
    const s = duck();
    const r = loot.tryPickup(s, gear(0))!;
    // 50 capacity: 100 rounds (50), then no room for the medkits.
    expect(r.got).toEqual([{ kind: Item.RifleAmmo, amount: 100 }]);
    expect(r.deny).toBe(Deny.Full);
    expect(c.contents).toEqual([{ kind: Item.RifleAmmo, amount: 20 }, { kind: Item.Medkit, amount: 2 }]);
  });

  it('a pickup that does not fit fails with a reason and leaves the item', () => {
    const { loot } = lootWorld();
    const it = loot.add(Item.Medkit, 1, 0, 0, -1.2, null);
    const s = duck();
    s.res0 = 100; // full without a backpack
    const r = loot.tryPickup(s, gear(0))!;
    expect(r.got).toEqual([]);
    expect(r.deny).toBe(Deny.Full);
    expect(r.denyKind).toBe(Item.Medkit);
    expect(loot.items.has(it.id)).toBe(true);
  });

  it('a better backpack swaps: the old one drops next to the duck', () => {
    const { loot } = lootWorld();
    loot.add(Item.Backpack3, 1, 0, 0, -1.2, null);
    const a = gear(1);
    const r = loot.tryPickup(duck(), a)!;
    expect(r.got).toEqual([{ kind: Item.Backpack3, amount: 1 }]);
    expect(a.pack).toBe(3);
    const left = [...loot.items.values()];
    expect(left.map((e) => e.kind)).toEqual([Item.Backpack1]);
    expect(Math.hypot(left[0]!.x, left[0]!.z)).toBeLessThan(1.2);
  });

  it('a dropped gun keeps its magazine on the ground', () => {
    const { loot } = lootWorld();
    const e = loot.dropAt(duck(), { kind: Item.Rifle, amount: 1, mag: 7 });
    expect(e.extra).toEqual({ mag: 7 });
    const s = duck();
    loot.take(s, gear(), e);
    expect(s.mag0).toBe(7);
  });
});

describe('crates per viewer', () => {
  const WALL: BoxDef = { kind: 'wall', c: [0, 3, -15], h: [6, 3, 0.3], q: [0, 0, 0, 1] };
  const eye = (x: number, z: number): ViewerPoint => ({ x, y: 0, z, vx: 0, vz: 0, yaw: 0, crouch: 0, watchId: null, halfRttMs: 0 });

  function setup() {
    const sim = flatWorld([WALL]);
    const map = new Map<string, { open: number; c: string; box: number; pt: number }>();
    const views: ItemViews = new ItemViews(map as never, new Visibility(sim), () => loot);
    const ev: LootEvents = { added: (e) => views.added(e), changed: (e) => views.changed(e), removed: (e) => views.removed(e) };
    const loot = new LootWorld(sim, ev, () => 100);
    const view = { add: () => undefined, remove: () => undefined } as unknown as StateView;
    views.addViewer('v');
    const held = () => views.heldBy('v').map((k) => {
      const h = map.get(k)!;
      return { open: h.open, c: h.c ?? '', box: h.box, pt: h.pt };
    });
    return { loot, views, view, held };
  }

  it('a closed crate never carries its contents; an open one does', () => {
    const { loot, views, view, held } = setup();
    const c = loot.add(Item.Crate, 1, 20, 0.7, 0, [{ kind: Item.Medkit, amount: 1 }], { box: Container.Large, point: 41, open: false });
    views.update([{ id: 'v', view, point: eye(25, 0) }]);
    expect(held()).toEqual([{ open: 0, c: '', box: Container.Large, pt: 42 }]);
    loot.openCrate(c);
    views.update([{ id: 'v', view, point: eye(25, 0) }]);
    expect(held().length).toBe(1);
    expect(held()[0]!.open).toBe(1);
    expect(unpackContents(held()[0]!.c)).toEqual([{ kind: Item.Medkit, amount: 1 }]);
  });

  it('a crate opened behind a wall stays closed for a viewer until it sees the crate again', () => {
    const { loot, views, view, held } = setup();
    const c = loot.add(Item.Crate, 1, 0, 0.7, -30, [{ kind: Item.Bandage, amount: 2 }], { box: Container.Small, point: 3, open: false });
    views.update([{ id: 'v', view, point: eye(20, 0) }]);
    expect(held().map((h) => h.open)).toEqual([0]);
    loot.openCrate(c);
    // Behind the wall now: the viewer keeps its closed copy.
    views.update([{ id: 'v', view, point: eye(0, 0) }]);
    expect(held().map((h) => h.open)).toEqual([0]);
    // In sight again: open.
    views.update([{ id: 'v', view, point: eye(20, 0) }]);
    expect(held().map((h) => h.open)).toEqual([1]);
  });
});

describe('bots and crates', () => {
  it('a closed crate is worth a look, an open one its best content that fits, an emptied one nothing', () => {
    const { loot } = lootWorld();
    const c = loot.add(Item.Crate, 1, 0, 0.7, -1.2, [{ kind: Item.Medkit, amount: 1 }], { box: Container.Small, point: 1, open: false });
    const s = duck();
    expect(entityScore(s, gear(), c)).toBeGreaterThan(0);
    loot.openCrate(c);
    expect(entityScore(s, gear(), c)).toBeGreaterThan(0);
    s.res0 = 100; // full: the medkit does not fit
    expect(entityScore(s, gear(), c)).toBe(0);
    s.res0 = 0;
    c.contents = [];
    expect(entityScore(s, gear(), c)).toBe(0);
  });
});

describe('inventory requests', () => {
  function events(log: string[]): BrEvents {
    return {
      shot: () => undefined, hit: () => undefined, damaged: () => undefined, kill: () => undefined, result: () => undefined, started: () => undefined, ended: () => undefined,
      picked: (_s, got) => void log.push(...got.map((g) => `+${g.amount} ${g.kind}`)),
      denied: (_s, reason, kind) => void log.push(`no ${reason} ${kind}`),
      loot: { added: () => undefined, changed: () => undefined, removed: () => undefined },
    };
  }
  const noBot = (): BotLike => {
    throw new Error('no bots in this test');
  };

  /** One duck on the ground in a locked match, at a spot with open ground in front. */
  function match() {
    const log: string[] = [];
    const def = loadSainteCanard().def;
    const br = new BattleRoyale(createSimWorld(def), { ...DEFAULT_BR, bots: false, seed: 5, createBot: noBot }, events(log));
    br.beginTick(0, 0);
    br.addHuman('a', 'A');
    br.addHuman('b', 'B');
    br.lock();
    br.beginTick(10, 4000);
    const seat = br.seats.get('a')!;
    const [x, y0, z] = def.spawns[0] ?? [0, 10, 0];
    const y = groundHeightAt(br.botContext.sim, x, y0 + 3, z);
    Object.assign(seat.sim, { x, y, z, mode: Mode.Ground, grounded: 1, yaw: 0, pitch: -0.5 });
    return { br, seat, log };
  }

  it('drops an item next to the duck and takes it back; out of reach or a wrong kind is refused', () => {
    const { br, seat, log } = match();
    seat.sim.res0 = 60;
    expect(br.inventoryOp('a', 'drop', Item.RifleAmmo, 30, 0)).toBe(true);
    expect(seat.sim.res0).toBe(30);
    const dropped = [...br.loot.items.values()].find((e) => e.kind === Item.RifleAmmo && e.amount === 30 && Math.hypot(e.x - seat.sim.x, e.z - seat.sim.z) < 1.5)!;
    expect(dropped).toBeDefined();
    const num = Number(dropped.id.slice(1));
    // A wrong kind for that entity: refused.
    expect(br.inventoryOp('a', 'take', num, -1, Item.Medkit)).toBe(false);
    expect(br.inventoryOp('a', 'take', num, -1, Item.RifleAmmo)).toBe(true);
    expect(seat.sim.res0).toBe(60);
    expect(log).toContain(`+30 ${Item.RifleAmmo}`);
    // Out of reach: the other duck cannot take what lies next to A.
    const b = br.seats.get('b')!;
    Object.assign(b.sim, { x: seat.sim.x + 30, y: seat.sim.y, z: seat.sim.z, mode: Mode.Ground });
    expect(br.inventoryOp('b', 'take', num, -1, Item.RifleAmmo)).toBe(false);
  });

  it('refuses to drop what you do not have, with a reason; and is rate limited', () => {
    const { br, log } = match();
    expect(br.inventoryOp('a', 'drop', Item.Medkit, 1, 0)).toBe(false);
    expect(log).toContain(`no ${Deny.Empty} ${Item.Medkit}`);
    const seat = br.seats.get('a')!;
    seat.sim.bandages = 10;
    seat.sim.res0 = 0;
    let ok = 0;
    for (let i = 0; i < 20; i++) if (br.inventoryOp('a', 'drop', Item.Bandage, 1, 0)) ok++;
    expect(ok).toBeLessThan(10);
    expect(ok).toBeGreaterThan(0);
  });

  it('nothing while in the plane or dead', () => {
    const { br, seat } = match();
    seat.sim.bandages = 3;
    seat.sim.mode = Mode.Plane;
    expect(br.inventoryOp('a', 'drop', Item.Bandage, 1, 0)).toBe(false);
    seat.sim.mode = Mode.Ground;
    seat.sim.alive = 0;
    expect(br.inventoryOp('a', 'drop', Item.Bandage, 1, 0)).toBe(false);
    expect(seat.sim.bandages).toBe(3);
  });

  it('a closed crate cannot be probed or looted through requests', () => {
    const { br, seat, log } = match();
    const crate = br.loot.add(Item.Crate, 1, seat.sim.x, seat.sim.y + 0.7, seat.sim.z - 1.2, [{ kind: Item.Medkit, amount: 1 }], { box: Container.Small, point: 999, open: false });
    const num = Number(crate.id.slice(1));
    log.length = 0;
    expect(br.inventoryOp('a', 'take', num, 0, Item.Medkit)).toBe(false);
    expect(br.inventoryOp('a', 'take', num, 0, Item.Bandage)).toBe(false);
    expect(log).toEqual([]);
    expect(seat.sim.medkits).toBe(0);
  });

  it('every map crate spawns closed, with its contents on the server only', () => {
    const { br } = match();
    const crates = [...br.loot.items.values()].filter((e) => e.kind === Item.Crate);
    const points = (loadSainteCanard().def.br?.loot ?? []).filter((p) => p.container !== Container.None);
    expect(crates.length).toBe(points.length);
    expect(crates.every((c) => !c.open && c.point >= 0 && (c.contents?.length ?? 0) > 0)).toBe(true);
  });
});
