import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  aimOrigin,
  Button,
  copyPlayerSim,
  createPlayerSim,
  createSimWorld,
  DM,
  DM_HERO,
  HERO_FLIGHT,
  initPhysics,
  isHero,
  KILL_STACKS,
  killStacks,
  PLAYER_SIM_FIELDS,
  sanitizeInputFields,
  stepPlayer,
  TICK_RATE,
  type DmReward,
  type InputFrame,
  type MapDef,
  type PlayerSim,
  type SimWorld,
} from '@qwakk/shared';
import { DmHeroEvent } from '@qwakk/shared/net';
import { Deathmatch, DEFAULT_DM, type DeathmatchEvents, type DeathmatchOptions, type Seat } from '../src/deathmatch.ts';
import { coarseHeroPos } from '../src/dmHero.ts';
import { HeroPilot } from '../src/dmHeroPilot.ts';
import { loadMap } from '../src/maps.ts';
import { settings } from '../src/settings/index.ts';

beforeAll(initPhysics);
const worlds: SimWorld[] = [];
const touched = new Set<string>();
afterEach(() => {
  for (const world of worlds.splice(0)) world.dispose();
  for (const k of touched) settings.reset(k);
  touched.clear();
});
const noop = () => {};
const STEP_MS = 1000 / TICK_RATE;

function setting(key: string, value: unknown): void {
  touched.add(key);
  expect(settings.set(key, value).ok).toBe(true);
}

class TestMatch extends Deathmatch {
  frag(killer: Seat | null, victim: Seat, head = false): void { this.kill(killer, victim, 0, head); }
}

function make(options: Partial<DeathmatchOptions> = {}) {
  const map: MapDef = {
    id: 'test', seed: 1, size: 100, seaLevel: -10,
    terrain: { cells: 10, cellSize: 10, heights: new Float32Array(121) },
    boxes: [], rocks: [], shapes: [], water: null, br: null,
    spawns: [[-20, 0.5, 0], [20, 0.5, 0], [0, 0.5, 20]],
    arenaSpawns: [], arena: { x: 0, z: 0, radius: 45 },
  };
  const world = createSimWorld(map); worlds.push(world);
  const rewards: DmReward[] = [];
  const heroEvents: { event: number; hero: string; other: string | null }[] = [];
  const pings: { hero: string; x: number; z: number; tick: number }[] = [];
  const hits: number[] = [];
  let tick = 0;
  const ev: DeathmatchEvents = {
    shot: noop, damaged: noop, kill: noop, roundStart: noop, roundEnd: noop,
    hit: (_s, _v, damage) => hits.push(damage),
    reward: (_s, r) => rewards.push(r),
    hero: (event, hero, other) => heroEvents.push({ event, hero: hero.id, other: other?.id ?? null }),
    heroPing: (hero, x, z) => pings.push({ hero: hero.id, x, z, tick }),
  };
  const dm = new TestMatch(world, { ...DEFAULT_DM, bots: false, secret: 7, roundSeconds: 3600, ...options }, ev);
  const a = dm.addHuman('a', 'Alpha'), b = dm.addHuman('b', 'Beta'), c = dm.addHuman('c', 'Gamma');
  const advance = (n: number) => { for (let i = 0; i < n; i++) { tick++; dm.beginTick(tick, tick * STEP_MS); dm.endTick(); } };
  return { dm, world, a, b, c, rewards, heroEvents, pings, hits, advance, now: () => tick };
}

describe('kill stacks', () => {
  it('gain one per kill up to five, reset on death, and add damage on the server', () => {
    const { dm, a, b } = make();
    for (let i = 0; i < 7; i++) { dm.spawn(b); dm.frag(a, b); }
    expect(killStacks(a.sim)).toBe(KILL_STACKS.max);
    const raw = 20;
    expect((dm as unknown as { attackerDamage(s: Seat, r: number): number }).attackerDamage(a, raw)).toBeCloseTo(raw * (1 + 5 * KILL_STACKS.damagePerStack), 6);
    expect((dm as unknown as { attackerDamage(s: Seat, r: number): number }).attackerDamage(b, raw)).toBe(raw);
    dm.spawn(b);
    dm.frag(b, a);
    expect(killStacks(a.sim)).toBe(0);
    dm.spawn(a);
    expect(killStacks(a.sim)).toBe(0);
    expect(killStacks(b.sim)).toBe(1);
  });

  it('can be turned off and tuned from the admin settings', () => {
    const { dm, a, b } = make();
    setting('dm.stackDamagePercent', 10);
    dm.spawn(b); dm.frag(a, b);
    expect((dm as unknown as { attackerDamage(s: Seat, r: number): number }).attackerDamage(a, 50)).toBeCloseTo(55, 6);
    setting('dm.killStacks', false);
    dm.spawn(b); dm.frag(a, b);
    expect(killStacks(a.sim)).toBe(1);
  });

  it('a real shot from a stacked duck deals the bonus damage through the hit path', () => {
    const shoot = (stacks: number): number => {
      const { dm, world, a, b, hits } = make();
      for (let i = 0; i < stacks; i++) { dm.spawn(b); dm.frag(a, b); }
      dm.spawn(b);
      Object.assign(a.sim, { x: 0, y: 0.02, z: 0, vx: 0, vy: 0, vz: 0, grounded: 1, cooldown: 0, spray: 0, yaw: 0 });
      Object.assign(b.sim, { x: 0, y: 0.02, z: -10, vx: 0, vy: 0, vz: 0, grounded: 1 });
      a.protect = 0; b.protect = 0;
      dm.beginTick(1, STEP_MS); dm.endTick();
      dm.beginTick(2, 2 * STEP_MS);
      const o = aimOrigin(world, a.sim, 1, { x: 0, y: 0, z: 0 });
      const dx = 0 - o.x, dy = 1.0 - o.y, dz = -10 - o.z;
      const f: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: Button.Fire, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
      a.sim.yaw = f.yaw; a.sim.pitch = f.pitch;
      dm.applyInput(a, f, 2 * STEP_MS);
      return hits.at(-1) ?? 0;
    };
    const plain = shoot(0);
    expect(plain).toBeGreaterThan(0);
    expect(shoot(3)).toBeCloseTo(plain * (1 + 3 * KILL_STACKS.damagePerStack), 4);
  });
});

describe('caped hero', () => {
  it('picks a random living duck five seconds into the round, with hero health and full flight energy', () => {
    const { dm, heroEvents, advance } = make();
    advance(DM_HERO.firstDelaySeconds * TICK_RATE - 1);
    expect(dm.hero.heroId).toBeNull();
    advance(1);
    const hero = dm.seats.get(dm.hero.heroId ?? '')!;
    expect(hero).toBeDefined();
    expect(isHero(hero.sim)).toBe(true);
    expect(hero.sim.hp).toBe(DM_HERO.health);
    expect(hero.sim.dmEnergy).toBe(HERO_FLIGHT.energyTicks);
    expect(heroEvents).toEqual([{ event: DmHeroEvent.Chosen, hero: hero.id, other: null }]);
    expect([...dm.seats.values()].filter((s) => isHero(s.sim))).toHaveLength(1);
  });

  it('hands the cape to whoever takes the hero down, with the bonus points', () => {
    const { dm, rewards, heroEvents, advance } = make();
    advance(DM_HERO.firstDelaySeconds * TICK_RATE);
    const hero = dm.seats.get(dm.hero.heroId!)!;
    const killer = [...dm.seats.values()].find((s) => s !== hero)!;
    killer.sim.hp = 40;
    dm.frag(killer, hero);
    expect(isHero(hero.sim)).toBe(false);
    expect(dm.hero.heroId).toBe(killer.id);
    expect(isHero(killer.sim)).toBe(true);
    expect(killer.sim.hp).toBe(DM_HERO.health);
    expect(rewards.at(-1)).toMatchObject({ kill: true, hero: true, points: DM.killPoints + DM_HERO.killPoints });
    expect(heroEvents.at(-1)).toEqual({ event: DmHeroEvent.Took, hero: killer.id, other: hero.id });
  });

  it('frees the cape when the hero dies without a killer, then picks again at the next check', () => {
    const { dm, heroEvents, advance } = make();
    setting('dm.heroEverySeconds', 30);
    advance(DM_HERO.firstDelaySeconds * TICK_RATE);
    const hero = dm.seats.get(dm.hero.heroId!)!;
    dm.frag(null, hero);
    expect(dm.hero.heroId).toBeNull();
    expect(heroEvents.at(-1)).toEqual({ event: DmHeroEvent.Lost, hero: hero.id, other: null });
    advance(30 * TICK_RATE - 1);
    expect(dm.hero.heroId).toBeNull();
    advance(1);
    expect(dm.hero.heroId).not.toBeNull();
  });

  it('keeps one hero: the regular check does not replace a living hero', () => {
    const { dm, advance } = make();
    setting('dm.heroEverySeconds', 30);
    advance(DM_HERO.firstDelaySeconds * TICK_RATE);
    const first = dm.hero.heroId;
    advance(65 * TICK_RATE);
    expect(dm.hero.heroId).toBe(first);
    expect([...dm.seats.values()].filter((s) => isHero(s.sim))).toHaveLength(1);
  });

  it('uses the admin settings for health and hold points, and can be switched off', () => {
    const { dm, advance } = make();
    setting('dm.heroHealth', 150);
    setting('dm.heroHoldPoints', 7);
    advance(DM_HERO.firstDelaySeconds * TICK_RATE);
    const hero = dm.seats.get(dm.hero.heroId!)!;
    expect(hero.sim.hp).toBe(150);
    const before = dm.stats.get(hero.id)!.points;
    advance(DM_HERO.holdEverySeconds * TICK_RATE * 3);
    expect(dm.stats.get(hero.id)!.points - before).toBe(21);
    const off = make();
    setting('dm.hero', false);
    off.advance(DM_HERO.firstDelaySeconds * TICK_RATE * 2);
    expect(off.dm.hero.heroId).toBeNull();
  });

  it('pings only a coarse grid position, every five seconds, and never to the hero', () => {
    const { dm, pings, advance } = make();
    advance(DM_HERO.firstDelaySeconds * TICK_RATE);
    const hero = dm.seats.get(dm.hero.heroId!)!;
    expect(pings).toHaveLength(1);
    advance(DM_HERO.pingEverySeconds * TICK_RATE * 3);
    expect(pings).toHaveLength(4);
    for (const p of pings) {
      expect(p.hero).toBe(hero.id);
      expect(p.x % DM_HERO.pingGrid === 0 || Object.is(p.x, -0)).toBe(true);
      expect(p.z % DM_HERO.pingGrid === 0 || Object.is(p.z, -0)).toBe(true);
    }
    expect(pings[1]!.tick - pings[0]!.tick).toBe(DM_HERO.pingEverySeconds * TICK_RATE);
    expect(coarseHeroPos(13.7, -26.2)).toEqual({ x: 10, z: -30 });
    expect(coarseHeroPos(17.4, 4.9)).toEqual({ x: 20, z: 0 });
    // Nothing after the round ends.
    dm.frag(dm.seats.get('a')!, dm.seats.get('b')!);
    const n = pings.length;
    (dm as unknown as { endRound(w: Seat | null): void }).endRound(null);
    expect([...dm.seats.values()].some((s) => isHero(s.sim))).toBe(false);
    advance(DM_HERO.pingEverySeconds * TICK_RATE * 2);
    expect(pings.length).toBe(n);
  });

  it('loses the cape (and says so) when the hero falls off the map', () => {
    const { dm, heroEvents, advance } = make();
    advance(DM_HERO.firstDelaySeconds * TICK_RATE);
    const hero = dm.seats.get(dm.hero.heroId!)!;
    hero.sim.y = -40;
    advance(2);
    expect(dm.hero.heroId).toBeNull();
    expect(isHero(hero.sim)).toBe(false);
    expect(heroEvents.at(-1)).toMatchObject({ event: DmHeroEvent.Lost, hero: hero.id });
  });

  it('a bot hero flies in short hops and comes back down', () => {
    const { world } = make();
    const s = createPlayerSim(1.3, 0.02, 2.7);
    s.grounded = 1;
    s.dmBuff = 8;
    s.dmEnergy = HERO_FLIGHT.energyTicks;
    const pilot = new HeroPilot();
    let airborne = 0;
    let longest = 0;
    let run = 0;
    let top = 0;
    for (let t = 0; t < 30 * 20; t++) {
      // Circling (the flat test map is only 100 m wide).
      const f: InputFrame = { seq: 0, tick: t, mx: 0, mz: 1, buttons: 0, yaw: Math.fround(t * 0.05), pitch: 0 };
      pilot.apply(s, f, false);
      stepPlayer(world, s, f);
      top = Math.max(top, s.y);
      if (s.grounded === 0) { airborne++; run++; longest = Math.max(longest, run); } else run = 0;
    }
    expect(top).toBeGreaterThan(2);
    expect(longest).toBeLessThan(30 * 4);
    expect(airborne).toBeLessThan(30 * 20 * 0.7);
  });

  it('flight on the deathmatch map is identical in two worlds (server and client builds)', () => {
    const map = loadMap('canard-quarter', 1337).def;
    const server = createSimWorld(map), client = createSimWorld(map);
    worlds.push(server, client);
    const [x, y, z] = map.arenaSpawns[0] ?? map.spawns[0]!;
    const a: PlayerSim = createPlayerSim(x, y, z);
    a.dmBuff = 8 | 2;
    a.dmEnergy = HERO_FLIGHT.energyTicks;
    const b = copyPlayerSim(a, createPlayerSim(0, 0, 0));
    for (let t = 0; t < 600; t++) {
      const f: InputFrame = { seq: t, tick: t, mx: Math.fround(Math.sin(t / 23)), mz: 1, buttons: t % 150 < 80 ? Button.Jump : 0, yaw: Math.fround(t * 0.01), pitch: 0 };
      sanitizeInputFields(f);
      stepPlayer(server, a, f);
      stepPlayer(client, b, { ...f });
    }
    for (const k of PLAYER_SIM_FIELDS) expect(b[k], k).toBe(a[k]);
  });
});
