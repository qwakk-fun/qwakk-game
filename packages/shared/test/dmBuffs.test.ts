import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  Button,
  copyPlayerSim,
  createPlayerSim,
  createSimWorld,
  emptyInput,
  generateMap,
  HERO_FLIGHT,
  initPhysics,
  isHero,
  KILL_STACKS,
  killStacks,
  MOVE,
  PLAYER_SIM_FIELDS,
  sanitizeInputFields,
  setHero,
  setKillStacks,
  stepPlayer,
  type InputFrame,
  type PlayerSim,
  type SimWorld,
} from '../src/index.ts';

beforeAll(initPhysics);
const worlds: SimWorld[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

function flat(): SimWorld {
  const w = createSimWorld({ id: 'test', seed: 1, size: 100, seaLevel: -10,
    terrain: { cells: 10, cellSize: 10, heights: new Float32Array(121) },
    boxes: [], rocks: [], shapes: [], spawns: [[0, 0.5, 0]], arenaSpawns: [],
    arena: { x: 0, z: 0, radius: 40 }, water: null, br: null });
  worlds.push(w);
  return w;
}

/** A hero standing on flat ground, off the heightfield grid lines (a straight-down ray there can miss). */
function hero(): PlayerSim {
  const s = createPlayerSim(1.3, 0.02, 2.7);
  s.grounded = 1;
  setHero(s, true);
  s.dmEnergy = HERO_FLIGHT.energyTicks;
  return s;
}

const input = (buttons: number, mz = 0): InputFrame => ({ ...emptyInput(), buttons, mz });

describe('kill stacks', () => {
  it('pack into dmBuff, clamp at the max and keep the hero bit', () => {
    const s = createPlayerSim(0, 0, 0);
    setHero(s, true);
    setKillStacks(s, 3);
    expect(killStacks(s)).toBe(3);
    expect(isHero(s)).toBe(true);
    setKillStacks(s, 99);
    expect(killStacks(s)).toBe(KILL_STACKS.max);
    setKillStacks(s, 0);
    expect(killStacks(s)).toBe(0);
    expect(isHero(s)).toBe(true);
    setHero(s, false);
    expect(s.dmBuff).toBe(0);
  });

  it('add 4% move speed per stack, predicted exactly', () => {
    const sim = flat();
    const normal = createPlayerSim(1.3, 0.02, 2.7);
    const stacked = createPlayerSim(1.3, 0.02, 2.7);
    setKillStacks(stacked, 5);
    const run = input(0, 1);
    for (let i = 0; i < 60; i++) {
      stepPlayer(sim, normal, run);
      stepPlayer(sim, stacked, run);
    }
    expect(Math.abs(stacked.vz / normal.vz)).toBeCloseTo(1 + 5 * KILL_STACKS.speedPerStack, 3);
    expect(Math.abs(normal.vz)).toBeCloseTo(MOVE.runSpeed, 2);
  });
});

describe('hero flight', () => {
  it('takes off with a held Jump, climbs, hovers under the ceiling height and drains energy', () => {
    const sim = flat();
    const s = hero();
    stepPlayer(sim, s, input(Button.Jump));
    // The take-off tick is a plain jump: no energy spent yet.
    expect(s.dmEnergy).toBe(HERO_FLIGHT.energyTicks);
    expect(s.grounded).toBe(0);
    let top = 0;
    for (let i = 0; i < 90; i++) {
      stepPlayer(sim, s, input(Button.Jump));
      top = Math.max(top, s.y);
    }
    expect(s.dmEnergy).toBe(HERO_FLIGHT.energyTicks - 90);
    expect(top).toBeGreaterThan(HERO_FLIGHT.maxHeight - 2.5);
    expect(top).toBeLessThan(HERO_FLIGHT.maxHeight + 1);
    // Hovering: barely moving up or down.
    expect(Math.abs(s.vy)).toBeLessThan(0.6);
  });

  it('glides down slowly once the energy is gone, lands, then refills on the ground', () => {
    const sim = flat();
    const s = hero();
    for (let i = 0; i < HERO_FLIGHT.energyTicks + 1; i++) stepPlayer(sim, s, input(Button.Jump));
    expect(s.dmEnergy).toBe(0);
    let fastest = 0;
    let ticks = 0;
    while (s.grounded === 0 && ticks < 600) {
      stepPlayer(sim, s, input(Button.Jump, 1));
      fastest = Math.min(fastest, s.vy);
      ticks++;
    }
    expect(s.grounded).toBe(1);
    expect(fastest).toBeGreaterThanOrEqual(-HERO_FLIGHT.glideFallSpeed - 1e-6);
    // The landing tick already refills one; holding Jump on the ground does nothing but refill.
    expect(s.dmEnergy).toBe(HERO_FLIGHT.rechargePerTick);
    for (let i = 0; i < 30; i++) stepPlayer(sim, s, input(Button.Jump));
    expect(s.dmEnergy).toBe(31 * HERO_FLIGHT.rechargePerTick);
    expect(s.grounded).toBe(1);
  });

  it('steers at the flight speed in the air', () => {
    const sim = flat();
    const s = hero();
    stepPlayer(sim, s, input(Button.Jump));
    for (let i = 0; i < 60; i++) stepPlayer(sim, s, input(Button.Jump, 1));
    const speed = Math.hypot(s.vx, s.vz);
    expect(speed).toBeGreaterThan(HERO_FLIGHT.speed * 0.85);
    expect(speed).toBeLessThan(HERO_FLIGHT.speed * 1.05);
  });

  it('leaves ducks without the cape alone (no flight, no glide, no energy)', () => {
    const sim = flat();
    const s = createPlayerSim(1.3, 0.02, 2.7);
    s.grounded = 1;
    s.dmEnergy = 50; // ignored without the hero bit
    stepPlayer(sim, s, input(Button.Jump));
    let top = 0;
    let fastest = 0;
    for (let i = 0; i < 40; i++) {
      stepPlayer(sim, s, input(Button.Jump));
      top = Math.max(top, s.y);
      fastest = Math.min(fastest, s.vy);
    }
    expect(top).toBeLessThan(1.3);
    expect(fastest).toBeLessThan(-HERO_FLIGHT.glideFallSpeed);
    expect(s.dmEnergy).toBe(50);
  });

  it('is deterministic: two worlds and a reconcile replay from a mid-flight copy give identical states', () => {
    const map = generateMap(1337);
    const server = createSimWorld(map);
    const client = createSimWorld(map);
    worlds.push(server, client);
    const [x, y, z] = map.spawns[0] as [number, number, number];
    const a = createPlayerSim(x, y, z);
    setHero(a, true);
    setKillStacks(a, 2);
    a.dmEnergy = HERO_FLIGHT.energyTicks;
    const b = copyPlayerSim(a, createPlayerSim(0, 0, 0));
    const frames: InputFrame[] = [];
    for (let t = 0; t < 400; t++) {
      // Wire-shaped inputs: float32 axes and angles, then the server's sanitizer (session.ts does the same).
      const f: InputFrame = { seq: t + 1, tick: t, mx: Math.fround(Math.sin(t / 17)), mz: Math.fround(0.8), buttons: t % 120 < 70 ? Button.Jump : t % 7 === 0 ? Button.Sprint : 0, yaw: Math.fround(t * 0.013), pitch: 0 };
      sanitizeInputFields(f);
      frames.push(f);
    }
    let snapshot: PlayerSim | null = null;
    frames.forEach((f, t) => {
      stepPlayer(server, a, f);
      stepPlayer(client, b, { ...f });
      if (t === 150) snapshot = copyPlayerSim(a, createPlayerSim(0, 0, 0));
    });
    for (const k of PLAYER_SIM_FIELDS) expect(b[k], k).toBe(a[k]);
    // Replay from the server snapshot (what the reconciler does after a patch).
    const replay = snapshot as unknown as PlayerSim;
    for (let t = 151; t < frames.length; t++) stepPlayer(client, replay, frames[t] as InputFrame);
    for (const k of PLAYER_SIM_FIELDS) expect(replay[k], k).toBe(a[k]);
    expect(a.y).toBeGreaterThan(-100);
  });
});
