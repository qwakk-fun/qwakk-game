/**
 * Battle royale bots drop fast: out of the plane, freefall, a short glide
 * and on the ground near the spot they picked, then straight to a gun.
 *
 * Regression: bots opened the glider high up (or reached their spot with
 * height to spare) and then braked over the spot, sinking at the slowest
 * glide rate (3 m/s) while circling it, so they hung in the air for 30 to
 * 50 s after jumping.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimWorld, initPhysics, Mode, TICK_RATE } from '@qwakk/shared';
import { BattleRoyale, DEFAULT_BR } from '../src/br/battleRoyale.ts';
import { createBrBot } from '../src/br/brBot.ts';
import { loadSainteCanard } from '../src/maps.ts';
import { sharedNav } from '../bench/brHeadless.ts';

/** Seconds from leaving the plane to standing on the ground, at most (the fast drop itself takes about 9 s). */
const MAX_AIR_S = 20;
/** Every duck is down this soon after the plane's auto-eject. */
const ALL_DOWN_AFTER_EJECT_S = 20;
/**
 * Over all the runs: landed bots find a gun this soon (median), and only a few bots still standing
 * this long after landing have none (a picked-clean village, a house the navmesh walks badly). Shots
 * use a per-round secret, so fights and loot vary from run to run; the drop does not.
 */
const MEDIAN_ARMED_S = 10;
const ARMED_BY_S = 40;
const MAX_UNARMED_LATE_PER_RUN = 2.5;
const SEEDS = [2, 5, 6, 8];
/** It lands this close to the spot it picked (m). */
const MAX_MISS_M = 25;

beforeAll(async () => {
  await initPhysics();
  await sharedNav();
}, 180_000);

interface DropRun {
  ejectS: number;
  air: number[];
  lastDown: number;
  armedAfter: number[];
  /** Bots alive ARMED_BY_S after landing without a gun by then. */
  unarmedLate: number;
  miss: number[];
}

/** A seeded Math.random for the bots (they roll spots, jitter and aim with it), so a run is repeatable. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function runDrop(seed: number): Promise<DropRun> {
  const random = Math.random;
  Math.random = seededRandom(seed * 7919 + 1);
  try {
    return await runDropSeeded(seed);
  } finally {
    Math.random = random;
  }
}

async function runDropSeeded(seed: number): Promise<DropRun> {
  const nav = await sharedNav();
  const map = loadSainteCanard().def;
  const sim = createSimWorld(map);
  const noop = () => undefined;
  const br = new BattleRoyale(sim, { ...DEFAULT_BR, bots: true, seed, createBot: (c, id) => createBrBot(c, id, nav) }, {
    shot: noop, hit: noop, damaged: noop, kill: noop, picked: noop, result: noop, started: noop, ended: noop,
    loot: { added: noop, changed: noop, removed: noop },
  });
  br.beginTick(0, 0);
  br.lock();
  const left = new Map<string, number>();
  const down = new Map<string, number>();
  const armed = new Map<string, number>();
  const miss: number[] = [];
  let unarmedLate = 0;
  const late = new Set<string>();
  for (let t = 1; t < 100 * TICK_RATE; t++) {
    br.beginTick(t, (t * 1000) / TICK_RATE);
    br.endTick();
    const pt = br.planeTime();
    for (const s of br.seats.values()) {
      if (s.sim.mode !== Mode.Plane && !left.has(s.id)) left.set(s.id, pt);
      if (s.sim.mode === Mode.Ground && left.has(s.id) && !down.has(s.id)) {
        down.set(s.id, pt);
        const target = (s.bot as unknown as { landingTarget(): { x: number; z: number } }).landingTarget();
        miss.push(Math.hypot(target.x - s.sim.x, target.z - s.sim.z));
      }
      if (down.has(s.id) && (s.sim.arms & 3) !== 0 && !armed.has(s.id)) armed.set(s.id, pt);
      const landed = down.get(s.id);
      if (landed !== undefined && pt >= landed + ARMED_BY_S && !late.has(s.id)) {
        late.add(s.id);
        if (s.sim.alive && !armed.has(s.id)) unarmedLate++;
      }
    }
  }
  const run: DropRun = {
    ejectS: br.route?.ejectS ?? 0,
    air: [...left].map(([id, t]) => (down.get(id) ?? Infinity) - t),
    lastDown: Math.max(...[...br.seats.keys()].map((id) => down.get(id) ?? Infinity)),
    armedAfter: [...armed].map(([id, t]) => t - (down.get(id) ?? 0)),
    unarmedLate,
    miss,
  };
  sim.dispose();
  return run;
}

const median = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? Infinity;

describe('battle royale bot drop', () => {
  const armedAfter: number[] = [];
  let unarmedLate = 0;
  for (const seed of SEEDS) {
    it(`seed ${seed}: every bot lands within ${MAX_AIR_S} s of jumping, near its spot`, async () => {
      const r = await runDrop(seed);
      armedAfter.push(...r.armedAfter);
      unarmedLate += r.unarmedLate;
      console.log(
        `[drop] seed ${seed}: eject ${r.ejectS.toFixed(1)} s, air max ${Math.max(...r.air).toFixed(1)} s (median ${median(r.air).toFixed(1)}), ` +
          `all down at ${r.lastDown.toFixed(1)} s, gun after landing median ${median(r.armedAfter).toFixed(1)} s max ${Math.max(...r.armedAfter).toFixed(1)} s, ` +
          `miss max ${Math.max(...r.miss).toFixed(1)} m, ${r.armedAfter.length} armed, unarmed ${ARMED_BY_S} s after landing: ${r.unarmedLate}`,
      );
      expect(r.air.length).toBe(16);
      expect(Math.max(...r.air)).toBeLessThanOrEqual(MAX_AIR_S);
      expect(r.lastDown).toBeLessThanOrEqual(r.ejectS + ALL_DOWN_AFTER_EJECT_S);
      expect(Math.max(...r.miss)).toBeLessThanOrEqual(MAX_MISS_M);
    }, 120_000);
  }

  it('landed bots go straight for a gun', () => {
    expect(armedAfter.length).toBeGreaterThanOrEqual(SEEDS.length * 8);
    expect(median(armedAfter)).toBeLessThanOrEqual(MEDIAN_ARMED_S);
    expect(unarmedLate).toBeLessThanOrEqual(SEEDS.length * MAX_UNARMED_LATE_PER_RUN);
  });
});
