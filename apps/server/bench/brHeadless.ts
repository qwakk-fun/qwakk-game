/**
 * A full battle royale match with 16 bots, headless (no network): the plane,
 * the drop, loot, the zone, fights, one winner. Used by the BR test and as a
 * CLI for numbers:
 *
 *   node bench/brHeadless.ts [seed ...]
 */
import { createSimWorld, initPhysics, Item, Mode, TICK_RATE } from '@qwakk/shared';
import { BattleRoyale, DEFAULT_BR } from '../src/br/battleRoyale.ts';
import { createBrBot } from '../src/br/brBot.ts';
import { BotNav } from '../src/nav/botNav.ts';
import { loadOrBuildNavMesh } from '../src/nav/navmesh.ts';
import { loadSainteCanard } from '../src/maps.ts';

export interface HeadlessResult {
  seed: number;
  ended: boolean;
  seconds: number;
  winner: string | null;
  placements: number[];
  kills: number;
  zoneDeaths: number;
  shots: number;
  pickups: number;
  landedInSea: number;
  tickAvgMs: number;
  tickP95Ms: number;
  msPerBotTick: number;
  pathQueries: number;
  /** Seconds after the plane start of each death. */
  deathsAt: number[];
  killDist: number[];
  unarmedDeaths: number;
  /** Seconds when the last duck landed. */
  lastLandingS: number;
}

let nav: BotNav | null = null;

export async function sharedNav(): Promise<BotNav> {
  if (nav) return nav;
  const map = loadSainteCanard();
  const load = await loadOrBuildNavMesh(map.def, map.hash);
  nav = new BotNav(load.navMesh);
  return nav;
}

export async function runHeadlessMatch(seed: number, maxMinutes = 15): Promise<HeadlessResult> {
  await initPhysics();
  const botNav = await sharedNav();
  const q0 = botNav.queries;
  const sim = createSimWorld(loadSainteCanard().def);
  let kills = 0;
  let zoneDeaths = 0;
  let shots = 0;
  let pickups = 0;
  const deathsAt: number[] = [];
  const killDist: number[] = [];
  let unarmedDeaths = 0;
  const br = new BattleRoyale(sim, { ...DEFAULT_BR, bots: true, seed, createBot: (ctx, id) => createBrBot(ctx, id, botNav) }, {
    shot: () => void shots++,
    hit: () => undefined,
    damaged: () => undefined,
    kill: (k, v) => {
      kills++;
      if (!(v.sim.arms & 3)) unarmedDeaths++;
      if (k) killDist.push(Math.round(Math.hypot(k.sim.x - v.sim.x, k.sim.z - v.sim.z)));
      deathsAt.push(Math.round(br.planeTime()));
      if (!k) zoneDeaths++;
    },
    picked: () => void pickups++,
    result: () => undefined,
    started: () => undefined,
    ended: () => undefined,
    loot: { added: () => undefined, changed: () => undefined, removed: () => undefined },
  });
  const step = 1000 / TICK_RATE;
  br.beginTick(0, 0);
  br.lock();
  const times: number[] = [];
  const landed = new Set<string>();
  let landedInSea = 0;
  let lastLanding = 0;
  let t = 1;
  for (; t < maxMinutes * 60 * TICK_RATE && br.phase === 'playing'; t++) {
    br.beginTick(t, t * step);
    const a = performance.now();
    br.endTick();
    times.push(performance.now() - a);
    if (t % 15 === 0) {
      for (const s of br.seats.values()) {
        if (landed.has(s.id) || !s.sim.alive || s.sim.mode !== Mode.Ground || br.planeTime() < 0) continue;
        landed.add(s.id);
        lastLanding = t / TICK_RATE;
        if (s.sim.y < -0.5) landedInSea++;
      }
    }
  }
  times.sort((x, y) => x - y);
  const avg = times.reduce((x, y) => x + y, 0) / Math.max(1, times.length);
  void Item;
  return {
    seed,
    ended: br.phase === 'ended',
    seconds: Math.round(t / TICK_RATE),
    winner: br.winner?.name ?? null,
    placements: [...br.seats.values()].map((s) => br.placement.get(s.id) ?? 0),
    kills,
    zoneDeaths,
    shots,
    pickups,
    landedInSea,
    tickAvgMs: avg,
    tickP95Ms: times[Math.floor(times.length * 0.95)] ?? 0,
    msPerBotTick: avg / br.seats.size,
    pathQueries: botNav.queries - q0,
    lastLandingS: lastLanding,
    deathsAt,
    killDist,
    unarmedDeaths,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
  for (const seed of seeds.length ? seeds : [1, 2, 3]) {
    const r = await runHeadlessMatch(seed);
    const { placements, ...rest } = r;
    console.log(JSON.stringify({ ...rest, tickAvgMs: +r.tickAvgMs.toFixed(3), tickP95Ms: +r.tickP95Ms.toFixed(3), msPerBotTick: +r.msPerBotTick.toFixed(4), uniquePlacements: new Set(placements).size }));
  }
}
