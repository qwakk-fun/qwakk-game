/**
 * Characters on the server: a human's pick is kept on its seat, bots get a
 * catalog duck (a balanced mix), the battle royale does the same, and the pick
 * changes nothing about being hit (same shot, same result for either duck).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { aimOrigin, Button, characterFromOption, CHARACTERS, createSimWorld, emptyInput, generateMap, initPhysics, isCharacterId, TICK_RATE, type InputFrame, type MapDef } from '@qwakk/shared';
import { Deathmatch, DEFAULT_DM, type DeathmatchEvents, type Seat } from '../src/deathmatch.ts';
import { BattleRoyale, DEFAULT_BR, type BrEvents } from '../src/br/battleRoyale.ts';
import { loadSainteCanard } from '../src/maps.ts';

const STEP_MS = 1000 / TICK_RATE;

beforeAll(async () => {
  await initPhysics();
});

const noop = (): undefined => undefined;
const dmEvents = (hits: { victim: string; damage: number; head: boolean }[] = []): DeathmatchEvents => ({
  shot: noop,
  hit: (_s, v, damage, head) => void hits.push({ victim: v.id, damage, head }),
  damaged: noop,
  kill: noop,
  roundEnd: noop,
  roundStart: noop,
});

function flatWorld() {
  const cells = 10;
  const map: MapDef = {
    id: 'test', seed: 0, size: 100, seaLevel: -10,
    terrain: { cells, cellSize: 10, heights: new Float32Array((cells + 1) * (cells + 1)) },
    boxes: [], rocks: [], spawns: [[0, 0.5, 0]], arena: { x: 0, z: 0, radius: 50 }, arenaSpawns: [], shapes: [], water: null, br: null,
  };
  return createSimWorld(map);
}

function place(seat: Seat, x: number, z: number, crouch = 0): void {
  Object.assign(seat.sim, { x, y: 0.02, z, vx: 0, vy: 0, vz: 0, grounded: 1, crouch });
  seat.protect = 0;
}

describe('characters on seats', () => {
  it('a human keeps its validated pick; bots wear catalog ducks in a balanced mix', () => {
    const dm = new Deathmatch(createSimWorld(generateMap(1337)), { ...DEFAULT_DM, bots: true }, dmEvents());
    const h1 = dm.addHuman('h1', 'One', 0, characterFromOption(1));
    const h2 = dm.addHuman('h2', 'Two', 0, characterFromOption('mallard'));
    const h3 = dm.addHuman('h3', 'Three');
    expect([h1.character, h2.character, h3.character]).toEqual([1, 0, 0]);
    const all = [...dm.seats.values()];
    expect(all.every((s) => isCharacterId(s.character))).toBe(true);
    const bots = all.filter((s) => s.bot);
    expect(bots.length).toBeGreaterThan(10);
    for (const c of CHARACTERS) {
      const n = all.filter((s) => s.character === c.id).length;
      expect(Math.abs(n - all.length / CHARACTERS.length)).toBeLessThanOrEqual(2);
    }
  });

  it('battle royale bots wear catalog ducks too, humans keep theirs', () => {
    const idleBot = () => {
      const f = emptyInput();
      return { think: () => f, respawned: noop, damagedFrom: noop };
    };
    const events: BrEvents = { shot: noop, hit: noop, damaged: noop, kill: noop, picked: noop, result: noop, started: noop, ended: noop, loot: { added: noop, changed: noop, removed: noop } };
    const br = new BattleRoyale(createSimWorld(loadSainteCanard().def), { ...DEFAULT_BR, bots: true, seed: 9, createBot: idleBot }, events);
    br.beginTick(0, 0);
    expect(br.addHuman('a', 'A', null, 1)?.character).toBe(1);
    expect(br.addHuman('b', 'B')?.character).toBe(0);
    br.lock();
    const all = [...br.seats.values()];
    expect(all.length).toBeGreaterThan(2);
    expect(all.every((s) => isCharacterId(s.character))).toBe(true);
    expect(new Set(all.filter((s) => s.bot).map((s) => s.character)).size).toBe(CHARACTERS.length);
  });

  it('the same shot does the same to either duck (hitboxes do not depend on the character)', () => {
    const shoot = (character: number, crouch: number, aimY: number) => {
      const hits: { victim: string; damage: number; head: boolean }[] = [];
      const dm = new Deathmatch(flatWorld(), { ...DEFAULT_DM, bots: false, secret: 7 }, dmEvents(hits));
      const shooter = dm.addHuman('shooter', 'S');
      const target = dm.addHuman('target', 'T', 0, character);
      let tick = 0;
      for (; tick < 5; tick++) {
        dm.beginTick(tick, tick * STEP_MS);
        place(shooter, 0, 0);
        place(target, 0, -15, crouch);
        dm.endTick();
      }
      dm.beginTick(tick, tick * STEP_MS);
      const origin = aimOrigin(flatWorld(), shooter.sim, 1, { x: 0, y: 0, z: 0 });
      const dx = 0 - origin.x;
      const dy = aimY - origin.y;
      const dz = -15 - origin.z;
      const f: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: Button.Fire, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
      shooter.sim.yaw = f.yaw;
      shooter.sim.pitch = f.pitch;
      dm.applyInput(shooter, f, tick * STEP_MS);
      return hits;
    };
    // head, chest, legs, just over the head, crouched head
    for (const [crouch, y] of [[0, 1.4], [0, 0.9], [0, 0.4], [0, 1.75], [1, 1.05]] as const) {
      const results = CHARACTERS.map((c) => shoot(c.id, crouch, y));
      for (const r of results) expect(r).toEqual(results[0]);
    }
    expect(shoot(1, 0, 1.4)[0]?.head).toBe(true);
  });
});
