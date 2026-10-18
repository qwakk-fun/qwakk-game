import { afterEach, beforeAll, expect, it } from 'vitest';
import { Button, copyPlayerSim, createPlayerSim, createSimWorld, DM, DmPower, emptyInput, initPhysics, stepPlayer, type SimWorld } from '../src/index.ts';

beforeAll(initPhysics);
let world: SimWorld;
afterEach(() => world?.dispose());
function flat() {
  world = createSimWorld({ id: 'test', seed: 1, size: 100, seaLevel: -10,
    terrain: { cells: 10, cellSize: 10, heights: new Float32Array(121) },
    boxes: [], rocks: [], shapes: [], spawns: [[0, 0.5, 0]], arenaSpawns: [],
    arena: { x: 0, z: 0, radius: 40 }, water: null, br: null });
  return world;
}

it('predicts a modest speed bonus with exact copy/replay parity, then expires it', () => {
  const sim = flat(), normal = createPlayerSim(0, 0.02, 0), boosted = createPlayerSim(0, 0.02, 0), replay = createPlayerSim(0, 0, 0);
  boosted.dmPower = DmPower.Speed; boosted.dmPowerTicks = 100;
  copyPlayerSim(boosted, replay);
  const input = { ...emptyInput(), mz: 1 };
  for (let i = 0; i < 60; i++) {
    stepPlayer(sim, normal, input); stepPlayer(sim, boosted, input); stepPlayer(sim, replay, input);
    expect(replay).toEqual(boosted);
  }
  expect(Math.abs(boosted.vz / normal.vz)).toBeCloseTo(DM.speedMultiplier, 3);
  boosted.dmPowerTicks = 1;
  stepPlayer(sim, boosted, input);
  expect(boosted.dmPower).toBe(0);
  expect(boosted.dmPowerTicks).toBe(0);
  for (let i = 0; i < 30; i++) stepPlayer(sim, boosted, input);
  expect(boosted.vz).toBeCloseTo(normal.vz, 3);
});

it('boosts jump height without modifying normal or BR jumps, and clears expired armor', () => {
  const sim = flat(), normal = createPlayerSim(0, 0.02, 0), boosted = createPlayerSim(0, 0.02, 0);
  normal.grounded = boosted.grounded = 1;
  boosted.dmPower = DmPower.Jump; boosted.dmPowerTicks = 100;
  const jump = { ...emptyInput(), buttons: Button.Jump };
  stepPlayer(sim, normal, jump); stepPlayer(sim, boosted, jump);
  expect(boosted.vy).toBeGreaterThan(normal.vy * 1.15);
  expect(normal.dmPower).toBe(0);
  boosted.dmPower = DmPower.Armor; boosted.dmShield = 25; boosted.dmPowerTicks = 1;
  stepPlayer(sim, boosted, emptyInput());
  expect(boosted.dmShield).toBe(0);
  expect(boosted.dmPower).toBe(0);
});
