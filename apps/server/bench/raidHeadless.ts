/**
 * Hunt Season, headless (no network): bot ducks (the deathmatch navmesh
 * brain, shooting hunters through the human input path) defend Pond Keep
 * from its wall walk. Used by the raid tests and the raid benchmark, and as
 * a CLI:
 *
 *   node bench/raidHeadless.ts [ducks] [startWave] [seconds]
 */
import { createSimWorld, groundHeightAt, initPhysics, RAID, RaidStage, TICK_RATE, type KeepGeometry, type SimWorld } from '@qwakk/shared';
import { RaidDuckBot } from '../src/raid/duckBot.ts';
import { loadMapV1 } from '../src/maps.ts';
import { BotNav } from '../src/nav/botNav.ts';
import { loadOrBuildNavMesh } from '../src/nav/navmesh.ts';
import { Raid, type RaidEvents } from '../src/raid/raid.ts';
import { DEFAULT_RAID_RULES, type RaidRules } from '../src/raid/rules.ts';
import { sightStats } from '../src/raid/sight.ts';

let nav: BotNav | null = null;

export async function keepNav(): Promise<BotNav> {
  if (nav) return nav;
  const map = loadMapV1(RAID.mapId);
  nav = new BotNav((await loadOrBuildNavMesh(map.def, map.hash)).navMesh);
  return nav;
}

const quiet = (): RaidEvents => {
  const no = (): void => undefined;
  return {
    shot: no, hit: no, damaged: no, kill: no, knock: no, started: no, ended: no, waveStart: no, waveClear: no, offer: no, self: no, hurtFrom: no,
    hunterHit: no, hunterDown: no, hunterShot: no, whistle: no, coreHit: no, coreRepaired: no, gateHit: no, gateBroken: no, gateFixed: no, bridge: no, splash: no,
    leverDenied: no, overheat: no, loafLaunched: no, loafBoom: no, trapped: no, decoyLaunched: no, decoyBoom: no, dropTaken: no,
  };
};

/** Guard spots on the wall walk nearest the gate, at least 5 m apart (where bot ducks defend from). */
export function wallGuardSpots(sim: SimWorld, g: KeepGeometry, n: number): { x: number; y: number; z: number }[] {
  const pts: { x: number; z: number; d: number }[] = [];
  for (const line of g.mark.wallWalk) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, az] = line[i]!;
      const [bx, bz] = line[i + 1]!;
      const k = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 2));
      for (let j = 0; j < k; j++) {
        const x = ax + ((bx - ax) * j) / k;
        const z = az + ((bz - az) * j) / k;
        pts.push({ x, z, d: Math.hypot(x - g.gate.x, z - g.gate.z) });
      }
    }
  }
  pts.sort((a, b) => a.d - b.d);
  const out: { x: number; y: number; z: number }[] = [];
  for (const p of pts) {
    if (out.length >= n) break;
    if (p.d < 3 || out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 5)) continue;
    out.push({ x: p.x, y: groundHeightAt(sim, p.x, g.gate.y + 30, p.z), z: p.z });
  }
  while (out.length < n) out.push({ x: g.core.x + 3 * out.length, y: g.core.y, z: g.core.z + 4 });
  return out;
}

export interface HeadlessRaid {
  raid: Raid;
  /** Run `seconds` of game time; returns tick times (ms) and the most hunters alive. */
  run(seconds: number, until?: (r: Raid) => boolean): { times: number[]; maxAlive: number; ticks: number };
}

export async function headlessRaid(opts: { ducks: number; rules?: Partial<RaidRules>; events?: Partial<RaidEvents> } = { ducks: 4 }): Promise<HeadlessRaid> {
  await initPhysics();
  const botNav = await keepNav();
  const map = loadMapV1(RAID.mapId);
  const sim = createSimWorld(map.def);
  const raid = new Raid(sim, { map, nav: () => botNav, rules: { ...DEFAULT_RAID_RULES, ...(opts.rules ?? {}) }, secret: 7 }, { ...quiet(), ...(opts.events ?? {}) });
  // Guard spots on the wall walk by the gate.
  for (const spot of wallGuardSpots(sim, raid.geometry, opts.ducks)) raid.addBotDuck(new RaidDuckBot(sim, () => botNav, spot));
  let t = 0;
  const step = 1000 / TICK_RATE;
  return {
    raid,
    run(seconds, until) {
      const times: number[] = [];
      let maxAlive = 0;
      const end = t + Math.round(seconds * TICK_RATE);
      for (; t < end; t++) {
        raid.beginTick(t, t * step);
        const a = performance.now();
        raid.endTick();
        times.push(performance.now() - a);
        maxAlive = Math.max(maxAlive, raid.hunts.alive);
        if (until?.(raid)) {
          t++;
          break;
        }
      }
      return { times, maxAlive, ticks: times.length };
    },
  };
}

export function summarize(times: number[]): { avg: number; p95: number; max: number } {
  const s = [...times].sort((a, b) => a - b);
  const avg = s.reduce((x, y) => x + y, 0) / Math.max(1, s.length);
  return { avg, p95: s[Math.floor(s.length * 0.95)] ?? 0, max: s[s.length - 1] ?? 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ducks = Number(process.argv[2] ?? 4);
  const wave = Number(process.argv[3] ?? 1);
  const seconds = Number(process.argv[4] ?? 120);
  const h = await headlessRaid({ ducks });
  h.raid.beginTick(0, 0);
  if (wave > 1) h.raid.skipTo(wave);
  else h.raid.start();
  const rays0 = sightStats.rays;
  const r = h.run(seconds, (x) => x.over);
  const s = summarize(r.times);
  const raid = h.raid;
  console.log(JSON.stringify({
    ducks, startWave: wave, seconds: r.ticks / TICK_RATE, stage: ['lobby', 'break', 'wave', 'won', 'lost'][raid.stage], wave: raid.wave, endReason: raid.endReason,
    core: Math.round(raid.coreHp), gate: Math.round(raid.keep.gateHp), kills: raid.teamKills, maxAlive: r.maxAlive, standing: [...raid.seats.values()].filter((x) => x.sim.alive && !x.sim.down).length,
    tickAvgMs: +s.avg.toFixed(3), tickP95Ms: +s.p95.toFixed(3), tickMaxMs: +s.max.toFixed(2), sightRaysPerTick: +((sightStats.rays - rays0) / r.ticks).toFixed(1), stageEnum: RaidStage,
  }));
}
