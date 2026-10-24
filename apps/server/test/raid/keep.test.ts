/**
 * Hunt Season v2 on Pond Keep, the server's side of the keep, headless with
 * the map's navmesh: the gate (hunters hammer it, its looks, broken lets
 * them in, a duck repairs it and a hit pauses the repair), the drawbridge
 * (the lever, its travel and cooldown, coming down by itself, never rising
 * under a duck, the KEEP_CLOSED bit on every duck, hunters on it splashed
 * into the moat, the Big Hunter dunked) and the hunters' way across while it
 * is up (raft lanes), the bread cannons (manned by the sim, two ducks on one
 * cannon, loaves, heat and the fire rate, the burst and its knockback).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { BridgeState, Button, emptyInput, exMan, exOcc, GateState, HunterAct, HunterKind, inKeep, KEEP_CLOSED, onIsland, RaidStage, TICK_RATE, type InputFrame } from '@qwakk/shared';
import { LeverDenied, RaidKillHow } from '@qwakk/shared/net';
import type { BotLike, Seat } from '../../src/arena.ts';
import { headlessRaid, keepNav, type HeadlessRaid } from '../../bench/raidHeadless.ts';
import type { RaidEvents } from '../../src/raid/raid.ts';
import { gateSpot } from '../../src/raid/spawns.ts';

/** A duck driven by the test: it sends whatever `next` holds. */
function puppet(): BotLike & { next: InputFrame } {
  const next = emptyInput();
  return { next, think: () => ({ ...next }), respawned: () => undefined, damagedFrom: () => undefined };
}

async function raid(ducks = 1, rules = {}, events: Partial<RaidEvents> = {}): Promise<{ h: HeadlessRaid; seats: Seat[]; bots: (BotLike & { next: InputFrame })[] }> {
  const h = await headlessRaid({ ducks: 0, rules, events });
  const bots = Array.from({ length: ducks }, () => puppet());
  for (const b of bots) h.raid.addBotDuck(b);
  h.raid.beginTick(0, 0);
  return { h, seats: [...h.raid.seats.values()], bots };
}

/** Keep the wave going with no hunter in play: one far off in a corner, stunned for good. */
function stall(h: HeadlessRaid): void {
  const x = h.raid.hunts.spawnForTest(HunterKind.Rifleman, -110, 110);
  x.swim = 1e9;
}

/** The ducks out of the way: far off on the mainland (no hunter goes for them, the deck stays free). */
function away(h: HeadlessRaid): void {
  for (const s of h.raid.seats.values()) Object.assign(s.sim, { x: -100 + s.pid * 2, y: 30, z: -100 });
}

beforeAll(async () => {
  await keepNav();
}, 180_000);

describe('the gate', () => {
  it('hunters at the gate hammer it: intact, damaged, broken; broken lets them in for the core', async () => {
    const events: string[] = [];
    const { h } = await raid(1, { gateHp: 200 }, { gateBroken: () => void events.push('broken') });
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    away(h);
    h.raid.huntersAtGate(4);
    expect(h.raid.keep.gateState).toBe(GateState.Intact);
    h.run(4);
    expect(h.raid.keep.gateHp).toBeLessThan(200);
    expect([...h.raid.hunts.hunters.values()].some((x) => x.act === HunterAct.Hammer)).toBe(true);
    h.run(20, (r) => r.keep.gateHp <= 100);
    expect(h.raid.keep.gateState).toBe(GateState.Damaged);
    h.run(30, (r) => r.keep.gateBroken);
    expect(h.raid.keep.gateState).toBe(GateState.Broken);
    expect(events).toEqual(['broken']);
    // Now they go in: some hunter gets inside the walls and hammers the core.
    const core = h.raid.coreHp;
    h.run(25, (r) => r.coreHp < core);
    expect([...h.raid.hunts.hunters.values()].some((x) => inKeep(h.raid.geometry, x.x, x.z))).toBe(true);
    expect(h.raid.coreHp).toBeLessThan(core);
  }, 60_000);

  it('never lets a hunter through while it holds (not even a stuck one)', async () => {
    const { h } = await raid(1, { gateHp: 100000 });
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    // The duck stands in the courtyard in plain view behind the gate: the hunters want it.
    const g = h.raid.geometry;
    const seat = [...h.raid.seats.values()][0]!;
    Object.assign(seat.sim, { x: g.gate.x - g.gate.nx * 5, y: g.gate.y, z: g.gate.z - g.gate.nz * 5 });
    h.raid.hold = true;
    h.raid.huntersAtGate(6);
    for (const k of [HunterKind.Dog, HunterKind.Trapper, HunterKind.Boss]) {
      const p = gateSpot(g, 7);
      h.raid.hunts.spawnForTest(k, p.x + g.gate.nx * 4, p.z + g.gate.nz * 4);
    }
    for (let i = 0; i < 40; i++) {
      h.run(0.5);
      for (const x of h.raid.hunts.hunters.values()) expect(inKeep(g, x.x, x.z), `${x.id} got in`).toBe(false);
    }
  }, 60_000);

  it('a duck holding Use at it repairs it; a hit pauses the repair; repaired past 30% a broken gate holds again', async () => {
    let fixed = 0;
    const { h, seats, bots } = await raid(1, { gateHp: 1000, gateRepairPerSecond: 50 }, { gateFixed: () => void fixed++ });
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    stall(h);
    const seat = seats[0]!;
    h.raid.moveForTest(seat, 6);
    h.raid.keep.setGate(0);
    expect(h.raid.keep.gateBroken).toBe(true);
    bots[0]!.next.buttons = Button.Use;
    h.run(2);
    const after2 = h.raid.keep.gateHp;
    expect(after2).toBeGreaterThan(60);
    expect(h.raid.keep.repairing(seat.id)).toBe(true);
    // A hit pauses it for a moment.
    h.raid.hurtDuck(seat.id, 1, 0, 0, HunterKind.Rifleman, false);
    const paused = h.raid.keep.gateHp;
    h.run(1);
    expect(h.raid.keep.gateHp).toBeCloseTo(paused, 5);
    h.run(10, (r) => !r.keep.gateBroken);
    expect(h.raid.keep.gateBroken).toBe(false);
    expect(h.raid.keep.gateHp).toBeGreaterThanOrEqual(300);
    expect(fixed).toBe(1);
    // Let go: no more repair.
    bots[0]!.next.buttons = 0;
    const held = h.raid.keep.gateHp;
    h.run(1);
    expect(h.raid.keep.gateHp).toBe(held);
  }, 60_000);
});

describe('the drawbridge', () => {
  it('the lever raises it (travel, cooldown), every duck gets the closed bit, it comes down by itself', async () => {
    const moves: [number, number][] = [];
    const denied: number[] = [];
    const { h, seats, bots } = await raid(2, { bridgeMoveSeconds: 2, bridgeCooldownSeconds: 4, bridgeUpMaxSeconds: 6 }, { bridge: (s, by) => void moves.push([s, by?.pid ?? 0]), leverDenied: (_s, r) => void denied.push(r) });
    const [a, b] = seats;
    h.raid.moveForTest(a!, 5);
    h.run(0.2);
    bots[0]!.next.buttons = Button.Use;
    h.run(0.1);
    bots[0]!.next.buttons = 0;
    expect(h.raid.keep.bridge).toBe(BridgeState.Raising);
    expect(moves).toEqual([[BridgeState.Raising, a!.pid]]);
    h.run(0.1);
    for (const s of [a!, b!]) expect(s.sim.dmBuff & KEEP_CLOSED).toBe(KEEP_CLOSED);
    // Pulled again while it moves, or cooling down: nothing, and the duck is told why.
    bots[0]!.next.buttons = Button.Use;
    h.run(0.1);
    bots[0]!.next.buttons = 0;
    expect(denied).toEqual([LeverDenied.Moving]);
    h.run(2);
    expect(h.raid.keep.bridge).toBe(BridgeState.Up);
    bots[0]!.next.buttons = Button.Use;
    h.run(0.1);
    bots[0]!.next.buttons = 0;
    expect(denied).toEqual([LeverDenied.Moving, LeverDenied.Cooldown]);
    // Up at most 6 s: down by itself (by nobody), then open again.
    h.run(6.5);
    expect(moves.at(-1)).toEqual([BridgeState.Lowering, 0]);
    h.run(2.2);
    expect(h.raid.keep.bridge).toBe(BridgeState.Down);
    h.run(0.1);
    for (const s of [a!, b!]) expect(s.sim.dmBuff & KEEP_CLOSED).toBe(0);
  }, 60_000);

  it('never rises under a duck', async () => {
    const denied: number[] = [];
    const { h, seats } = await raid(2, {}, { leverDenied: (_s, r) => void denied.push(r) });
    const [a, b] = seats;
    h.raid.moveForTest(a!, 5);
    h.raid.moveForTest(b!, 8);
    const g = h.raid.geometry.bridge;
    Object.assign(b!.sim, { x: g.x + g.dx * 5, z: g.z + g.dz * 5, y: g.y });
    h.run(0.2);
    expect(h.raid.pullLever(a!)).toBe(LeverDenied.DuckOnBridge);
    expect(denied).toEqual([LeverDenied.DuckOnBridge]);
    expect(h.raid.keep.bridge).toBe(BridgeState.Down);
  });

  it('never rises under a duck that reaches the deck later in the same tick (the raise waits for the tick boundary)', async () => {
    const denied: number[] = [];
    const moves: number[] = [];
    const { h, seats } = await raid(2, {}, { leverDenied: (_s, r) => void denied.push(r), bridge: (st) => void moves.push(st) });
    const [a, b] = seats;
    h.raid.moveForTest(a!, 5);
    h.raid.moveForTest(b!, 8);
    h.run(0.2);
    // A pulls with the deck clear; B (stepping after A in that tick) lands on the deck.
    expect(h.raid.pullLever(a!)).toBe(0);
    const g = h.raid.geometry.bridge;
    Object.assign(b!.sim, { x: g.x + g.dx * (g.len - 0.4), z: g.z + g.dz * (g.len - 0.4), y: g.y, vx: 0, vy: 0, vz: 0 });
    h.run(1 / TICK_RATE);
    expect(h.raid.keep.bridge).toBe(BridgeState.Down);
    expect(moves).toEqual([]);
    expect(denied).toEqual([LeverDenied.DuckOnBridge]);
    expect(b!.sim.dmBuff & KEEP_CLOSED).toBe(0);
    // B steps off: the next pull raises it.
    h.raid.moveForTest(b!, 8);
    h.run(0.1);
    expect(h.raid.pullLever(a!)).toBe(0);
    h.run(1 / TICK_RATE);
    expect(h.raid.keep.bridge).toBe(BridgeState.Raising);
    for (const s of [a!, b!]) expect(s.sim.dmBuff & KEEP_CLOSED).toBe(KEEP_CLOSED);
  });

  it('hunters on the deck go into the moat (credited to the duck at the lever); the Big Hunter is dunked', async () => {
    const downs: [number, number][] = [];
    const splashes: number[] = [];
    const { h, seats } = await raid(1, {}, { hunterDown: (x, _k, _h, how) => void downs.push([x.kind, how]), splash: (n) => void splashes.push(n) });
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    stall(h);
    const seat = seats[0]!;
    h.raid.moveForTest(seat, 5);
    const b = h.raid.geometry.bridge;
    const on = (k: number, along: number) => h.raid.hunts.spawnForTest(k, b.x + b.dx * along, b.z + b.dz * along);
    on(HunterKind.Rifleman, 3);
    on(HunterKind.Dog, 6);
    const boss = on(HunterKind.Boss, 9);
    const bossHp = boss.hp;
    h.run(0.1);
    expect(h.raid.pullLever(seat)).toBe(0);
    // The raise starts at the end of the tick, once every duck has stepped.
    expect(h.raid.keep.bridge).toBe(BridgeState.Down);
    h.run(1 / TICK_RATE);
    expect(h.raid.keep.bridge).toBe(BridgeState.Raising);
    expect(splashes).toEqual([3]);
    expect(downs.filter((d) => d[1] === RaidKillHow.Splash).map((d) => d[0]).sort()).toEqual([HunterKind.Rifleman, HunterKind.Dog]);
    expect(h.raid.ducks.get(seat.id)!.kills).toBe(2);
    expect(boss.downTicks).toBe(0);
    expect(boss.hp).toBeLessThan(bossHp);
    expect(boss.swim).toBeGreaterThan(0);
    expect(onIsland(h.raid.geometry, boss.x, boss.z)).toBe(false);
  });

  it('hunters hammering the gate (in the gate passage) go into the moat when it rises, and the gate is then safe', async () => {
    const downs: number[] = [];
    const { h, seats } = await raid(1, {}, { hunterDown: (_x, _k, _h, how) => void downs.push(how) });
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    stall(h);
    const seat = seats[0]!;
    h.raid.hold = true;
    h.raid.huntersAtGate(4);
    h.run(3);
    expect(h.raid.keep.gateHp).toBeLessThan(h.raid.keep.gateMax);
    h.raid.moveForTest(seat, 5);
    h.run(0.2);
    expect(h.raid.pullLever(seat)).toBe(0);
    h.run(1 / TICK_RATE);
    expect(downs.filter((x) => x === RaidKillHow.Splash)).toHaveLength(4);
    const gate = h.raid.keep.gateHp;
    h.raid.huntersAtGate(2);
    h.run(3);
    expect(h.raid.keep.gateHp).toBe(gate);
  });

  it('while it is up, hunters bound for the gate paddle across a raft lane and wait on the island', async () => {
    const { h } = await raid(1, { bridgeUpMaxSeconds: 120, raftSpeed: 3 });
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    away(h);
    h.raid.keep.forceBridge(BridgeState.Up, h.raid.currentTick);
    const lane = h.raid.geometry.mark.raftLanes[0]!;
    const x = h.raid.hunts.spawnForTest(HunterKind.Rifleman, lane.from[0] + (lane.from[0] - lane.to[0]) * 0.8, lane.from[1] + (lane.from[1] - lane.to[1]) * 0.8);
    let rafted = false;
    h.run(40, () => {
      if (x.raft) rafted = true;
      return rafted && !x.raft && onIsland(h.raid.geometry, x.x, x.z);
    });
    expect(rafted).toBe(true);
    expect(onIsland(h.raid.geometry, x.x, x.z)).toBe(true);
    // On the island with the bridge still up: it does not hammer the gate.
    const gate = h.raid.keep.gateHp;
    h.run(8);
    expect(h.raid.keep.gateHp).toBe(gate);
    expect(inKeep(h.raid.geometry, x.x, x.z)).toBe(false);
  }, 60_000);

  it('no hunter walks across the moat on foot', async () => {
    const { h } = await raid(1, { bridgeUpMaxSeconds: 120 });
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    away(h);
    h.raid.keep.forceBridge(BridgeState.Up, h.raid.currentTick);
    const g = h.raid.geometry;
    const water = h.raid.world.map.water!;
    const list = g.mark.hunterSpawns.slice(0, 6).map(([x, , z], i) => h.raid.hunts.spawnForTest(i % 2 ? HunterKind.Dog : HunterKind.Trapper, x, z));
    for (let i = 0; i < 60; i++) {
      h.run(0.5);
      for (const x of list) if (!x.raft && x.downTicks === 0) expect(x.y, `${x.id} in the moat`).toBeGreaterThan(water.sea - 0.7);
    }
  }, 60_000);
});

describe('the stuck safety net', () => {
  /** A hunter on the far bank that cannot move (a stand-in for one wedged in a pocket of the map). */
  function wedged(h: HeadlessRaid, kind: number) {
    const b = h.raid.geometry.bridge;
    const x = h.raid.hunts.spawnForTest(kind, b.x + b.dx * (b.len + 4), b.z + b.dz * (b.len + 4));
    x.mover.step = () => false;
    return x;
  }

  it('waiting at a raised drawbridge is busy (no regroup); stuck while it is down, a hunter regroups, alive, and the wave does not clear', async () => {
    const cleared: number[] = [];
    const downs: number[] = [];
    const { h, seats } = await raid(1, { bridgeUpMaxSeconds: 120 }, { waveClear: (w) => void cleared.push(w), hunterDown: (x) => void downs.push(x.kind) });
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    // The duck hides in the keep (no hunter sees it).
    h.raid.moveForTest(seats[0]!, 5);
    h.raid.keep.forceBridge(BridgeState.Up, h.raid.currentTick);
    const x = wedged(h, HunterKind.Rifleman);
    h.run(30);
    expect(x.targetId).toBeNull();
    expect(h.raid.hunts.regrouped).toBe(0);
    expect(h.raid.hunts.hunters.has(x.id)).toBe(true);
    expect(cleared).toEqual([]);
    expect(h.raid.stage).toBe(RaidStage.Wave);
    // Bridge down, still wedged: after 20 s it goes back to a trench exit (not defeated), the wave goes on.
    h.raid.keep.forceBridge(BridgeState.Down, h.raid.currentTick);
    const hp = x.hp;
    const from = { x: x.x, z: x.z };
    h.run(21, () => h.raid.hunts.regrouped > 0);
    expect(h.raid.hunts.regrouped).toBe(1);
    expect(Math.hypot(x.x - from.x, x.z - from.z)).toBeGreaterThan(5);
    expect(x.downTicks).toBe(0);
    expect(x.hp).toBe(hp);
    expect(downs).toEqual([]);
    expect(cleared).toEqual([]);
    expect(h.raid.stage).toBe(RaidStage.Wave);
    expect(h.raid.ducks.get(seats[0]!.id)!.wavesCleared).toBe(0);
    expect(h.raid.ducks.get(seats[0]!.id)!.kills).toBe(0);
  }, 120_000);

  it('the Big Hunter gives boss XP only when a duck defeats it', async () => {
    const { h, seats } = await raid(1);
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    stall(h);
    const seat = seats[0]!;
    const duck = h.raid.ducks.get(seat.id)!;
    const boss = h.raid.hunts.spawnForTest(HunterKind.Boss, -100, 100);
    h.raid.hunts.hurt(boss.id, 10, seat.id, false, 0, 0);
    // Out without a killer (not by a duck): nothing for those who hurt it.
    h.raid.hunts.defeatAll(null);
    expect(duck.bossKills).toBe(0);
    const again = h.raid.hunts.spawnForTest(HunterKind.Boss, -100, 100);
    h.raid.hunts.hurt(again.id, 1e6, seat.id, false, 0, 0);
    expect(duck.bossKills).toBe(1);
  });
});

describe('the bread cannons', () => {
  it('a duck mans one with Use (sim bit), the server sees it and the others learn it is taken', async () => {
    const { h, seats, bots } = await raid(2);
    const [a, b] = seats;
    h.raid.moveForTest(a!, 1);
    h.raid.moveForTest(b!, 1);
    h.run(0.3);
    // Both press Use on the same tick at the same cannon: one keeps it.
    bots[0]!.next.buttons = Button.Use;
    bots[1]!.next.buttons = Button.Use;
    h.run(1 / TICK_RATE);
    bots[0]!.next.buttons = 0;
    bots[1]!.next.buttons = 0;
    h.run(2 / TICK_RATE);
    const manned = [a!, b!].filter((s) => exMan(s.sim) === 1);
    expect(manned).toHaveLength(1);
    const other = manned[0] === a ? b! : a!;
    expect(h.raid.keep.cannons[0]!.seatId).toBe(manned[0]!.id);
    expect(exOcc(other.sim) & 1).toBe(1);
    expect(exOcc(manned[0]!.sim) & 1).toBe(0);
  });

  it('fires server loaves at the fire rate, heats up, overheats and vents', async () => {
    const launched: number[] = [];
    let overheats = 0;
    const { h, seats, bots } = await raid(1, { cannon: { damage: 75, radius: 3.5, knockback: 8, reloadSeconds: 1, heatPerShot: 30, coolPerSecond: 10, ventBelow: 35 } }, { loafLaunched: (l) => void launched.push(l.id), overheat: () => void overheats++ });
    const seat = seats[0]!;
    h.raid.moveForTest(seat, 1);
    h.run(0.3);
    bots[0]!.next.buttons = Button.Use;
    h.run(1 / TICK_RATE);
    bots[0]!.next.buttons = Button.Fire;
    bots[0]!.next.pitch = -0.2;
    bots[0]!.next.yaw = h.raid.geometry.cannons[0]!.yaw;
    h.run(0.2);
    expect(launched).toHaveLength(1);
    expect(h.raid.keep.cannons[0]!.heat).toBeGreaterThan(25);
    // One a second while held, heat 30 each, cooling 10/s: 30, 50, 70, 90, then the fifth overheats it.
    h.run(4.05);
    expect(launched).toHaveLength(5);
    expect(overheats).toBe(1);
    expect(h.raid.keep.cannons[0]!.hot).toBe(true);
    const n = launched.length;
    h.run(3);
    expect(launched).toHaveLength(n);
    // Cooled below 35: firing again.
    h.run(5);
    expect(launched.length).toBeGreaterThan(n);
    expect(h.raid.keep.cannons[0]!.hot).toBe(false);
  });

  it('a loaf bursts on the hunters: splash damage, knockback away from it, credited to its duck', async () => {
    const hits: number[] = [];
    const { h, seats, bots } = await raid(1, { cannon: { damage: 200, radius: 4, knockback: 10, reloadSeconds: 1, heatPerShot: 10, coolPerSecond: 10, ventBelow: 35 } }, { hunterHit: (_s, _h, dmg) => void hits.push(dmg) });
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    stall(h);
    const seat = seats[0]!;
    h.raid.moveForTest(seat, 1);
    h.raid.hold = true;
    h.run(0.3);
    bots[0]!.next.buttons = Button.Use;
    h.run(1 / TICK_RATE);
    // Aim straight out from the cannon: find a pitch whose loaf comes down on dry land well out, then put hunters there.
    bots[0]!.next.yaw = h.raid.geometry.cannons[0]!.yaw;
    const c = h.raid.keep.cannons[0]!;
    const { cannonAim, emptyAim, breadPath } = await import('@qwakk/shared');
    const pts: { x: number; y: number; z: number }[] = [];
    const sea = h.raid.world.map.water?.sea ?? -100;
    let land: { x: number; y: number; z: number } | null = null;
    for (const pitch of [-0.16, -0.12, -0.08, -0.04, 0, 0.05, 0.1]) {
      bots[0]!.next.pitch = pitch;
      h.run(0.1);
      const a = cannonAim(h.raid.world, h.raid.geometry, 0, seat.sim, 1, emptyAim());
      const p = pts[breadPath(h.raid.world, a, 1 / 30, pts, 300) - 1]!;
      const out = Math.hypot(p.x - h.raid.geometry.core.x, p.z - h.raid.geometry.core.z);
      if (p.y > sea + 0.5 && out > 45) {
        land = { ...p };
        break;
      }
    }
    expect(land).not.toBeNull();
    bots[0]!.next.buttons = Button.Fire;
    h.run(0.1);
    bots[0]!.next.buttons = 0;
    expect(c.heat).toBeGreaterThan(0);
    // The hunters come out just before it lands (they would run off during a long flight).
    const loaf = [...h.raid.keep.loaves.values()][0]!;
    h.run(10, () => Math.hypot(loaf.flight.x - land!.x, loaf.flight.z - land!.z) < 8 || h.raid.keep.loaves.size === 0);
    const near = h.raid.hunts.spawnForTest(HunterKind.Rifleman, land!.x + 1.5, land!.z);
    const far = h.raid.hunts.spawnForTest(HunterKind.Rifleman, land!.x + 30, land!.z);
    near.hp = near.maxHp = 1000;
    const farHp = far.hp;
    h.run(6, () => h.raid.keep.loaves.size === 0);
    // Shoved away from the burst (it was 1.5 m on the +x side of the landing).
    expect(near.kx).toBeGreaterThan(0.5);
    h.run(0.5);
    expect(near.hp).toBeLessThan(1000);
    expect(far.hp).toBe(farHp);
    expect(hits.length).toBeGreaterThan(0);
    expect(seat.dealt).toBeGreaterThan(0);
  });

  it('loaves never hurt ducks', async () => {
    const { h, seats, bots } = await raid(2);
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    stall(h);
    const [a, b] = seats;
    h.raid.moveForTest(a!, 1);
    h.run(0.3);
    bots[0]!.next.buttons = Button.Use;
    h.run(1 / TICK_RATE);
    bots[0]!.next.yaw = h.raid.geometry.cannons[0]!.yaw;
    bots[0]!.next.pitch = -0.15;
    h.run(0.1);
    // The other duck stands right where the loaves come down.
    const { cannonAim, emptyAim, breadPath } = await import('@qwakk/shared');
    const aim = cannonAim(h.raid.world, h.raid.geometry, 0, a!.sim, 1, emptyAim());
    const pts: { x: number; y: number; z: number }[] = [];
    const land = pts[breadPath(h.raid.world, aim, 1 / 30, pts, 300) - 1]!;
    Object.assign(b!.sim, { x: land.x, y: land.y, z: land.z + 0.8 });
    bots[0]!.next.buttons = Button.Fire;
    h.run(4);
    expect(h.raid.keep.loaves.size + 1).toBeGreaterThan(0);
    expect(b!.sim.hp).toBe(100);
    expect(a!.sim.hp).toBe(100);
    expect(h.raid.stage).toBe(RaidStage.Wave);
  });
});
