import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_BUTTONS,
  Button,
  createPlayerSim,
  castWorldRay,
  createRng,
  createSimWorld,
  dcos,
  dsin,
  generateMap,
  initPhysics,
  MOVE,
  PLAYER_SIM_FIELDS,
  sanitizeInput,
  SOLID_BITS,
  stepPlayer,
  terrainHeightAt,
  type InputFrame,
  type PlayerSim,
  type ShapeDef,
  type SimWorld,
} from '../src/index.ts';

const SEED = 1337;

beforeAll(async () => {
  await initPhysics();
});

/** FNV-1a over the raw bytes of a float array: cheap bit-exact fingerprint. */
function hashFloats(values: Float32Array | Float64Array): number {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return h >>> 0;
}

function randomInputs(seed: number, count: number): InputFrame[] {
  const rng = createRng(seed);
  const out: InputFrame[] = [];
  let mx = 0;
  let mz = 0;
  let yaw = 0;
  let buttons = 0;
  for (let i = 0; i < count; i++) {
    if (i % 12 === 0) {
      mx = Math.round(rng() * 2 - 1);
      mz = Math.round(rng() * 2 - 1);
      buttons = (rng() < 0.3 ? Button.Jump : 0) | (rng() < 0.3 ? Button.Sprint : 0) | (rng() < 0.15 ? Button.Crouch : 0);
    }
    yaw += (rng() - 0.5) * 0.3;
    const frame = sanitizeInput({ seq: i + 1, tick: i, mx, mz, buttons, yaw, pitch: (rng() - 0.5) * 2 });
    if (!frame) throw new Error('sanitize rejected a valid frame');
    out.push(frame);
  }
  return out;
}

function runPlayers(sim: SimWorld, inputs: InputFrame[][]): PlayerSim[] {
  const players = sim.map.spawns.slice(0, inputs.length).map(([x, y, z]) => createPlayerSim(x, y, z));
  const ticks = inputs[0]?.length ?? 0;
  for (let t = 0; t < ticks; t++) {
    players.forEach((p, i) => stepPlayer(sim, p, inputs[i]![t]!));
  }
  return players;
}

function flatten(players: PlayerSim[]): Float64Array {
  const out = new Float64Array(players.length * PLAYER_SIM_FIELDS.length);
  players.forEach((p, i) => PLAYER_SIM_FIELDS.forEach((f, j) => (out[i * PLAYER_SIM_FIELDS.length + j] = p[f])));
  return out;
}

describe('map generation', () => {
  it('is deterministic for a seed', () => {
    const a = generateMap(SEED);
    const b = generateMap(SEED);
    expect(hashFloats(a.terrain.heights)).toBe(hashFloats(b.terrain.heights));
    expect(JSON.stringify(a.boxes)).toBe(JSON.stringify(b.boxes));
    expect(JSON.stringify(a.rocks)).toBe(JSON.stringify(b.rocks));
  });

  it('changes with the seed', () => {
    expect(hashFloats(generateMap(1).terrain.heights)).not.toBe(hashFloats(generateMap(2).terrain.heights));
  });

  it('is an island: sea at the edges, land in the middle, buildings placed', () => {
    const map = generateMap(SEED);
    expect(map.size).toBe(840);
    expect(terrainHeightAt(map.terrain, 410, 410)).toBeLessThan(0);
    expect(terrainHeightAt(map.terrain, -410, 0)).toBeLessThan(0);
    expect(terrainHeightAt(map.terrain, 0, 0)).toBeGreaterThan(1);
    expect(map.boxes.filter((b) => b.kind === 'roof').length).toBeGreaterThanOrEqual(8);
  });
});

describe('deterministic math', () => {
  it('dsin/dcos match Math within 1e-9', () => {
    for (let a = -20; a <= 20; a += 0.037) {
      expect(Math.abs(dsin(a) - Math.sin(a))).toBeLessThan(1e-9);
      expect(Math.abs(dcos(a) - Math.cos(a))).toBeLessThan(1e-9);
    }
  });
});

describe('player sim determinism', () => {
  it('same inputs give bit-identical state across two separate worlds', () => {
    const inputs = [101, 202, 303, 404].map((s) => randomInputs(s, 900));
    const a = flatten(runPlayers(createSimWorld(generateMap(SEED)), inputs));
    const b = flatten(runPlayers(createSimWorld(generateMap(SEED)), inputs));
    expect(hashFloats(a)).toBe(hashFloats(b));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('rollback replay from a mid-run snapshot reproduces the same result', () => {
    const sim = createSimWorld(generateMap(SEED));
    const inputs = randomInputs(77, 300);
    const [x, y, z] = sim.map.spawns[3]!;
    const p = createPlayerSim(x, y, z);
    let snapshot: PlayerSim | null = null;
    inputs.forEach((inp, i) => {
      if (i === 150) snapshot = { ...p };
      stepPlayer(sim, p, inp);
    });
    const replay = { ...snapshot! };
    for (let i = 150; i < inputs.length; i++) stepPlayer(sim, replay, inputs[i]!);
    expect(replay).toEqual(p);
  });
});

describe('movement feel', () => {
  function grounded(sim: SimWorld, yaw = 0): PlayerSim {
    const p = createPlayerSim(-8, terrainHeightAt(sim.map.terrain, -8, 0) + 0.3, 0, yaw);
    for (let i = 0; i < 20; i++) stepPlayer(sim, p, { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw, pitch: 0 });
    return p;
  }

  it('lands on the ground and reaches run speed quickly', () => {
    const sim = createSimWorld(generateMap(SEED));
    const p = grounded(sim, Math.PI / 2);
    expect(p.grounded).toBe(1);
    let ticks = 0;
    while (Math.hypot(p.vx, p.vz) < 0.95 * MOVE.runSpeed && ticks < 30) {
      stepPlayer(sim, p, { seq: 0, tick: 0, mx: 1, mz: 0, buttons: 0, yaw: p.yaw, pitch: 0 });
      ticks++;
    }
    expect(ticks).toBeLessThanOrEqual(6);
  });

  it('counter-strafe kills speed in a few ticks', () => {
    const sim = createSimWorld(generateMap(SEED));
    const p = grounded(sim, Math.PI / 2);
    for (let i = 0; i < 20; i++) stepPlayer(sim, p, { seq: 0, tick: 0, mx: 1, mz: 0, buttons: 0, yaw: p.yaw, pitch: 0 });
    let ticks = 0;
    while (Math.hypot(p.vx, p.vz) > 0.34 * MOVE.runSpeed && ticks < 30) {
      stepPlayer(sim, p, { seq: 0, tick: 0, mx: -1, mz: 0, buttons: 0, yaw: p.yaw, pitch: 0 });
      ticks++;
    }
    expect(ticks).toBeLessThanOrEqual(3);
  });

  it('jumps about a meter and lands', () => {
    const sim = createSimWorld(generateMap(SEED));
    const p = grounded(sim);
    const y0 = p.y;
    let peak = y0;
    stepPlayer(sim, p, { seq: 0, tick: 0, mx: 0, mz: 0, buttons: Button.Jump, yaw: 0, pitch: 0 });
    for (let i = 0; i < 40 && !p.grounded; i++) {
      stepPlayer(sim, p, { seq: 0, tick: 0, mx: 0, mz: 0, buttons: Button.Jump, yaw: 0, pitch: 0 });
      peak = Math.max(peak, p.y);
    }
    expect(peak - y0).toBeGreaterThan(0.85);
    expect(peak - y0).toBeLessThan(1.2);
    expect(p.grounded).toBe(1);
    // Holding jump does not auto-hop: a new press is needed.
    stepPlayer(sim, p, { seq: 0, tick: 0, mx: 0, mz: 0, buttons: Button.Jump, yaw: 0, pitch: 0 });
    expect(p.grounded).toBe(1);
  });
});

describe('input sanitizing', () => {
  it('clamps axes, normalizes diagonals, masks buttons and rejects junk', () => {
    const f = sanitizeInput({ seq: 5, tick: 1, mx: 9, mz: 9, buttons: 0xffff, yaw: 100, pitch: 99 })!;
    expect(Math.hypot(f.mx, f.mz)).toBeCloseTo(1, 6);
    expect(f.buttons).toBe(ALL_BUTTONS);
    expect(f.yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(f.yaw).toBeLessThan(Math.PI);
    expect(f.pitch).toBeLessThanOrEqual(1.45);
    expect(sanitizeInput({ seq: -1 })).toBeNull();
    expect(sanitizeInput('nope')).toBeNull();
    const nan = sanitizeInput({ seq: 1, mx: Number.NaN, mz: Infinity, yaw: Number.NaN })!;
    expect(nan.mx).toBe(0);
    expect(nan.mz).toBe(0);
    expect(nan.yaw).toBe(0);
  });
});

describe('terrain collider', () => {
  it('terrainHeightAt matches Rapier ray casts on the heightfield', () => {
    const sim = createSimWorld(generateMap(SEED));
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const x = -300 + ((i * 37.13) % 600) + 0.37;
      const z = -300 + ((i * 91.71) % 600) + 0.61;
      const hit = sim.world.castRay(new sim.rapier.Ray({ x, y: 200, z }, { x: 0, y: -1, z: 0 }), 400, true);
      // Only rays that land on the terrain itself, not on a prop.
      if (!hit || hit.collider.shape.type !== sim.rapier.ShapeType.HeightField) continue;
      const expected = terrainHeightAt(sim.map.terrain, x, z);
      expect(Math.abs(200 - hit.timeOfImpact - expected)).toBeLessThan(1e-3);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe('controller robustness', () => {
  it('does not stall on flat ground (Rapier zero-time ground hit)', () => {
    // A real state captured from a run where Rapier returned zero movement.
    const sim = createSimWorld(generateMap(SEED));
    const p: PlayerSim = { ...createPlayerSim(0, 0, 0), x: 5.904958724975586, y: 4.5705695152282715, z: -3.342289924621582, vx: -0.7102665901184082, vy: 0, vz: -6.968130111694336, yaw: 0.2, pitch: -0.1, crouch: 0, grounded: 1, air: 0, jumpBuf: 0, prevButtons: 2 };
    const x0 = p.x;
    const z0 = p.z;
    stepPlayer(sim, p, { seq: 0, tick: 0, mx: 0.07142890922957867, mz: 0.9974456932215773, buttons: Button.Sprint, yaw: 0.22499999403953552, pitch: -0.1 });
    expect(Math.hypot(p.x - x0, p.z - z0)).toBeGreaterThan(0.2);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(6);
  });
});

describe('stairs and ramps', () => {
  /** The house stairs' collider: a 36 degree ramp, 3 m up over 4.05 m, on a floor high above the map. */
  function rampWorld(): SimWorld {
    const base = 100;
    const pts: number[] = [];
    for (const z of [-0.55, 0.55]) for (const [x, y] of [[-0.2, 0], [4.05, 0], [4.05, 3], [3.85, 3]] as const) pts.push(x, base + y, z);
    const shapes: ShapeDef[] = [
      { type: 'box', bits: SOLID_BITS, kind: 'floor', c: [0, base - 0.5, 0], h: [20, 0.5, 20], q: [0, 0, 0, 1] },
      { type: 'box', bits: SOLID_BITS, kind: 'floor', c: [9.05, base + 2.5, 0], h: [5, 0.5, 3], q: [0, 0, 0, 1] },
      { type: 'hull', bits: SOLID_BITS, kind: 'stairs', c: [0, 0, 0], q: [0, 0, 0, 1], pts },
    ];
    return createSimWorld({ ...generateMap(SEED), shapes, boxes: [] });
  }

  it('a duck climbs the stair ramp at every gait, crouched included, within a few seconds', () => {
    const sim = rampWorld();
    for (const buttons of [0, Button.Walk, Button.Crouch, Button.Sprint]) {
      const duck = createPlayerSim(-2, 100.05, 0);
      const frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 1, buttons, yaw: -Math.PI / 2, pitch: 0 };
      let ticks = 0;
      while (duck.y < 102.95 && ticks < 30 * 6) {
        stepPlayer(sim, duck, frame);
        ticks++;
      }
      expect(duck.y, `buttons ${buttons}`).toBeGreaterThan(102.95);
    }
    sim.dispose();
  });
});
