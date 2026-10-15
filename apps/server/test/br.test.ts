/**
 * Battle royale, headless: a full 16-bot match on Sainte-Canard (plane, drop,
 * loot, zone, fights) must end with exactly one winner in a sane time, and
 * bots must jump out over land and land on land.
 *
 * Uses the cached bot navmesh (apps/server/.navcache); the first run on a
 * fresh checkout builds it (about a minute).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimWorld, initPhysics, Mode, terrainHeightAt, TICK_RATE } from '@qwakk/shared';
import { BattleRoyale, DEFAULT_BR } from '../src/br/battleRoyale.ts';
import { createBrBot } from '../src/br/brBot.ts';
import { loadSainteCanard } from '../src/maps.ts';
import { runHeadlessMatch, sharedNav } from '../bench/brHeadless.ts';

beforeAll(async () => {
  await initPhysics();
  await sharedNav();
}, 180_000);

describe('battle royale bots', () => {
  it('jump out of the plane over land and land on land before the plane leaves', async () => {
    const nav = await sharedNav();
    const map = loadSainteCanard().def;
    const sim = createSimWorld(map);
    const noop = () => undefined;
    const br = new BattleRoyale(sim, { ...DEFAULT_BR, bots: true, seed: 11, createBot: (c, id) => createBrBot(c, id, nav) }, {
      shot: noop, hit: noop, damaged: noop, kill: noop, picked: noop, result: noop, started: noop, ended: noop,
      loot: { added: noop, changed: noop, removed: noop },
    });
    br.beginTick(0, 0);
    br.lock();
    const ejectS = br.route?.ejectS ?? 0;
    const leftPlaneAt = new Map<string, number>();
    const landedAt = new Map<string, { x: number; y: number; z: number }>();
    for (let t = 1; t < 150 * TICK_RATE && landedAt.size < br.seats.size; t++) {
      br.beginTick(t, (t * 1000) / TICK_RATE);
      br.endTick();
      for (const s of br.seats.values()) {
        if (s.sim.mode !== Mode.Plane && !leftPlaneAt.has(s.id)) leftPlaneAt.set(s.id, br.planeTime());
        if (s.sim.mode === Mode.Ground && leftPlaneAt.has(s.id) && !landedAt.has(s.id)) landedAt.set(s.id, { x: s.sim.x, y: s.sim.y, z: s.sim.z });
      }
    }
    expect(leftPlaneAt.size).toBe(16);
    for (const t of leftPlaneAt.values()) expect(t).toBeLessThanOrEqual(ejectS + 0.2);
    expect(landedAt.size).toBe(16);
    for (const p of landedAt.values()) expect(terrainHeightAt(map.terrain, p.x, p.z)).toBeGreaterThan(-0.5);
    sim.dispose();
  }, 120_000);

  it('play a full 16-bot match to exactly one winner', async () => {
    const r = await runHeadlessMatch(7);
    // Ends, in a sane time.
    expect(r.ended).toBe(true);
    expect(r.seconds).toBeGreaterThan(120);
    expect(r.seconds).toBeLessThan(12 * 60);
    // Exactly one winner, and every duck has its own place 1 to 16.
    expect(r.placements.filter((p) => p === 1).length).toBe(1);
    expect([...r.placements].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    // It was a fight, with loot.
    expect(r.kills).toBe(15);
    expect(r.kills - r.zoneDeaths).toBeGreaterThan(5);
    expect(r.pickups).toBeGreaterThan(30);
    expect(r.landedInSea).toBe(0);
    console.log(`[br] seed 7: ${r.seconds} s, ${r.kills - r.zoneDeaths} gun kills, ${r.zoneDeaths} zone deaths, ${r.pickups} pickups, ${r.tickAvgMs.toFixed(3)} ms/tick (p95 ${r.tickP95Ms.toFixed(3)}), ${(r.msPerBotTick * 1000).toFixed(1)} us per bot per tick`);
  }, 180_000);
});
