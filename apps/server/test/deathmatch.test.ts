/**
 * Deathmatch rooms with 32 seats: humans take bots' seats and give them back,
 * an empty room idles without bots; spawns on loaded maps (`dmSpawns` or
 * derived ones) are free ground; navmesh bots on the deathmatch map fight and
 * keep moving instead of getting stuck in houses.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildMapDef, createSimWorld, generateMap, groundHeightAt, initPhysics, insidePoly, MATCH, PLAYER_QUERY_GROUPS, TICK_RATE, type SimWorld } from '@qwakk/shared';
import { readFileSync } from 'node:fs';
import { Deathmatch, DEFAULT_DM, type DeathmatchEvents } from '../src/deathmatch.ts';
import { createDmBot, DmBot } from '../src/dmBot.ts';
import { BotNav } from '../src/nav/botNav.ts';
import { buildNavMesh, initNav } from '../src/nav/navmesh.ts';
import { loadMapV1, loadSainteCanard } from '../src/maps.ts';

const STEP_MS = 1000 / TICK_RATE;

beforeAll(async () => {
  await initPhysics();
  await initNav();
});

function events(log = { kills: 0, rounds: 0 }): DeathmatchEvents {
  return {
    shot: () => undefined,
    hit: () => undefined,
    damaged: () => undefined,
    kill: () => void log.kills++,
    roundEnd: () => undefined,
    roundStart: () => void log.rounds++,
  };
}

const bots = (dm: Deathmatch) => [...dm.seats.values()].filter((s) => s.bot);

describe('deathmatch seats', () => {
  it('humans plus bots stay at 32: a joining human takes a bot seat, a leaving one gives it back', () => {
    const dm = new Deathmatch(createSimWorld(generateMap(1337)), { ...DEFAULT_DM, bots: true }, events());
    expect(dm.seats.size).toBe(0);
    dm.addHuman('h1', 'One');
    expect(dm.seats.size).toBe(MATCH.players);
    expect(bots(dm).length).toBe(MATCH.players - 1);
    dm.addHuman('h2', 'Two');
    expect(dm.seats.size).toBe(MATCH.players);
    expect(bots(dm).length).toBe(MATCH.players - 2);
    dm.remove('h1');
    expect(dm.seats.size).toBe(MATCH.players);
    expect(bots(dm).length).toBe(MATCH.players - 1);
    // Bot names are unique in the room.
    const names = [...dm.seats.values()].map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a joining human takes a dead bot seat first, else the bot farthest from every human', () => {
    const dm = new Deathmatch(createSimWorld(generateMap(1337)), { ...DEFAULT_DM, bots: true }, events());
    const h = dm.addHuman('h1', 'One');
    Object.assign(h.sim, { x: 0, z: 0 });
    const list = bots(dm);
    list.forEach((b, i) => Object.assign(b.sim, { x: 5 + i, z: 0 }));
    const dead = list[3]!;
    dead.sim.alive = 0;
    dm.addHuman('h2', 'Two');
    expect(dm.seats.has(dead.id)).toBe(false);
    const far = bots(dm).reduce((a, b) => (b.sim.x > a.sim.x ? b : a));
    // h2 spawned somewhere: put it next to the human so distances are clear.
    Object.assign(dm.seats.get('h2')!.sim, { x: 0, z: 1 });
    dm.addHuman('h3', 'Three');
    expect(dm.seats.has(far.id)).toBe(false);
    expect(dm.seats.size).toBe(MATCH.players);
  });

  it('an empty room has no seats and stands still; the next human starts a fresh round', () => {
    const log = { kills: 0, rounds: 0 };
    const dm = new Deathmatch(createSimWorld(generateMap(1337)), { ...DEFAULT_DM, bots: true }, events(log));
    dm.addHuman('h1', 'One');
    for (let t = 0; t < 90; t++) {
      dm.beginTick(t, t * STEP_MS);
      dm.endTick();
    }
    const left = dm.ticksLeft;
    dm.remove('h1');
    expect(dm.seats.size).toBe(0);
    expect(dm.idle).toBe(true);
    for (let t = 90; t < 180; t++) {
      dm.beginTick(t, t * STEP_MS);
      dm.endTick();
    }
    expect(dm.ticksLeft).toBe(left);
    const rounds = log.rounds;
    dm.addHuman('h2', 'Two');
    expect(log.rounds).toBe(rounds + 1);
    expect(dm.ticksLeft).toBe(DEFAULT_DM.roundSeconds * TICK_RATE);
    expect(dm.seats.size).toBe(MATCH.players);
  });

  it('without bots only humans play', () => {
    const dm = new Deathmatch(createSimWorld(generateMap(1337)), { ...DEFAULT_DM, bots: false }, events());
    dm.addHuman('h1', 'One');
    dm.addHuman('h2', 'Two');
    expect(dm.seats.size).toBe(2);
  });
});

/** Is a standing duck at (x, y, z) free of every collider (a capsule overlap test)? */
function free(sim: SimWorld, x: number, y: number, z: number): boolean {
  let hit = false;
  sim.world.intersectionsWithShape({ x, y: y + 0.9, z }, { x: 0, y: 0, z: 0, w: 1 }, new sim.rapier.Capsule(0.5, 0.33), () => {
    hit = true;
    return false;
  }, undefined, PLAYER_QUERY_GROUPS);
  return !hit;
}

describe('deathmatch spawns on map_v1 maps', () => {
  it('derives spread spawns on free ground around the Yelova square', () => {
    const def = loadSainteCanard().def;
    const pts = def.arenaSpawns;
    expect(pts.length).toBe(MATCH.derivedSpawnMax);
    expect(def.arenaYaws).toBeUndefined();
    const sim = createSimWorld(def);
    let blocked = 0;
    for (const [x, y, z] of pts) {
      expect(Math.hypot(x - def.arena.x, z - def.arena.z)).toBeLessThanOrEqual(MATCH.derivedSpawnRadius + 0.01);
      const g = groundHeightAt(sim, x, y + 0.3, z);
      expect(Math.abs(g - (y - 0.5))).toBeLessThan(0.6);
      if (!free(sim, x, g, z)) blocked++;
    }
    expect(blocked).toBe(0);
    // Spread out: no two points closer than the grid step.
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![2] - pts[j]![2])).toBeGreaterThanOrEqual(MATCH.derivedSpawnStep - 0.01);
    sim.dispose();
  });

  it('reads dmSpawns [x, y, z, yaw] from the map file and faces the given yaw', () => {
    const dir = new URL('../../../packages/shared/src/maps/sainte-canard/', import.meta.url);
    const json = JSON.parse(readFileSync(new URL('map_v1.json', dir), 'utf8')) as Record<string, unknown>;
    json.dmSpawns = [
      [40, 8.6, -192, 1.5],
      [30, 8.6, -200, -0.5],
    ];
    const { def } = buildMapDef('dm-test', json, new Uint8Array(readFileSync(new URL('map_v1_heights.bin', dir))), JSON.parse(readFileSync(new URL('colliders.json', dir), 'utf8')));
    expect(def.arenaSpawns).toEqual([
      [40, 8.6, -192],
      [30, 8.6, -200],
    ]);
    expect(def.arenaYaws).toEqual([1.5, -0.5]);
    expect(Math.hypot(def.arena.x - 35, def.arena.z + 196)).toBeLessThan(0.01);
    const dm = new Deathmatch(createSimWorld(def), { ...DEFAULT_DM, bots: false }, events());
    const s = dm.addHuman('h1', 'One');
    const i = def.arenaSpawns.findIndex((p) => Math.hypot(p[0] - s.sim.x, p[2] - s.sim.z) < 0.01);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(s.sim.yaw).toBeCloseTo(def.arenaYaws![i]!, 5);
    expect(() => buildMapDef('bad', { ...json, dmSpawns: [[1, 'x', 2]] }, new Uint8Array(readFileSync(new URL('map_v1_heights.bin', dir))), JSON.parse(readFileSync(new URL('colliders.json', dir), 'utf8')))).toThrow(/dmSpawns/);
  });
});

describe('navmesh deathmatch bots on the deathmatch map', () => {
  let nav: BotNav;
  const map = () => loadMapV1(MATCH.mapId).def;

  beforeAll(() => {
    const a = map().arena;
    nav = new BotNav(buildNavMesh(map(), [a.x - a.radius - 20, a.z - a.radius - 20, a.x + a.radius + 20, a.z + a.radius + 20]));
  });

  /** Run a bot-only room; per bot and 10 s window (alive throughout, walking to a goal most of it), how far it got. */
  function run(players: number, seconds: number) {
    const log = { kills: 0, rounds: 0 };
    const dm = new Deathmatch(createSimWorld(map()), { ...DEFAULT_DM, players, bots: true, createBot: (sim) => createDmBot(sim, () => nav) }, events(log));
    dm.allowBotsAlone = true;
    dm.fillBots();
    const windowTicks = 10 * TICK_RATE;
    const marks = new Map<string, { x: number; z: number; life: number; max: number; walk: number }>();
    let windows = 0;
    let stuck = 0;
    let far = 0;
    let outside = 0;
    const ticks = seconds * TICK_RATE;
    const t0 = performance.now();
    for (let t = 0; t < ticks; t++) {
      dm.beginTick(t, t * STEP_MS);
      dm.endTick();
      for (const s of dm.seats.values()) {
        if (Math.hypot(s.sim.x - map().arena.x, s.sim.z - map().arena.z) > map().arena.radius + 40) far++;
        const ring = map().playRing;
        if (ring && t % 30 === 0 && !insidePoly(ring, s.sim.x, s.sim.z)) outside++;
        const m = marks.get(s.id);
        if (!m || m.life !== s.life) {
          marks.set(s.id, { x: s.sim.x, z: s.sim.z, life: s.life, max: 0, walk: 0 });
          continue;
        }
        m.max = Math.max(m.max, Math.hypot(s.sim.x - m.x, s.sim.z - m.z));
        if (s.bot instanceof DmBot && s.bot.doing === 'walk') m.walk++;
      }
      if (t > 0 && t % windowTicks === 0) {
        for (const [id, m] of marks) {
          const s = dm.seats.get(id);
          if (!s || s.life !== m.life || !s.sim.alive || m.walk < windowTicks * 0.5) continue;
          windows++;
          if (m.max < 3) stuck++;
        }
        marks.clear();
      }
    }
    const ms = (performance.now() - t0) / ticks;
    console.log(`[dm bots] ${players} bots, ${seconds} s: ${log.kills} kills, ${stuck} of ${windows} walking 10 s windows without 3 m of progress, ${ms.toFixed(3)} ms per tick`);
    return { kills: log.kills, windows, stuck, far, outside, seats: dm.seats.size };
  }

  it('a full room of 32 bots fights and stays in the play area', () => {
    const r = run(MATCH.players, 60);
    expect(r.seats).toBe(MATCH.players);
    expect(r.kills).toBeGreaterThan(50);
    expect(r.far).toBe(0);
    const ring = map().playRing;
    if (ring) expect(r.outside).toBe(0);
  }, 120_000);

  it('bots walk between houses without getting stuck (a quieter room, so they roam more)', () => {
    const r = run(4, 360);
    expect(r.windows).toBeGreaterThan(5);
    expect(r.stuck / r.windows).toBeLessThan(0.1);
    expect(r.kills).toBeGreaterThan(5);
  }, 180_000);
});
