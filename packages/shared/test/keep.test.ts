/**
 * Hunt Season v2, Pond Keep, the shared part: the map's `raid` markup (read
 * and checked like the rest of the map), the keep's geometry, and the duck
 * sim's keep rules: manning a bread cannon (the sim's own Use and Jump
 * presses, the movement lock, exact replays), the closed drawbridge (no step
 * onto the deck), the gate's wicket (duck-only static colliders), and that
 * the server's toggled colliders never change a duck's step. A small flat
 * map built in memory, so this does not depend on the art map.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  breadPath,
  buildMapDef,
  Button,
  CANNON,
  cannonAim,
  CG,
  createPlayerSim,
  createSimWorld,
  emptyAim,
  exMan,
  inKeep,
  initPhysics,
  KEEP,
  KEEP_CLOSED,
  KEEP_TOGGLE,
  onDeck,
  onIsland,
  packEx,
  parseRaidMarkup,
  PLAYER_SIM_FIELDS,
  setKeepClosed,
  setNades,
  setGateOpen,
  setOcc,
  setToggle,
  stepPlayer,
  syncKeepShields,
  BridgeState,
  GateState,
  unpackEx,
  type InputFrame,
  type PlayerSim,
  type SimWorld,
} from '../src/index.ts';

beforeAll(async () => {
  await initPhysics();
});

/** A flat 512 m map at height 0 with a keep: gate at z = 10 facing +z, the bridge out to z = 25, a cannon at (-12, 0, -12). */
function markup(): Record<string, unknown> {
  return {
    core: [0, 0, 0],
    coreRadius: 1.5,
    gate: { x: 0, y: 0, z: 10, yaw: 0, width: 4, height: 4 },
    drawbridge: { hingeX: 0, hingeY: 0, hingeZ: 11, yaw: 1.234, length: 12, width: 4, walk: [[-2, 11], [2, 11], [2, 23], [-2, 23]] },
    cannons: [[-12, 0, -12, Math.PI / 4], [12, 0, -12, Math.PI], [12, 0, 12, 0], [-12, 0, 12, 0]],
    cannonUse: [[-11, 0, -11], [11, 0, -11], [11, 0, 11], [-11, 0, 11]],
    duckSpawns: [[0, 0, 4, 0]],
    hunterSpawns: [[50, 0, 50, 0], [-50, 0, 50, 0]],
    sniperPerches: [[55, 0, -55, 0]],
    raftLanes: [{ from: [-30, 0], to: [-18, 0] }],
    trenches: [[[40, 0], [40, 10]]],
    wallWalk: [[[-10, -10, 4], [10, -10, 4]]],
    keep: [[-10, -10], [10, -10], [10, 10], [-10, 10]],
    island: [[-16, -16], [16, -16], [16, 16], [-16, 16]],
  };
}

function keepMap(raid: unknown = markup()) {
  const cells = 128;
  const json = { size: 512, terrain: { cells, cellSize: 4 }, props: [], raid };
  return buildMapDef('keep-test', json, new Uint8Array((cells + 1) * (cells + 1) * 2), { props: {} });
}

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0, ...over });

/** A duck standing (grounded) at (x, z). */
function duckAt(sim: SimWorld, x: number, z: number): PlayerSim {
  const p = createPlayerSim(x, 1, z);
  for (let i = 0; i < 30; i++) stepPlayer(sim, p, frame());
  return p;
}

describe('the raid markup', () => {
  it('reads a whole keep and derives the bridge direction from its walk (whatever the yaw says)', () => {
    const { def } = keepMap();
    const g = def.raid!;
    expect(g).toBeTruthy();
    expect(g.bridge.dz).toBeCloseTo(1, 6);
    expect(g.bridge.dx).toBeCloseTo(0, 6);
    expect(g.gate.nz).toBeCloseTo(1, 6);
    expect(g.cannons).toHaveLength(4);
    // The cannon at (-12, -12) keeps its markup yaw (it looks out); the one at (12, -12) was given one looking in: straight out from the core instead.
    expect(g.cannons[0]!.yaw).toBeCloseTo(Math.PI / 4, 6);
    expect(g.cannons[1]!.yaw).toBeCloseTo(Math.atan2(-12, 12), 6);
    expect(onDeck(g, 0, 15, 0)).toBe(true);
    expect(onDeck(g, 3, 15, 0)).toBe(false);
    expect(onDeck(g, 0, 24, 0)).toBe(false);
    expect(inKeep(g, 0, 0)).toBe(true);
    // In the gateway, outside the gate's line: not inside the walls.
    expect(inKeep(g, 0, 10.5)).toBe(false);
    expect(onIsland(g, 14, 0)).toBe(true);
    expect(onIsland(g, 20, 0)).toBe(false);
  });

  it('refuses a broken markup with a clear message, like the rest of the map', () => {
    const bad = (patch: Record<string, unknown>, msg: RegExp) => expect(() => parseRaidMarkup({ ...markup(), ...patch })).toThrow(msg);
    bad({ gate: undefined }, /raid\.gate must be an object/);
    bad({ gate: { x: 0, y: 0, z: 0, width: -1, height: 4 } }, /raid\.gate\.width must be above 0/);
    bad({ core: [0, 0] }, /raid\.core needs 3 numbers/);
    bad({ coreRadius: 'big' }, /raid\.coreRadius must be a number/);
    bad({ cannonUse: [[0, 0, 0]] }, /raid\.cannonUse needs one entry per cannon/);
    bad({ cannons: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], cannonUse: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] }, /raid\.cannons holds at most 4/);
    bad({ hunterSpawns: [[0, 0, 0, 0]] }, /raid\.hunterSpawns needs at least 2 entries/);
    bad({ drawbridge: { hingeX: 0, hingeY: 0, hingeZ: 0, length: 5, width: 3, walk: [[0, 0]] } }, /raid\.drawbridge\.walk needs at least 3 points/);
    bad({ raftLanes: [{ from: [0, 0] }] }, /raid\.raftLanes\[0\]\.to must be an array/);
    expect(() => keepMap({ ...markup(), gate: 7 })).toThrow(/map_v1: raid\.gate/);
    // Optional parts may be missing; three-number polyline points drop the height.
    const lean = parseRaidMarkup({ ...markup(), sniperPerches: undefined, raftLanes: undefined, trenches: undefined, wallWalk: undefined, keep: undefined, island: undefined, lever: undefined });
    expect(lean.sniperPerches).toEqual([]);
    expect(lean.lever).toBeNull();
    expect(parseRaidMarkup(markup()).wallWalk[0]).toEqual([[-10, 4], [10, 4]]);
  });

  it('adds its own deck only when the map has none (Pond Keep\'s bridge prop carries one)', () => {
    const cells = 128;
    const kit = { props: { quay: [{ type: 'box', kind: 'floor', c: [0, -1.88, 0], h: [2.2, 2.0, 4.2] }] }, kinds: { floor: { move: true, bullets: true, sight: true } } };
    const json = { size: 512, terrain: { cells, cellSize: 4 }, props: [{ prop: 'quay', x: 0, y: 0, z: 17 }], raid: markup() };
    const withDeck = buildMapDef('deck', json, new Uint8Array((cells + 1) * (cells + 1) * 2), kit).def;
    expect(withDeck.shapes.some((x) => x.kind === 'raid_deck')).toBe(false);
    expect(keepMap().def.shapes.some((x) => x.kind === 'raid_deck')).toBe(true);
  });

  it('builds the same keep twice (pure data), and a map without one has none', () => {
    const a = keepMap();
    const b = keepMap();
    expect(JSON.stringify(a.def.raid)).toBe(JSON.stringify(b.def.raid));
    expect(JSON.stringify(a.def.shapes)).toBe(JSON.stringify(b.def.shapes));
    const plain = buildMapDef('plain', { size: 128, terrain: { cells: 32, cellSize: 4 }, props: [] }, new Uint8Array(33 * 33 * 2), { props: {} });
    expect(plain.def.raid).toBeUndefined();
    // The keep's colliders: the deck, the wicket leaves and lintel (duck only), the two toggled shields (bullets and sight only).
    const kinds = a.def.shapes.map((s) => s.kind);
    expect(kinds.filter((k) => k === 'raid_deck')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'raid_wicket')).toHaveLength(3);
    for (const s of a.def.shapes) {
      if (s.kind === 'raid_wicket') expect(s.bits).toBe(CG.DuckOnly);
      if (s.toggle) expect(s.bits & (CG.Move | CG.DuckOnly | CG.Opaque)).toBe(0);
    }
  });
});

describe('manning a cannon (duck sim)', () => {
  it('a Use press at the stand spot mans it: no walking, no jumping, no shooting; Use or Jump leaves', () => {
    const { def } = keepMap();
    const sim = createSimWorld(def);
    const q = duckAt(sim, -11, -11);
    const mag = q.mag0;
    stepPlayer(sim, q, frame({ buttons: Button.Use }));
    expect(exMan(q)).toBe(1);
    const qx = q.x;
    const qz = q.z;
    for (let i = 0; i < 40; i++) stepPlayer(sim, q, frame({ mz: 1, mx: 0.5, yaw: 0.6, pitch: -0.2, buttons: Button.Fire }));
    expect(exMan(q)).toBe(1);
    expect(Math.hypot(q.x - qx, q.z - qz)).toBeLessThan(1e-4);
    // The gun does not fire while manning (the server fires the cannon).
    expect(q.mag0).toBe(mag);
    expect(q.yaw).toBeCloseTo(0.6, 5);
    // A Use press leaves.
    stepPlayer(sim, q, frame({ buttons: Button.Use }));
    expect(exMan(q)).toBe(0);
    // A Jump press leaves (and jumps).
    stepPlayer(sim, q, frame());
    stepPlayer(sim, q, frame({ buttons: Button.Use }));
    expect(exMan(q)).toBe(1);
    stepPlayer(sim, q, frame());
    stepPlayer(sim, q, frame({ buttons: Button.Jump }));
    expect(exMan(q)).toBe(0);
    expect(q.vy).toBeGreaterThan(0);
  });

  it('never mans a cannon out of reach or one another duck holds; knocked or dead it lets go', () => {
    const { def } = keepMap();
    const sim = createSimWorld(def);
    const far = duckAt(sim, -11 + KEEP.cannonReach + 0.5, -11);
    stepPlayer(sim, far, frame({ buttons: Button.Use }));
    expect(exMan(far)).toBe(0);
    const p = duckAt(sim, -11, -11);
    setOcc(p, 0b0001);
    stepPlayer(sim, p, frame({ buttons: Button.Use }));
    expect(exMan(p)).toBe(0);
    setOcc(p, 0b1110);
    stepPlayer(sim, p, frame());
    stepPlayer(sim, p, frame({ buttons: Button.Use }));
    expect(exMan(p)).toBe(1);
    p.down = 1;
    stepPlayer(sim, p, frame());
    expect(exMan(p)).toBe(0);
  });

  it('keeps the grenades and other packed bits, and the packed state survives the explosives step', () => {
    const { def } = keepMap();
    const sim = createSimWorld(def);
    const p = duckAt(sim, -11, -11);
    setNades(p, 2);
    setOcc(p, 0b0100);
    stepPlayer(sim, p, frame({ buttons: Button.Use }));
    expect(exMan(p)).toBe(1);
    expect(unpackEx(p.ex)).toMatchObject({ nades: 2, man: 1, occ: 0b0100 });
    expect(packEx(unpackEx(p.ex))).toBe(p.ex);
    expect(p.ex).toBeGreaterThanOrEqual(0);
  });

  it('replays bit for bit from the same state (the owner predicts it exactly)', () => {
    const { def } = keepMap();
    const simA = createSimWorld(def);
    const simB = createSimWorld(def);
    const a = duckAt(simA, -10.5, -11.4);
    const b = { ...a };
    for (let i = 0; i < 120; i++) {
      const buttons = (i === 5 || i === 60 || i === 70 ? Button.Use : 0) | (i % 9 === 0 ? Button.Fire : 0) | (i === 90 ? Button.Jump : 0);
      const f = frame({ mz: i < 40 ? 0 : 1, mx: Math.sin(i / 7), yaw: i * 0.02, pitch: -0.1, buttons });
      stepPlayer(simA, a, f);
      stepPlayer(simB, b, { ...f });
      for (const k of PLAYER_SIM_FIELDS) expect(b[k], `${k} at ${i}`).toBe(a[k]);
    }
  });
});

describe('the closed drawbridge and the gate (duck sim)', () => {
  it('with KEEP_CLOSED a duck cannot step onto the deck; without it it walks across', () => {
    const { def } = keepMap();
    const sim = createSimWorld(def);
    const walkOut = (closed: boolean): PlayerSim => {
      const p = duckAt(sim, 0, 7);
      setKeepClosed(p, closed);
      // Facing +z is yaw pi (forward is (-sin, -cos)).
      for (let i = 0; i < 90; i++) stepPlayer(sim, p, frame({ mz: 1, yaw: Math.PI }));
      return p;
    };
    const shut = walkOut(true);
    expect(onDeck(sim.map.raid!, shut.x, shut.z, KEEP.bridgeMargin)).toBe(false);
    expect(shut.z).toBeLessThan(11);
    expect(shut.dmBuff & KEEP_CLOSED).toBe(KEEP_CLOSED);
    const open = walkOut(false);
    expect(open.z).toBeGreaterThan(14);
  });

  it('ducks pass the gate only through its wicket: the leaves beside it are walls for a duck', () => {
    const { def } = keepMap();
    const sim = createSimWorld(def);
    const through = (x: number): number => {
      const p = duckAt(sim, x, 6);
      for (let i = 0; i < 60; i++) stepPlayer(sim, p, frame({ mz: 1, yaw: Math.PI }));
      return p.z;
    };
    expect(through(0)).toBeGreaterThan(11);
    expect(through(1.6)).toBeLessThan(10);
  });

  it('a broken gate (KEEP_GATE_OPEN, a per-duck query filter) lets a duck through its whole width, the same on replay', () => {
    const { def } = keepMap();
    const sim = createSimWorld(def);
    const run = (open: boolean): PlayerSim => {
      const p = duckAt(sim, 1.6, 6);
      setGateOpen(p, open);
      for (let i = 0; i < 60; i++) stepPlayer(sim, p, frame({ mz: 1, yaw: Math.PI }));
      return p;
    };
    expect(run(false).z).toBeLessThan(10);
    const a = run(true);
    expect(a.z).toBeGreaterThan(11);
    const b = run(true);
    for (const k of PLAYER_SIM_FIELDS) expect(b[k], k).toBe(a[k]);
  });

  it('uses the prop kit gate leaves when the kit has a castle_gate (duck only, in the gate frame)', () => {
    const cells = 128;
    const kit = { props: { castle_gate: [{ type: 'box', kind: 'wall', c: [-1.375, 2.1, 0], h: [0.625, 2.1, 0.15], states: ['Intact'] }, { type: 'box', kind: 'wall', c: [1.375, 2.1, 0], h: [0.625, 2.1, 0.15] }, { type: 'box', kind: 'wall', c: [0, 3.2, 0], h: [0.75, 1.0, 0.15] }] } };
    const { def } = buildMapDef('kit', { size: 512, terrain: { cells, cellSize: 4 }, props: [], raid: markup() }, new Uint8Array((cells + 1) * (cells + 1) * 2), kit);
    const leaves = def.shapes.filter((x) => x.kind === 'raid_wicket');
    expect(leaves).toHaveLength(3);
    for (const l of leaves) expect(l.bits).toBe(CG.DuckOnly);
    // The gate faces +z here: the kit's left leaf (local x -1.375) lands at world x +1.375 (turned half a turn), on the gate line.
    expect(leaves.map((l) => Math.round(l.c[0] * 1000) / 1000).sort()).toEqual([-1.375, 0, 1.375]);
    for (const l of leaves) expect(l.c[2]).toBeCloseTo(10, 6);
  });

  it('the toggled gate and bridge shields never change a duck step (bullets and sight only)', () => {
    const { def } = keepMap();
    const sim = createSimWorld(def);
    const run = (): PlayerSim => {
      const p = duckAt(sim, 0.2, 6);
      for (let i = 0; i < 80; i++) stepPlayer(sim, p, frame({ mz: 1, mx: Math.sin(i / 5) * 0.4, yaw: Math.PI, buttons: i === 30 ? Button.Jump : 0 }));
      return p;
    };
    const a = run();
    setToggle(sim, KEEP_TOGGLE.gate, false);
    setToggle(sim, KEEP_TOGGLE.bridgeUp, true);
    const b = run();
    for (const k of PLAYER_SIM_FIELDS) expect(b[k], k).toBe(a[k]);
    // And for bullets they do block: a ray through the gate stops at it while on.
    setToggle(sim, KEEP_TOGGLE.gate, true);
    const R = sim.rapier;
    const hit = sim.world.castRay(new R.Ray({ x: 0, y: 1.5, z: 5 }, { x: 0, y: 0, z: 1 }), 20, true, undefined, (CG.Player << 16) | CG.Bullet);
    expect(hit?.timeOfImpact).toBeCloseTo(4.75, 1);
    setToggle(sim, KEEP_TOGGLE.gate, false);
    const miss = sim.world.castRay(new R.Ray({ x: 0, y: 1.5, z: 5 }, { x: 0, y: 0, z: 1 }), 5.5, true, undefined, (CG.Player << 16) | CG.Bullet);
    expect(miss).toBeNull();
  });
});

describe('the keep\'s shields mirrored from the state (the client\'s world)', () => {
  it('follow the drawbridge and the gate: rays meet them only while the bridge is not down or the gate holds', () => {
    const { def } = keepMap();
    const sim = createSimWorld(def);
    const R = sim.rapier;
    const groups = (CG.Player << 16) | CG.Bullet;
    // Through the gate (z 10) and through the raised bridge's spot at the hinge (z 11), from inside.
    const through = (): number | null => sim.world.castRay(new R.Ray({ x: 0, y: 1.5, z: 5 }, { x: 0, y: 0, z: 1 }), 12, true, undefined, groups)?.timeOfImpact ?? null;
    syncKeepShields(sim, BridgeState.Down, GateState.Intact);
    expect(through()).toBeCloseTo(4.75, 1);
    syncKeepShields(sim, BridgeState.Down, GateState.Broken);
    expect(through()).toBeNull();
    syncKeepShields(sim, BridgeState.Up, GateState.Broken);
    expect(through()).toBeCloseTo(6.05, 1);
    syncKeepShields(sim, BridgeState.Raising, GateState.Damaged);
    expect(through()).toBeCloseTo(4.75, 1);
    syncKeepShields(sim, BridgeState.Down, GateState.Damaged);
    expect(through()).toBeCloseTo(4.75, 1);
  });
});

describe('the bread cannon arc', () => {
  it('lobs a loaf at the crosshair point, turns within its arc, reaches about 150 m at its top elevation', () => {
    const { def } = keepMap();
    const sim = createSimWorld(def);
    const g = def.raid!;
    const p = duckAt(sim, -11, -11);
    // Look out from the cannon (toward -x -z, yaw atan2(1, 1) faces (-sin, -cos)), down at the ground about 40 m out.
    p.yaw = Math.atan2(1, 1);
    p.pitch = -0.08;
    const a = cannonAim(sim, g, 0, p, 1, emptyAim());
    const path: { x: number; y: number; z: number }[] = [];
    const n = breadPath(sim, a, 1 / 30, path, 200);
    const end = path[n - 1]!;
    expect(Math.hypot(end.x - a.ax, end.z - a.az)).toBeLessThan(3);
    // Out of its arc (behind the cannon): the barrel stops at the edge of the arc.
    p.yaw = Math.atan2(1, 1) + Math.PI;
    const back = cannonAim(sim, g, 0, p, 1, emptyAim());
    const turn = Math.abs(((back.yaw - g.cannons[0]!.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    expect(turn).toBeCloseTo(CANNON.yawArc, 3);
    // At the sky: the top elevation (the barbette's limit), the longest throw.
    p.yaw = Math.atan2(1, 1);
    p.pitch = 0.8;
    const sky = cannonAim(sim, g, 0, p, 1, emptyAim());
    expect(sky.pitch).toBeCloseTo(CANNON.pitchMax, 5);
    const far = breadPath(sim, sky, 1 / 30, path, 400);
    const land = path[far - 1]!;
    const reach = Math.hypot(land.x - g.cannons[0]!.x, land.z - g.cannons[0]!.z);
    expect(reach).toBeGreaterThan(130);
    expect(reach).toBeLessThan(180);
  });
});
