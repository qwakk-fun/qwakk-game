/**
 * Hunt Season v3, the katana in the shared sim (raid/blade.ts): the light
 * combo with its windows and a buffered press, the heavy charge and release,
 * the Dash (it moves the duck: distance, the wall, the cooldown, the
 * invulnerable ticks), the Quack Shockwave, the Blade Storm and its meter,
 * the pistol swap, and that all of it replays bit for bit (prediction). Also
 * that a duck without the katana (the deathmatch, the battle royale) ignores
 * every new button, and the arc sweep that finds what a swing cuts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Act,
  actionOf,
  armBlade,
  bladeAct,
  BladeAct,
  bladeArcHits,
  bladeCharge,
  BladeEvent,
  BLADE,
  BLADE_SHAPES,
  buildMapDef,
  Button,
  createPlayerSim,
  createSimWorld,
  DASH,
  dashImmune,
  dashPathHits,
  dashTick,
  dashTimer,
  heavyShape,
  hunterShape,
  HunterAct,
  HunterKind,
  initPhysics,
  lastBlade,
  MOVE,
  PLAYER_SIM_FIELDS,
  QUACK,
  quackTick,
  setStormMeter,
  STORM,
  stepPlayer,
  stormLeft,
  stormMeter,
  WeaponId,
  generateMap,
  heldNades,
  heldRockets,
  launcherUp,
  exLauncher,
  SOLID_BITS,
  type ShapeDef,
  type HitTarget,
  type InputFrame,
  type PlayerSim,
  type SimWorld,
} from '../src/index.ts';

beforeAll(async () => {
  await initPhysics();
});

/** A flat 512 m map with one wall across z = -12 (x from -5 to 5). */
function wallWorld(): SimWorld {
  const cells = 128;
  const kit = { props: { wall: [{ type: 'box', kind: 'wall', c: [0, 2, 0], h: [5, 2, 0.4] }] }, kinds: { wall: { move: true, bullets: true, sight: true, opaque: true } } };
  const json = { size: 512, terrain: { cells, cellSize: 4 }, props: [{ prop: 'wall', x: 0, y: 0, z: -12 }] };
  return createSimWorld(buildMapDef('blade-test', json, new Uint8Array((cells + 1) * (cells + 1) * 2), kit).def);
}

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0, ...over });

function bladeDuck(sim: SimWorld, x = 0, z = 0): PlayerSim {
  const p = createPlayerSim(x, 1, z);
  armBlade(p);
  for (let i = 0; i < 20; i++) stepPlayer(sim, p, frame());
  return p;
}

/** Step `n` ticks with these buttons; collects the blade events by tick. */
function run(sim: SimWorld, p: PlayerSim, n: number, buttons: (i: number) => number, over: Partial<InputFrame> = {}): { i: number; kind: number; step: number; charge: number }[] {
  const out = [];
  for (let i = 0; i < n; i++) {
    stepPlayer(sim, p, frame({ ...over, buttons: buttons(i) }));
    for (let k = 0; k < lastBlade.n; k++) out.push({ i, kind: lastBlade.kind[k]!, step: lastBlade.step[k]!, charge: lastBlade.charge[k]! });
  }
  return out;
}

describe('the light combo', () => {
  it('chains Slash 1, 2 and 3 on taps inside the windows, each landing at its impact tick', () => {
    const sim = wallWorld();
    const p = bladeDuck(sim);
    const taps = new Set([0, 6, 13]);
    const ev = run(sim, p, 40, (i) => (taps.has(i) ? Button.Fire : 0));
    const slashes = ev.filter((e) => e.kind === BladeEvent.Slash);
    expect(slashes.map((e) => e.step)).toEqual([1, 2, 3]);
    // Slash 1 starts on the press (tick 0) and lands BLADE.light[0].impact ticks later.
    expect(slashes[0]!.i).toBe(BLADE.light[0]!.impact);
    expect(bladeAct(p)).toBe(BladeAct.Idle);
  });

  it('buffers a press made during the swing and chains when the window opens', () => {
    const sim = wallWorld();
    const p = bladeDuck(sim);
    run(sim, p, 3, (i) => (i === 0 || i === 2 ? Button.Fire : 0));
    expect(bladeAct(p)).toBe(BladeAct.Slash1);
    run(sim, p, BLADE.light[0]!.open, () => 0);
    expect(bladeAct(p)).toBe(BladeAct.Slash2);
  });

  it('drops the combo after its window closes: the next press is Slash 1 again', () => {
    const sim = wallWorld();
    const p = bladeDuck(sim);
    run(sim, p, 30, (i) => (i === 0 ? Button.Fire : 0));
    expect(bladeAct(p)).toBe(BladeAct.Idle);
    run(sim, p, 1, () => Button.Fire);
    expect(bladeAct(p)).toBe(BladeAct.Slash1);
  });

  it('slows the duck while it swings and steps it into the cut', () => {
    const sim = wallWorld();
    const a = bladeDuck(sim, 40, 40);
    const b = bladeDuck(sim, 60, 40);
    // Both run forward; b swings.
    run(sim, a, 30, () => 0, { mz: 1 });
    run(sim, b, 30, () => 0, { mz: 1 });
    const z0a = a.z;
    const z0b = b.z;
    run(sim, a, 6, () => 0, { mz: 1 });
    run(sim, b, 6, (i) => (i === 0 ? Button.Fire : 0), { mz: 1 });
    expect(z0a - a.z).toBeGreaterThan(z0b - b.z);
    const still = bladeDuck(sim, 80, 40);
    const z = still.z;
    run(sim, still, 6, (i) => (i === 0 ? Button.Fire : 0));
    expect(z - still.z).toBeGreaterThan(0.05);
  });
});

describe('the heavy attack', () => {
  it('charges while Fire is held past a swing and spins on release, harder the longer the charge', () => {
    const sim = wallWorld();
    const p = bladeDuck(sim);
    run(sim, p, BLADE.light[0]!.recover + 2, () => Button.Fire);
    expect(bladeAct(p)).toBe(BladeAct.Charge);
    run(sim, p, BLADE.heavy.fullCharge + 4, () => Button.Fire);
    expect(bladeCharge(p)).toBe(1);
    const ev = run(sim, p, 20, () => 0);
    const heavy = ev.find((e) => e.kind === BladeEvent.Heavy)!;
    expect(heavy.i).toBe(BLADE.heavy.impact);
    expect(heavy.charge).toBe(1);
    const q = bladeDuck(sim, 10, 0);
    run(sim, q, BLADE.light[0]!.recover + 4, () => Button.Fire);
    const short = run(sim, q, 10, () => 0).find((e) => e.kind === BladeEvent.Heavy)!;
    expect(short.charge).toBeLessThan(0.4);
  });
});

describe('the dash', () => {
  it('lunges about DASH.distance along the move keys in DASH.ticks, then carries on at run speed', () => {
    const sim = wallWorld();
    const p = bladeDuck(sim, 30, 30);
    const x0 = p.x;
    const ev = run(sim, p, DASH.ticks, (i) => (i === 0 ? Button.Dash : 0), { mx: 1 });
    expect(ev[0]).toMatchObject({ i: 0, kind: BladeEvent.Dash, step: 1 });
    expect(p.x - x0).toBeGreaterThan(DASH.distance * 0.9);
    expect(p.x - x0).toBeLessThan(DASH.distance * 1.1);
    expect(Math.abs(p.z - 30)).toBeLessThan(0.05);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(MOVE.runSpeed, 3);
    expect(dashTick(p)).toBe(DASH.ticks - 1);
    run(sim, p, 1, () => 0, { mx: 1 });
    expect(dashTick(p)).toBe(-1);
  });

  it('goes straight ahead without move keys and stops at a wall (never through it)', () => {
    const sim = wallWorld();
    const p = bladeDuck(sim, 0, -9.5);
    run(sim, p, DASH.ticks + 4, (i) => (i === 0 ? Button.Dash : 0));
    // The wall's face is at z = -11.6; the duck's capsule stays on this side.
    expect(p.z).toBeGreaterThan(-11.6);
    expect(p.z).toBeLessThan(-10.5);
  });

  it('waits out its cooldown, and is immune for its first ticks only', () => {
    const sim = wallWorld();
    const p = bladeDuck(sim, -30, 30);
    run(sim, p, 1, () => Button.Dash);
    expect(dashImmune(p)).toBe(true);
    run(sim, p, DASH.iframes, () => 0);
    expect(dashImmune(p)).toBe(false);
    const again = run(sim, p, 20, (i) => (i % 2 === 0 ? Button.Dash : 0)).filter((e) => e.kind === BladeEvent.Dash && e.step === 1);
    expect(again).toHaveLength(0);
    run(sim, p, DASH.cooldown, () => 0);
    expect(dashTimer(p)).toBe(0);
    expect(run(sim, p, 1, () => Button.Dash)[0]).toMatchObject({ kind: BladeEvent.Dash, step: 1 });
  });

  /** A floor at y = 100 plus these boxes. */
  function boxes(extra: ShapeDef[]): SimWorld {
    const shapes: ShapeDef[] = [{ type: 'box', bits: SOLID_BITS, kind: 'floor', c: [0, 99.5, 0], h: [30, 0.5, 30], q: [0, 0, 0, 1] }, ...extra];
    return createSimWorld({ ...generateMap(7), shapes, boxes: [] });
  }

  /** Dash along +x (yaw -PI/2 looks +x) from (x0, z0); returns the x track and the duck. */
  function dashX(sim: SimWorld, x0: number, over: Partial<InputFrame> = {}): { xs: number[]; p: PlayerSim } {
    const p = createPlayerSim(x0, 100.05, 0);
    armBlade(p);
    for (let i = 0; i < 20; i++) stepPlayer(sim, p, frame({ yaw: -Math.PI / 2 }));
    const xs: number[] = [p.x];
    for (let i = 0; i < 24; i++) {
      stepPlayer(sim, p, frame({ yaw: -Math.PI / 2, mz: 1, ...over, buttons: i === 0 ? Button.Dash : 0 }));
      xs.push(p.x);
    }
    return { xs, p };
  }

  it('started against a wall (or 0.6 m off it) it ends there: never flung backward', () => {
    const wall: ShapeDef = { type: 'box', bits: SOLID_BITS, kind: 'wall', c: [2, 101.5, 0], h: [0.025, 1.5, 5], q: [0, 0, 0, 1] };
    for (const x0 of [1.62, 1.0]) {
      const { xs } = dashX(boxes([wall]), x0);
      for (const x of xs) expect(x, `from ${x0}`).toBeGreaterThan(xs[0]! - 0.05);
      expect(Math.max(...xs), `from ${x0}`).toBeLessThan(1.98);
    }
  });

  it('a blocked dash stops on the spot and lets the cooldown run (no leftover speed)', () => {
    const wall: ShapeDef = { type: 'box', bits: SOLID_BITS, kind: 'wall', c: [2, 101.5, 0], h: [0.025, 1.5, 5], q: [0, 0, 0, 1] };
    const sim = boxes([wall]);
    const p = createPlayerSim(1, 100.05, 0);
    armBlade(p);
    for (let i = 0; i < 20; i++) stepPlayer(sim, p, frame({ yaw: -Math.PI / 2 }));
    stepPlayer(sim, p, frame({ yaw: -Math.PI / 2, buttons: Button.Dash }));
    stepPlayer(sim, p, frame({ yaw: -Math.PI / 2 }));
    expect(dashTick(p)).toBe(-1);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(0.5);
    expect(dashTimer(p)).toBeGreaterThan(DASH.cooldown - DASH.ticks - 3);
  });

  it('a crate-sized box stops it like a wall; at an angle it slides along the wall instead', () => {
    const crate: ShapeDef = { type: 'box', bits: SOLID_BITS, kind: 'crate', c: [2.5, 100.5, 0], h: [0.5, 0.5, 0.5], q: [0, 0, 0, 1] };
    const { xs } = dashX(boxes([crate]), 0);
    for (const x of xs) expect(x).toBeGreaterThan(xs[0]! - 0.05);
    expect(Math.max(...xs)).toBeLessThan(2.0);
    // Into a long wall at 45 degrees (forward and left: +x and -z): it slides along -z instead of stopping dead.
    const wall: ShapeDef = { type: 'box', bits: SOLID_BITS, kind: 'wall', c: [2, 101.5, 0], h: [0.025, 1.5, 15], q: [0, 0, 0, 1] };
    const { p } = dashX(boxes([wall]), 1, { mx: -1 });
    expect(p.x).toBeLessThan(1.98);
    expect(p.z).toBeLessThan(-1.5);
  });

  it('runs off a parapet edge and drops (an edge is not a wall)', () => {
    const ledge: ShapeDef = { type: 'box', bits: SOLID_BITS, kind: 'wall', c: [-5, 100.5, 0], h: [5, 0.5, 5], q: [0, 0, 0, 1] };
    const sim = boxes([ledge]);
    const p = createPlayerSim(-1.5, 101.05, 0);
    armBlade(p);
    for (let i = 0; i < 20; i++) stepPlayer(sim, p, frame({ yaw: -Math.PI / 2 }));
    stepPlayer(sim, p, frame({ yaw: -Math.PI / 2, buttons: Button.Dash }));
    for (let i = 0; i < DASH.ticks; i++) stepPlayer(sim, p, frame({ yaw: -Math.PI / 2 }));
    expect(p.x).toBeGreaterThan(2);
    for (let i = 0; i < 30; i++) stepPlayer(sim, p, frame({ yaw: -Math.PI / 2 }));
    expect(p.y).toBeLessThan(100.2);
  });

  it("stops at the keep gate's leaf (a duck-only collider) without bouncing back", () => {
    const cells = 128;
    const raid = {
      core: [0, 0, 0], coreRadius: 1.5,
      gate: { x: 0, y: 0, z: 10, yaw: 0, width: 4, height: 4 },
      drawbridge: { hingeX: 0, hingeY: 0, hingeZ: 11, yaw: 0, length: 12, width: 4, walk: [[-2, 11], [2, 11], [2, 23], [-2, 23]] },
      cannons: [[-12, 0, -12, 0.7]], cannonUse: [[-11, 0, -11]], duckSpawns: [[0, 0, 4, 0]], hunterSpawns: [[50, 0, 50, 0], [-50, 0, 50, 0]],
    };
    const { def } = buildMapDef('dash-gate', { size: 512, terrain: { cells, cellSize: 4 }, props: [], raid }, new Uint8Array((cells + 1) * (cells + 1) * 2), { props: {} });
    const sim = createSimWorld(def);
    // Outside the gate (+z), in front of the leaf beside the wicket, dashing in (-z: yaw 0).
    const p = createPlayerSim(1.7, 1, 12.5);
    armBlade(p);
    for (let i = 0; i < 20; i++) stepPlayer(sim, p, frame());
    const z0 = p.z;
    let zMin = z0;
    for (let i = 0; i < 24; i++) {
      stepPlayer(sim, p, frame({ mz: 1, buttons: i === 0 ? Button.Dash : 0 }));
      expect(p.z).toBeLessThan(z0 + 0.05);
      zMin = Math.min(zMin, p.z);
    }
    // The leaf holds (the gate's line is z = 10): the duck never gets through it.
    expect(zMin).toBeGreaterThan(9.9);
  });
});

describe('the quack and the storm', () => {
  it('quack: rooted while it casts, the shockwave at its impact tick, then the cooldown', () => {
    const sim = wallWorld();
    const p = bladeDuck(sim, 20, -40);
    const z = p.z;
    const ev = run(sim, p, QUACK.cast, (i) => (i === 0 ? Button.Quack : 0), { mz: 1 });
    expect(ev.find((e) => e.kind === BladeEvent.Quack)?.i).toBe(QUACK.impact);
    expect(Math.abs(p.z - z)).toBeLessThan(0.02);
    expect(quackTick(p)).toBe(QUACK.cast - 1);
    run(sim, p, 1, () => 0);
    expect(quackTick(p)).toBe(-1);
    expect(run(sim, p, 30, (i) => (i === 0 ? Button.Quack : 0)).some((e) => e.kind === BladeEvent.Quack)).toBe(false);
  });

  it('the storm needs a full meter (server written), spins for STORM.ticks with a pulse every STORM.every, and empties it', () => {
    const sim = wallWorld();
    const p = bladeDuck(sim, -20, -40);
    setStormMeter(p, 60);
    expect(run(sim, p, 2, () => Button.Storm).some((e) => e.kind === BladeEvent.StormStart)).toBe(false);
    run(sim, p, 1, () => 0);
    setStormMeter(p, STORM.meterFull);
    expect(stormMeter(p)).toBe(STORM.meterFull);
    const ev = run(sim, p, STORM.ticks + 5, (i) => (i === 0 ? Button.Storm : 0));
    expect(ev[0]!.kind).toBe(BladeEvent.StormStart);
    expect(ev.filter((e) => e.kind === BladeEvent.Storm)).toHaveLength(Math.floor((STORM.ticks - 1) / STORM.every));
    expect(stormLeft(p)).toBe(0);
    expect(stormMeter(p)).toBe(0);
    // The server cannot fill the meter during a storm.
    setStormMeter(p, STORM.meterFull);
    run(sim, p, 2, (i) => (i === 1 ? Button.Storm : 0));
    expect(stormLeft(p)).toBeGreaterThan(0);
    setStormMeter(p, 50);
    expect(stormMeter(p)).toBe(0);
  });
});

describe('several events in one step', () => {
  it('a dash or a quack during the Blade Storm never swallows a storm pulse (and the reverse)', () => {
    const pulses = Math.floor((STORM.ticks - 1) / STORM.every);
    for (let at = 1; at <= STORM.every; at++) {
      const sim = wallWorld();
      const p = bladeDuck(sim, -20, -40);
      setStormMeter(p, STORM.meterFull);
      // Storm on tick 0; a dash on `at`; after it, a quack whose impact lands on a pulse.
      const quackAt = 3 * STORM.every - QUACK.impact + at;
      const ev = run(sim, p, STORM.ticks + 5, (i) => (i === 0 ? Button.Storm : i === at ? Button.Dash : i === quackAt ? Button.Quack : 0), { mz: 1 });
      expect(ev.filter((e) => e.kind === BladeEvent.Storm), `dash at ${at}`).toHaveLength(pulses);
      expect(ev.some((e) => e.kind === BladeEvent.Dash && e.step === 1), `dash at ${at}`).toBe(true);
      expect(ev.some((e) => e.kind === BladeEvent.Quack), `dash at ${at}`).toBe(true);
      // Every moving dash tick after the first is reported too (the server sweeps the whole path).
      expect(ev.filter((e) => e.kind === BladeEvent.Dash && e.step === 2).length, `dash at ${at}`).toBe(DASH.ticks - 1);
      const ticks = new Map<number, number>();
      for (const e of ev) ticks.set(e.i, (ticks.get(e.i) ?? 0) + 1);
      if (at === STORM.every) expect(Math.max(...ticks.values())).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the pistol and the pose', () => {
  it('Slot 2 takes the pistol (it fires as a gun), Slot 1 draws the katana back', () => {
    const sim = wallWorld();
    const p = bladeDuck(sim);
    run(sim, p, 1, () => Button.Slot2);
    expect(p.weapon).toBe(WeaponId.Pistol);
    let shots = 0;
    for (let i = 0; i < 30; i++) if (stepPlayer(sim, p, frame({ buttons: i % 8 === 0 ? Button.Fire : 0 }))) shots++;
    expect(shots).toBeGreaterThan(1);
    run(sim, p, 1, () => Button.Slot1);
    expect(p.weapon).toBe(WeaponId.Katana);
    expect(bladeAct(p)).toBe(BladeAct.Draw);
    expect(actionOf(p)).toBe(Act.Draw);
    run(sim, p, BLADE.drawTicks + 1, () => 0);
    expect(actionOf(p)).toBe(Act.Katana);
    run(sim, p, 1, () => Button.Fire);
    expect(actionOf(p)).toBe(Act.Slash1);
  });
});

describe('the explosives readers', () => {
  it("never see a katana duck's Dash and Quack timers as grenades, rockets or a launcher (pose, HUD, previews)", () => {
    const sim = wallWorld();
    const p = bladeDuck(sim, 20, 20);
    let rawLauncher = 0;
    for (let i = 0; i < QUACK.cooldown + 10; i++) {
      const b = i === 0 ? Button.Quack : i === QUACK.cast + 2 ? Button.Dash : 0;
      stepPlayer(sim, p, frame({ buttons: b, mz: 1 }));
      rawLauncher |= exLauncher(p);
      expect(launcherUp(p)).toBe(0);
      expect(heldNades(p)).toBe(0);
      expect(heldRockets(p)).toBe(0);
      expect(actionOf(p) >= Act.Katana).toBe(true);
    }
    // The raw bits do carry the timers (that is why every reader outside the sim uses the held* getters).
    expect(rawLauncher).toBe(1);
    // A duck without the katana reads its explosives as before.
    const gun = createPlayerSim(0, 1, 0);
    gun.ex = 2 | (3 << 3) | (1 << 7);
    expect([heldNades(gun), heldRockets(gun), launcherUp(gun)]).toEqual([2, 3, 1]);
  });
});

describe('determinism', () => {
  it('replays bit for bit from any state (client prediction against the server copy)', () => {
    const sim = wallWorld();
    const a = bladeDuck(sim, 3, -2);
    setStormMeter(a, STORM.meterFull);
    let seed = 7;
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const bits = [Button.Fire, Button.Dash, Button.Quack, Button.Storm, Button.Slot1, Button.Slot2, Button.Jump, Button.Sprint];
    const frames: InputFrame[] = [];
    for (let i = 0; i < 400; i++) {
      let b = 0;
      for (const bit of bits) if (rnd() < (bit === Button.Fire ? 0.4 : 0.05)) b |= bit;
      frames.push(frame({ mx: Math.fround(rnd() * 2 - 1), mz: Math.fround(rnd() * 2 - 1), yaw: Math.fround(i * 0.02), buttons: b }));
    }
    const b = { ...a };
    const snapshots: PlayerSim[] = [];
    for (const f of frames) {
      stepPlayer(sim, a, f);
      snapshots.push({ ...a });
    }
    for (const f of frames) stepPlayer(sim, b, { ...f });
    for (const k of PLAYER_SIM_FIELDS) expect(b[k]).toBe(a[k]);
    // A reconcile: from the server's state at tick 150, replay the rest.
    const c = { ...snapshots[149]! };
    for (let i = 150; i < frames.length; i++) stepPlayer(sim, c, { ...frames[i]! });
    for (const k of PLAYER_SIM_FIELDS) expect(c[k]).toBe(a[k]);
  });

  it('a duck without the katana (deathmatch, battle royale) ignores the skill buttons entirely', () => {
    const sim = wallWorld();
    const a = createPlayerSim(0, 1, 5);
    for (let i = 0; i < 20; i++) stepPlayer(sim, a, frame());
    const b = { ...a };
    for (let i = 0; i < 60; i++) {
      const f = frame({ mz: 1, yaw: i * 0.01, buttons: i % 5 === 0 ? Button.Fire : 0 });
      stepPlayer(sim, a, f);
      stepPlayer(sim, b, { ...f, buttons: f.buttons | Button.Dash | Button.Quack | Button.Storm });
    }
    for (const k of PLAYER_SIM_FIELDS) if (k !== 'prevButtons') expect(b[k]).toBe(a[k]);
  });
});

describe('the arc sweep', () => {
  const hunter = (id: string, x: number, z: number, yaw = 0): HitTarget => ({ id, x, y: 0, z, crouch: 0, yaw, shape: hunterShape(HunterKind.Beater, HunterAct.Idle) });

  it('one slash cuts every hunter inside its slice, nobody behind or out of reach', () => {
    // The duck at the origin faces -z (yaw 0).
    const ts = [hunter('front', 0, -2), hunter('left', -1.6, -1.2), hunter('right', 1.8, -0.8), hunter('behind', 0, 2), hunter('far', 0, -4)];
    const hits = bladeArcHits(0, 0, 0, 0, BLADE_SHAPES.slash1, ts).map((h) => h.id);
    expect(hits).toContain('front');
    expect(hits).toContain('left');
    expect(hits).toContain('right');
    expect(hits).not.toContain('behind');
    expect(hits).not.toContain('far');
    // Upgrades widen the server's sweep.
    expect(bladeArcHits(0, 0, 0, 0, BLADE_SHAPES.slash1, ts, 1.6).map((h) => h.id)).toContain('far');
  });

  it('the heavy spin cuts all around, further with a full charge; a hunter far above is safe', () => {
    const ts = [hunter('n', 0, -2.5), hunter('s', 0, 2.5), hunter('e', 3.5, 0), { ...hunter('up', 1, 0), y: 6 }];
    expect(bladeArcHits(0, 0, 0, 1.2, heavyShape(0), ts).map((h) => h.id).sort()).toEqual(['n', 's']);
    expect(bladeArcHits(0, 0, 0, 1.2, heavyShape(1), ts).map((h) => h.id).sort()).toEqual(['e', 'n', 's']);
  });

  it('knows a back-stab, and the dash cuts what its path passes', () => {
    // A hunter at (0, -2) facing -z has its back to the duck at the origin.
    const back = bladeArcHits(0, 0, 0, 0, BLADE_SHAPES.slash2, [hunter('h', 0, -2, 0)])[0]!;
    expect(back.back).toBe(true);
    const front = bladeArcHits(0, 0, 0, 0, BLADE_SHAPES.slash2, [hunter('h', 0, -2, Math.PI)])[0]!;
    expect(front.back).toBe(false);
    expect(dashPathHits(0, 0, 0, 0, -4.5, [hunter('a', 0.8, -2), hunter('b', 2.5, -2), hunter('c', 0, -7)])).toEqual(['a']);
  });
});
