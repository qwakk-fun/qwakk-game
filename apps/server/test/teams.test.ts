/**
 * Teams and parties without a network: team assignment (parties as one team,
 * held seats, too big, no team), no friendly fire, knocked / revive / bleed
 * out, team elimination and team placements, and the leaderboard rows.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  aimOrigin,
  Button,
  createSimWorld,
  groundHeightAt,
  initPhysics,
  KNOCK,
  Mode,
  PARTY,
  TICK_RATE,
  type InputFrame,
  type MapDef,
  type SimWorld,
} from '@qwakk/shared';
import type { BotLike, Seat } from '../src/arena.ts';
import { BattleRoyale, DEFAULT_BR, type BrEvents } from '../src/br/battleRoyale.ts';
import { brResults } from '../src/br/results.ts';
import { TeamBook } from '../src/br/teams.ts';
import { Deathmatch, DEFAULT_DM, type DeathmatchEvents } from '../src/deathmatch.ts';
import { loadSainteCanard } from '../src/maps.ts';
import { normalizeMatch } from '../src/meta/matches.ts';

const STEP_MS = 1000 / TICK_RATE;

beforeAll(async () => {
  await initPhysics();
});

const solo = (playerId: string) => ({ playerId, partyId: null, followers: [] });
const party = (playerId: string, partyId: string, followers: string[]) => ({ playerId, partyId, followers });

describe('team assignment', () => {
  it('solo: every duck its own team', () => {
    const b = new TeamBook(16, 1);
    expect(b.count).toBe(16);
    const t1 = b.place(solo('a'), 0) as number;
    b.assign('a', t1, solo('a'), 0);
    const t2 = b.place(solo('b'), 0) as number;
    expect(t2).not.toBe(t1);
    expect(b.place(party('c', 'P', ['d']), 0)).toBe('party-too-big');
  });

  it('duo: a party lands on one team, with a seat held for the friend still on the way', () => {
    const b = new TeamBook(16, 2);
    expect(b.count).toBe(8);
    const t = b.place(party('a', 'P', ['b']), 0) as number;
    b.assign('a', t, party('a', 'P', ['b']), 100);
    // A stranger may not take the held seat...
    const s = b.place(solo('x'), 10) as number;
    expect(s).not.toBe(t);
    b.assign('x', s, solo('x'), 0);
    // ...the friend gets it.
    expect(b.place(party('b', 'P', []), 10)).toBe(t);
    b.assign('b', t, party('b', 'P', []), 0);
    expect(b.members(t).sort()).toEqual(['a', 'b']);
    // A second stranger fills the first stranger's team (strangers team up before new teams open).
    expect(b.place(solo('y'), 10)).toBe(s);
  });

  it('a held seat frees up when the friend never comes', () => {
    const b = new TeamBook(4, 2);
    const t = b.place(party('a', 'P', ['b']), 0) as number;
    b.assign('a', t, party('a', 'P', ['b']), 50);
    b.assign('x', b.place(solo('x'), 0) as number, solo('x'), 0);
    // Two teams: one held for the party, one with x: y joins x.
    expect(b.place(solo('y'), 10)).not.toBe(t);
    b.assign('y', b.place(solo('y'), 10) as number, solo('y'), 0);
    // Full now, until the hold runs out.
    expect(b.place(solo('z'), 10)).toBe('no-team');
    b.expire(60);
    expect(b.place(solo('z'), 60)).toBe(t);
  });

  it('squad: a party of four fits, five never do; no free team is refused', () => {
    const b = new TeamBook(16, 4);
    expect(b.place(party('a', 'P', ['b', 'c', 'd', 'e']), 0)).toBe('party-too-big');
    for (let i = 0; i < 4; i++) {
      const g = party(`p${i}`, `P${i}`, [`q${i}`, `r${i}`, `s${i}`]);
      b.assign(`p${i}`, b.place(g, 0) as number, g, 1000);
    }
    expect(b.fit(0)).toBe(0);
    expect(b.place(party('z', 'Z', ['zz']), 0)).toBe('no-team');
    expect(b.place(solo('z'), 0)).toBe('no-team');
  });
});

/** A flat 100 m test map (no Sainte-Canard needed for plain shooting). */
function flatWorld(): SimWorld {
  const cells = 10;
  const map: MapDef = {
    id: 'test',
    seed: 0,
    size: 100,
    seaLevel: -10,
    terrain: { cells, cellSize: 10, heights: new Float32Array((cells + 1) * (cells + 1)) },
    boxes: [],
    rocks: [],
    spawns: [[0, 0.5, 0]],
    arena: { x: 0, z: 0, radius: 50 },
    arenaSpawns: [],
    shapes: [],
    water: null,
    br: null,
  };
  return createSimWorld(map);
}

function stand(seat: Seat, x: number, y: number, z: number): void {
  Object.assign(seat.sim, { x, y, z, vx: 0, vy: 0, vz: 0, grounded: 1, mode: Mode.Ground });
  seat.protect = 0;
}

/** One shot from `shooter` at the chest of whatever stands at (x, z). */
function shootAt(arena: { applyInput: Deathmatch['applyInput'] }, world: SimWorld, shooter: Seat, x: number, z: number, now: number): void {
  shooter.sim.yaw = 0;
  const o = aimOrigin(world, shooter.sim, 1, { x: 0, y: 0, z: 0 });
  const dx = x - o.x;
  const dy = shooter.sim.y + 1.0 - o.y;
  const dz = z - o.z;
  const f: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: Button.Fire, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  shooter.sim.yaw = f.yaw;
  shooter.sim.pitch = f.pitch;
  arena.applyInput(shooter, f, now);
}

describe('friendly fire', () => {
  /** Shooter at the origin, a duck 10 m out on the line and an enemy 20 m out; one shot at the enemy's chest. */
  function lineUp(midTeam: number): { hits: string[]; midHurt: boolean; allied: boolean } {
    const hits: string[] = [];
    const ev: DeathmatchEvents = { shot: () => undefined, hit: (_s, v) => void hits.push(v.id), damaged: () => undefined, kill: () => undefined, roundEnd: () => undefined, roundStart: () => undefined };
    const world = flatWorld();
    const dm = new Deathmatch(world, { ...DEFAULT_DM, bots: false, secret: 7 }, ev);
    const shooter = dm.addHuman('s', 'S', 3);
    const mid = dm.addHuman('m', 'M', midTeam);
    const enemy = dm.addHuman('e', 'E');
    for (let t = 0; t < 5; t++) {
      stand(shooter, 0, 0.02, 0);
      stand(mid, 0.35, 0.02, -10);
      stand(enemy, 0, 0.02, -20);
      dm.beginTick(t, t * STEP_MS);
      dm.endTick();
    }
    dm.beginTick(5, 5 * STEP_MS);
    const hp = mid.sim.hp;
    shootAt(dm, world, shooter, 0, -20, 5 * STEP_MS);
    return { hits, midHurt: mid.sim.hp < hp, allied: dm.allies(shooter, mid) && !dm.allies(shooter, enemy) };
  }

  it('a duck in the line of fire takes the shot (control)', () => {
    const r = lineUp(0);
    expect(r.hits).toEqual(['m']);
    expect(r.midHurt).toBe(true);
  });

  it('a teammate in the line of fire takes no damage: the shot passes through and hits the enemy behind', () => {
    const r = lineUp(3);
    expect(r.allied).toBe(true);
    expect(r.midHurt).toBe(false);
    expect(r.hits).toEqual(['e']);
  });
});

function brEvents(results: Map<string, number>, log: string[]): BrEvents {
  const noop = () => undefined;
  return {
    shot: noop,
    hit: noop,
    damaged: noop,
    kill: (k, v, w) => void log.push(`kill ${v.id} by ${k?.id ?? '-'} w${w}`),
    knock: (by, v) => void log.push(`knock ${v.id} by ${by?.id ?? '-'}`),
    revived: (v, by) => void log.push(`revived ${v.id} by ${by.id}`),
    picked: noop,
    result: (seat, place) => void results.set(seat.id, place),
    started: noop,
    ended: noop,
    loot: { added: noop, changed: noop, removed: noop },
  };
}

const noBot = (): BotLike => {
  throw new Error('no bots in this test');
};

let sainte: MapDef | null = null;
function duoMatch(teams: string[][]) {
  sainte ??= loadSainteCanard().def;
  const sim = createSimWorld(sainte);
  const results = new Map<string, number>();
  const log: string[] = [];
  const br = new BattleRoyale(sim, { ...DEFAULT_BR, bots: false, seed: 5, createBot: noBot, teamSize: 2 }, brEvents(results, log));
  br.beginTick(0, 0);
  teams.forEach((ids, i) => {
    for (const id of ids) br.addHuman(id, id.toUpperCase(), party(id, `P${i}`, ids.filter((x) => x !== id && !br.seats.has(x))));
  });
  br.lock();
  // Everyone on the ground near a spawn, 3 m apart (skip the plane).
  const [sx, sy, sz] = sim.map.spawns[0] ?? [0, 10, 0];
  let k = 0;
  for (const s of br.seats.values()) {
    const x = sx + (k % 4) * 3;
    const z = sz + Math.floor(k / 4) * 3;
    stand(s, x, groundHeightAt(sim, x, sy + 5, z), z);
    k++;
  }
  let tick = 1;
  const step = (n = 1, inputs?: (t: number) => void) => {
    for (let i = 0; i < n; i++, tick++) {
      br.beginTick(tick, (BOARDING_MS + tick * STEP_MS));
      inputs?.(tick);
      br.endTick();
    }
  };
  return { br, sim, results, log, step };
}
/** Past the boarding, so the match clock runs. */
const BOARDING_MS = 3000;

describe('knocked, revive, bleed out', () => {
  it('a duck with a standing teammate is knocked, crawls, and a teammate holding Use revives it', () => {
    const { br, log, step } = duoMatch([['a1', 'a2'], ['b1', 'b2']]);
    const a1 = br.seats.get('a1')!;
    const a2 = br.seats.get('a2')!;
    expect(a1.team).toBe(a2.team);
    expect(a1.team).not.toBe(br.seats.get('b1')!.team);
    br.worldDamage(a1, 1000);
    expect(a1.sim.alive).toBe(1);
    expect(a1.sim.down).toBe(1);
    expect(a1.sim.hp).toBe(KNOCK.hp);
    expect(log).toContain('knock a1 by -');
    // Knocked: it cannot shoot, and it moves at most at crawl speed.
    a1.sim.arms = 3;
    a1.sim.mag0 = 30;
    const before = { x: a1.sim.x, z: a1.sim.z, mag: a1.sim.mag0 };
    step(30, () => br.applyInput(a1, { seq: 0, tick: 0, mx: 0, mz: 1, buttons: Button.Fire | Button.Sprint | Button.Jump, yaw: 0, pitch: 0 }, br.nowMs));
    expect(a1.sim.mag0).toBe(before.mag);
    expect(Math.hypot(a1.sim.x - before.x, a1.sim.z - before.z)).toBeLessThan(KNOCK.crawlSpeed * 1.05 + 0.05);
    // A2 walks up and holds Use for the revive time.
    stand(a2, a1.sim.x + 1, a1.sim.y, a1.sim.z);
    const use: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: Button.Use, yaw: 0, pitch: 0 };
    step(KNOCK.reviveSeconds * TICK_RATE - 5, () => br.applyInput(a2, { ...use }, br.nowMs));
    expect(a1.sim.down).toBe(1);
    expect(br.reviveProgress(a1).progress).toBeGreaterThan(0.9);
    expect(br.reviveProgress(a1).by?.id).toBe('a2');
    step(6, () => br.applyInput(a2, { ...use }, br.nowMs));
    expect(a1.sim.down).toBe(0);
    expect(a1.sim.hp).toBe(KNOCK.reviveHp);
    expect(log).toContain('revived a1 by a2');
  });

  it('letting go of Use starts the revive over', () => {
    const { br, step } = duoMatch([['a1', 'a2'], ['b1', 'b2']]);
    const a1 = br.seats.get('a1')!;
    const a2 = br.seats.get('a2')!;
    br.worldDamage(a1, 1000);
    stand(a2, a1.sim.x + 1, a1.sim.y, a1.sim.z);
    step(60, () => br.applyInput(a2, { seq: 0, tick: 0, mx: 0, mz: 0, buttons: Button.Use, yaw: 0, pitch: 0 }, br.nowMs));
    expect(br.reviveProgress(a1).progress).toBeGreaterThan(0.3);
    step(1, () => br.applyInput(a2, { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 }, br.nowMs));
    expect(br.reviveProgress(a1).progress).toBe(0);
  });

  it('a knocked duck bleeds out on its own, and further damage finishes it sooner', () => {
    const { br, log, step } = duoMatch([['a1', 'a2'], ['b1', 'b2']]);
    const a1 = br.seats.get('a1')!;
    br.worldDamage(a1, 1000);
    step(KNOCK.bleedSeconds * TICK_RATE - 30);
    expect(a1.sim.alive).toBe(1);
    step(60);
    expect(a1.sim.alive).toBe(0);
    expect(log.some((l) => l.startsWith('kill a1'))).toBe(true);
    // B1 knocked, then hit again: out long before the bleed time.
    const b1 = br.seats.get('b1')!;
    br.worldDamage(b1, 1000);
    expect(b1.sim.down).toBe(1);
    br.worldDamage(b1, KNOCK.hp);
    expect(b1.sim.alive).toBe(0);
  });

  it('solo never knocks: 0 health is out', () => {
    sainte ??= loadSainteCanard().def;
    const br = new BattleRoyale(createSimWorld(sainte), { ...DEFAULT_BR, bots: false, seed: 5, createBot: noBot }, brEvents(new Map(), []));
    br.beginTick(0, 0);
    br.addHuman('a', 'A');
    br.addHuman('b', 'B');
    br.lock();
    const a = br.seats.get('a')!;
    a.sim.mode = Mode.Ground;
    br.worldDamage(a, 1000);
    expect(a.sim.alive).toBe(0);
    expect(a.sim.down).toBe(0);
  });
});

describe('team elimination and placement', () => {
  it('a team is out when nobody stands; its knocked duck goes with it; places are per team; the last team wins', () => {
    const { br, results, log } = duoMatch([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2'], ['d1', 'd2']]);
    expect(br.field).toBe(4);
    const seat = (id: string) => br.seats.get(id)!;
    // A1 knocked, then A2 dies: nobody on A stands, so A1 is out too. A is 4th.
    br.worldDamage(seat('a1'), 1000);
    expect(seat('a1').sim.down).toBe(1);
    br.worldDamage(seat('a2'), 1000);
    expect(seat('a2').sim.alive).toBe(0);
    expect(seat('a1').sim.alive).toBe(0);
    expect(results.get('a1')).toBe(4);
    expect(results.get('a2')).toBe(4);
    expect(log).toContain(`kill a1 by - w-3`);
    // B1 dies (B2 still stands): no place yet; then B2 dies: B is 3rd.
    br.worldDamage(seat('b1'), 1000);
    expect(seat('b1').sim.down).toBe(1);
    br.worldDamage(seat('b1'), 1000);
    expect(seat('b1').sim.alive).toBe(0);
    expect(results.has('b1')).toBe(false);
    expect(br.teamsIn).toBe(3);
    br.worldDamage(seat('b2'), 1000);
    expect(results.get('b1')).toBe(3);
    expect(results.get('b2')).toBe(3);
    // C1 knocked, D2 falls, D1 leaves: D is 2nd; C wins, the knocked C1 too.
    br.worldDamage(seat('c1'), 1000);
    br.worldDamage(seat('d2'), 1000);
    br.remove('d2');
    br.remove('d1');
    expect(br.phase).toBe('ended');
    expect(results.get('d1')).toBe(2);
    expect(results.get('c1')).toBe(1);
    expect(results.get('c2')).toBe(1);
    expect(br.winner?.id).toBe('c2');
    // Leaderboard rows: team places out of 4 teams, deaths per duck.
    const r = brResults(br);
    expect(r.field).toBe(4);
    const place = Object.fromEntries(r.rows.map((x) => [x.seat.id, x.placement]));
    expect(place).toMatchObject({ a1: 4, a2: 4, b1: 3, b2: 3, d1: 2, d2: 2, c1: 1, c2: 1 });
    const norm = normalizeMatch({
      matchId: 'm1',
      mode: 'br',
      mapId: 'sainte-canard',
      startedAt: 0,
      endedAt: 1000,
      field: r.field,
      players: r.rows.map((x) => ({ playerId: null, name: x.seat.name, isBot: false, placement: x.placement, kills: 0, damage: 0, survivedMs: 0, deaths: x.died ? 1 : 0 })),
    }, 2000)!;
    // The winning duo gets the full placement and win points, the last team none.
    expect(norm.rows.find((x) => x.name === 'C1')?.points).toBe(100);
    expect(norm.rows.find((x) => x.name === 'A1')?.points).toBe(0);
  });

  it('bots fill the humans team seats and whole bot teams, never shooting a teammate', () => {
    sainte ??= loadSainteCanard().def;
    const idle = (): BotLike => ({ think: (s) => ({ seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: s.yaw, pitch: 0 }), respawned: () => undefined, damagedFrom: () => undefined });
    const br = new BattleRoyale(createSimWorld(sainte), { ...DEFAULT_BR, bots: true, seed: 5, createBot: idle, teamSize: 4 }, brEvents(new Map(), []));
    br.beginTick(0, 0);
    br.addHuman('h1', 'H1', party('h1', 'P', ['h2']));
    br.addHuman('h2', 'H2', party('h2', 'P', []));
    br.lock();
    expect(br.seats.size).toBe(16);
    const teams = new Map<number, number>();
    for (const s of br.seats.values()) teams.set(s.team, (teams.get(s.team) ?? 0) + 1);
    expect([...teams.values()]).toEqual([4, 4, 4, 4]);
    expect(br.seats.get('h1')!.team).toBe(br.seats.get('h2')!.team);
    expect(br.field).toBe(4);
    expect(PARTY.maxSize).toBe(4);
  });
});
