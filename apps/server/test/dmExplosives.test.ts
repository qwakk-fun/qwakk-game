import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  blastFalloff,
  blastReach,
  Button,
  createSimWorld,
  emptyFlight,
  emptyInput,
  EXPLOSIVE,
  ExplosiveKind,
  exLauncher,
  exNades,
  exRockets,
  initPhysics,
  setRockets,
  TICK_RATE,
  type MapDef,
  type SimWorld,
} from '@qwakk/shared';
import { KillWeapon, Msg } from '@qwakk/shared/net';
import { Deathmatch, DEFAULT_DM, type DeathmatchEvents, type DeathmatchOptions, type Seat } from '../src/deathmatch.ts';
import type { BlastInfo, LiveFlight } from '../src/dmExplosives.ts';
import { ExplosivesNet, type NetViewer } from '../src/dmExplosivesNet.ts';
import { throwPitch } from '../src/dmBotExplosives.ts';

beforeAll(initPhysics);
const worlds: SimWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.dispose();
});
const noop = () => {};

interface Log {
  booms: BlastInfo[];
  launched: LiveFlight[];
  kills: { killer: string | null; victim: string; weapon: number }[];
  hits: { attacker: string; victim: string; damage: number }[];
  picked: { seat: string; rockets: number }[];
}

function make(options: Partial<DeathmatchOptions> = {}, walls: MapDef['boxes'] = []) {
  const map: MapDef = {
    id: 'test', seed: 1, size: 100, seaLevel: -10,
    terrain: { cells: 10, cellSize: 10, heights: new Float32Array(121) },
    boxes: walls, rocks: [], shapes: [], water: null, br: null,
    spawns: [[-30, 0.5, -30], [30, 0.5, 30], [-30, 0.5, 30], [30, 0.5, -30]],
    arenaSpawns: [], arena: { x: 0, z: 0, radius: 45 },
  };
  const world = createSimWorld(map);
  worlds.push(world);
  const log: Log = { booms: [], launched: [], kills: [], hits: [], picked: [] };
  const ev: DeathmatchEvents = {
    shot: noop, hit: noop, damaged: noop, roundStart: noop, roundEnd: noop,
    kill: (k, v, weapon) => log.kills.push({ killer: k?.id ?? null, victim: v.id, weapon }),
    explosives: {
      boom: (b) => log.booms.push(b),
      launched: (f) => log.launched.push(f),
      blastHit: (a, v, damage) => log.hits.push({ attacker: a.id, victim: v.id, damage }),
      rocketPicked: (s, rockets) => log.picked.push({ seat: s.id, rockets }),
    },
  };
  const dm = new Deathmatch(world, { ...DEFAULT_DM, bots: false, ...options }, ev);
  const a = dm.addHuman('a', 'Alpha');
  const b = dm.addHuman('b', 'Beta');
  const c = dm.addHuman('c', 'Gamma');
  let tick = 0;
  const advance = (n: number) => {
    for (let i = 0; i < n; i++) {
      tick++;
      dm.beginTick(tick, (tick * 1000) / TICK_RATE);
      dm.endTick();
    }
  };
  /** Stand a duck still, unprotected, facing yaw. */
  const place = (s: Seat, x: number, z: number, yaw = 0) => {
    Object.assign(s.sim, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, grounded: 1 });
    s.protect = 0;
  };
  /** One input for a duck through the real input path. */
  const input = (s: Seat, buttons: number, pitch = 0) => {
    tick++;
    dm.beginTick(tick, (tick * 1000) / TICK_RATE);
    dm.applyInput(s, { ...emptyInput(), buttons, yaw: s.sim.yaw, pitch }, dm.nowMs);
    dm.endTick();
  };
  /** A grenade lying at (x, z) with `fuse` ticks left, thrown by `owner`. */
  const grenade = (owner: Seat, x: number, z: number, fuse = 1) => {
    const flight = emptyFlight(ExplosiveKind.Grenade);
    Object.assign(flight, { x, y: EXPLOSIVE.grenade.radius, z, rest: 1 });
    const live: LiveFlight = { id: 9000 + dm.explosives.flights.size, flight, ownerId: owner.id, ownerPid: owner.pid, team: owner.team, fuse };
    dm.explosives.flights.set(live.id, live);
    return live;
  };
  return { dm, a, b, c, log, advance, place, input, grenade };
}

const expectedGrenadeDamage = (sim: SimWorld, bx: number, bz: number, s: Seat): number => {
  const G = EXPLOSIVE.grenade;
  const d = blastReach(sim, bx, G.radius + 0.25, bz, s.sim.x, s.sim.y, s.sim.z, s.sim.crouch, G.blastRadius);
  return d < 0 ? 0 : Math.round(G.damage * blastFalloff(d, G.innerRadius, G.blastRadius, G.edgeScale));
};

describe('deathmatch grenades', () => {
  it('a grenade explodes after its fuse with falloff damage, a wall protects, and the blast is announced without its thrower', () => {
    const wall: MapDef['boxes'] = [{ kind: 'wall', c: [0, 1.5, -2], h: [3, 1.5, 0.2], q: [0, 0, 0, 1] }];
    const { dm, a, b, c, log, advance, place, grenade } = make({}, wall);
    place(a, 20, 20);
    place(b, 2, 2.5); // in the open, 3.2 m from the blast
    place(c, 0, -4); // behind the wall
    const want = expectedGrenadeDamage(dm.world, 0, 0, b);
    expect(want).toBeGreaterThan(30);
    grenade(a, 0, 0, 3);
    advance(2);
    expect(log.booms).toHaveLength(0);
    advance(1);
    expect(log.booms).toHaveLength(1);
    expect(Object.keys(log.booms[0]!).sort()).toEqual(['id', 'kind', 'x', 'y', 'z']);
    expect(b.sim.hp).toBe(100 - want);
    expect(c.sim.hp).toBe(100);
    expect(a.sim.hp).toBe(100);
    expect(log.hits).toEqual([{ attacker: 'a', victim: 'b', damage: want }]);
    expect(dm.explosives.flights.size).toBe(0);
  });

  it('never hurts or pushes teammates, hurts its thrower less, and pushes enemies away through the sim velocity', () => {
    const { dm, a, b, c, advance, place, grenade } = make();
    a.team = 1;
    b.team = 1;
    place(a, 1.5, 0);
    place(b, -1.5, 0);
    place(c, 0, 2);
    grenade(a, 0, 0);
    advance(1);
    expect(b.sim.hp).toBe(100);
    expect([b.sim.vx, b.sim.vy, b.sim.vz]).toEqual([0, 0, 0]);
    const full = EXPLOSIVE.grenade.damage;
    expect(c.sim.hp).toBeLessThanOrEqual(100 - Math.round(full * 0.6));
    expect(a.sim.hp).toBe(100 - Math.round(full * EXPLOSIVE.selfDamageScale * blastFalloff(blastReach(dm.world, 0, EXPLOSIVE.grenade.radius + 0.25, 0, 1.5, 0, 0, 0, 6.5), EXPLOSIVE.grenade.innerRadius, EXPLOSIVE.grenade.blastRadius, EXPLOSIVE.grenade.edgeScale)));
    // Knockback: away from the blast and up, float32 like every sim step, off the ground.
    expect(c.sim.vz).toBeGreaterThan(3);
    expect(c.sim.vy).toBeGreaterThan(2);
    expect(c.sim.grounded).toBe(0);
    for (const v of [c.sim.vx, c.sim.vy, c.sim.vz]) expect(Math.fround(v)).toBe(v);
  });

  it('spawn-protected ducks take nothing; a kill by grenade is credited with the grenade weapon', () => {
    const { a, b, c, log, advance, place, grenade } = make();
    place(a, 20, 0);
    place(b, 0.5, 0);
    place(c, -0.5, 0);
    c.protect = 30;
    b.sim.hp = 20;
    grenade(a, 0, 0);
    advance(1);
    expect(c.sim.hp).toBe(100);
    expect(b.sim.alive).toBe(0);
    expect(log.kills).toEqual([{ killer: 'a', victim: 'b', weapon: KillWeapon.Grenade }]);
    expect(a.kills).toBe(1);
  });

  it('throws through the real input path: release only, two per life, gated, refilled on respawn', () => {
    const { dm, a, log, input, place, advance } = make();
    place(a, 0, 0);
    expect(exNades(a.sim)).toBe(EXPLOSIVE.grenade.perLife);
    input(a, Button.Grenade);
    expect(log.launched).toHaveLength(0);
    input(a, 0);
    expect(log.launched).toHaveLength(1);
    expect(log.launched[0]!.ownerPid).toBe(a.pid);
    // Rate limit: an immediate second throw is refused by the gate.
    input(a, Button.Grenade);
    input(a, 0);
    expect(log.launched).toHaveLength(1);
    for (let i = 0; i < EXPLOSIVE.grenade.throwTicks; i++) input(a, 0);
    input(a, Button.Grenade);
    input(a, 0);
    expect(log.launched).toHaveLength(2);
    for (let i = 0; i < EXPLOSIVE.grenade.throwTicks; i++) input(a, 0);
    input(a, Button.Grenade);
    input(a, 0);
    expect(log.launched).toHaveLength(2); // none left
    // Both blow up on their fuse.
    advance(EXPLOSIVE.grenade.fuseTicks);
    expect(log.booms.length).toBe(2);
    dm.spawn(a);
    expect(exNades(a.sim)).toBe(EXPLOSIVE.grenade.perLife);
  });

  it('a throw ends spawn protection, and nothing flies between rounds', () => {
    const { dm, a, log, input } = make();
    a.protect = 50;
    input(a, Button.Grenade);
    input(a, 0);
    expect(a.protect).toBe(0);
    expect(log.launched).toHaveLength(1);
    dm.ticksLeft = 1;
    input(a, 0); // the round ends
    expect(dm.phase).toBe('intermission');
    expect(dm.explosives.flights.size).toBe(0);
  });
});

describe('deathmatch rockets', () => {
  it('the pickup appears alone, on schedule, is collected in reach and gives the launcher; respawn takes it away', () => {
    const { dm, a, b, c, log, advance, place } = make({ roundSeconds: 1000 });
    place(a, 0, 0);
    place(b, 5, 0);
    place(c, -5, 0);
    advance(EXPLOSIVE.rocket.pickupMinSeconds * TICK_RATE - 5);
    expect(dm.explosives.rocket).toBeNull();
    advance((EXPLOSIVE.rocket.pickupMaxSeconds - EXPLOSIVE.rocket.pickupMinSeconds) * TICK_RATE + 10);
    const p = dm.explosives.rocket!;
    expect(p).not.toBeNull();
    for (const s of [a, b, c]) expect(Math.hypot(s.sim.x - p.x, s.sim.z - p.z)).toBeGreaterThanOrEqual(12);
    advance(10);
    expect(dm.explosives.rocket).toBe(p); // still the one pickup
    place(a, p.x, p.z);
    advance(1);
    expect(log.picked).toEqual([{ seat: 'a', rockets: EXPLOSIVE.rocket.perPickup }]);
    expect(exRockets(a.sim)).toBe(EXPLOSIVE.rocket.perPickup);
    expect(dm.explosives.rocket).toBeNull();
    advance(EXPLOSIVE.rocket.pickupMinSeconds * TICK_RATE - 5);
    expect(dm.explosives.rocket).toBeNull(); // the next one waits at least the shortest time
    dm.spawn(a);
    expect(exRockets(a.sim)).toBe(0);
  });

  it('an untaken pickup goes away after its lifetime', () => {
    const { dm, advance } = make({ roundSeconds: 1000 });
    advance(EXPLOSIVE.rocket.pickupMaxSeconds * TICK_RATE + 2);
    expect(dm.explosives.rocket).not.toBeNull();
    advance(EXPLOSIVE.rocket.pickupLifetimeSeconds * TICK_RATE + 1);
    expect(dm.explosives.rocket).toBeNull();
  });

  it('a rocket hits a duck directly (splash plus the bonus kills), one launch per gate, and the slot goes with the last rocket', () => {
    const { a, b, c, log, input, place, advance } = make();
    place(a, 0, 0, 0);
    place(b, 0.5, -10); // ahead (forward is -z at yaw 0), where the over-the-shoulder aim line passes
    place(c, 15, 15);
    setRockets(a.sim, 3);
    input(a, Button.Slot3);
    expect(exLauncher(a.sim)).toBe(1);
    for (let i = 0; i < EXPLOSIVE.rocket.equipTicks; i++) input(a, 0);
    // Fire every other tick for a while: only one rocket per EXPLOSIVE.rocket.fireTicks.
    for (let i = 0; i < 10; i++) input(a, i % 2 === 0 ? Button.Fire : 0);
    expect(log.launched.filter((f) => f.flight.kind === ExplosiveKind.Rocket)).toHaveLength(1);
    advance(20);
    expect(log.booms).toHaveLength(1);
    expect(b.sim.alive).toBe(0);
    expect(log.kills).toEqual([{ killer: 'a', victim: 'b', weapon: KillWeapon.Rocket }]);
    expect(a.sim.hp).toBe(100); // 10 m away from its own blast
    for (let n = 0; n < 2; n++) {
      for (let i = 0; i < EXPLOSIVE.rocket.fireTicks; i++) input(a, 0);
      input(a, Button.Fire);
    }
    expect(log.launched).toHaveLength(3);
    expect(exRockets(a.sim)).toBe(0);
    expect(exLauncher(a.sim)).toBe(0);
  });
});

describe('explosive messages (anti-wallhack)', () => {
  function net(seen: Record<string, string[]>, spots: Record<string, boolean>, at: Record<string, [number, number]>) {
    const sent: Record<string, [string, unknown][]> = {};
    const viewers: NetViewer[] = Object.keys(at).map((id) => ({ sessionId: id, send: (type: string, m: unknown) => (sent[id] ??= []).push([type, m]) }));
    const n = new ExplosivesNet({
      viewers: () => viewers,
      viewpoint: (id) => (at[id] ? { x: at[id]![0], y: 0, z: at[id]![1] } : null),
      sees: (v, target) => (seen[v] ?? []).includes(target),
      seesSpot: (v) => spots[v] ?? false,
    });
    return { n, sent };
  }
  const owner = { id: 'thrower', pid: 7, team: 0, sim: { x: 0, y: 0, z: 0 } } as unknown as Seat;
  const flight = (kind: number): LiveFlight => {
    const f = emptyFlight(kind);
    Object.assign(f, { x: 1, y: 1.4, z: -1, vx: 0, vy: 5, vz: -15 });
    return { id: 42, flight: f, ownerId: 'thrower', ownerPid: 7, team: 0, fuse: 75 };
  };

  it('a throw goes in full only to the thrower and viewers who see it; a hidden thrower is only a direction, and a blast never names it', () => {
    const { n, sent } = net(
      { seer: ['thrower'] },
      { blind: true, far: false },
      { thrower: [0, 0], seer: [10, 0], blind: [12, 5], far: [200, 0] },
    );
    const live = flight(ExplosiveKind.Grenade);
    n.launched(live, owner);
    expect(sent.thrower).toEqual([[Msg.Proj, [42, 1, 7, 100, 140, -100, 0, 500, -1500]]]);
    expect(sent.seer?.[0]?.[0]).toBe(Msg.Proj);
    // The blind viewer hears it: weapon, direction, loudness. Nothing that places the thrower.
    expect(sent.blind).toHaveLength(1);
    const [type, hint] = sent.blind![0]!;
    expect(type).toBe(Msg.ShotHint);
    expect(hint).toEqual([[KillWeapon.Grenade, expect.any(Number), expect.any(Number)]]);
    expect(sent.far).toBeUndefined(); // out of earshot for a quiet throw
    // At rest the spot is shown to whoever sees it, with no thrower and no velocity.
    live.flight.vx = live.flight.vy = live.flight.vz = 0;
    live.flight.rest = 1;
    n.rested(live);
    expect(sent.blind![1]).toEqual([Msg.Proj, [42, 1, 0, 100, 140, -100, 0, 0, 0]]);
    expect(sent.seer).toHaveLength(1); // already had it
    expect(sent.far).toBeUndefined();
    // The blast: public within earshot, kind and position only.
    n.boom({ id: 42, kind: 1, x: 1, y: 0.3, z: -1 });
    for (const id of ['thrower', 'seer', 'blind', 'far']) expect(sent[id]!.at(-1)).toEqual([Msg.Boom, [42, 1, 100, 30, -100]]);
  });

  it('a rocket launch is heard much farther than a throw, still without a position', () => {
    const { n, sent } = net({}, {}, { thrower: [0, 0], mid: [150, 0], out: [400, 0] });
    n.launched(flight(ExplosiveKind.Rocket), owner);
    expect(sent.mid?.[0]?.[0]).toBe(Msg.ShotHint);
    expect((sent.mid![0]![1] as number[][])[0]![0]).toBe(KillWeapon.Rocket);
    expect(sent.out).toBeUndefined();
  });
});

describe('bot throws', () => {
  it('aims a lob that lands about where it wants within throwing range', () => {
    for (const d of [8, 12, 16]) {
      const p = throwPitch(d, -1.3);
      expect(p).not.toBeNull();
      const v = EXPLOSIVE.grenade.speed;
      const a = p! + EXPLOSIVE.grenade.upBias;
      const vx = v * Math.cos(a);
      const vy = v * Math.sin(a);
      const t = (vy + Math.sqrt(vy * vy + 2 * EXPLOSIVE.grenade.gravity * 1.3)) / EXPLOSIVE.grenade.gravity;
      expect(vx * t).toBeCloseTo(d, 0);
    }
    expect(throwPitch(60, 0)).toBeNull();
  });
});
