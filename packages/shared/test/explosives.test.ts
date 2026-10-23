import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  blastFalloff,
  blastReach,
  Button,
  copyPlayerSim,
  createPlayerSim,
  createSimWorld,
  DT,
  emptyFlight,
  emptyInput,
  EX_MAX,
  exLauncher,
  exNades,
  exRockets,
  EXPLOSIVE,
  ExplosiveKind,
  grenadeLaunch,
  grenadePath,
  initPhysics,
  lastExplosive,
  packEx,
  rocketLaunch,
  setNades,
  setRockets,
  stepGrenade,
  stepPlayer,
  unpackEx,
  type InputFrame,
  type MapDef,
  type PlayerSim,
  type SimWorld,
} from '../src/index.ts';

beforeAll(initPhysics);
let world: SimWorld | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

function flat(boxes: MapDef['boxes'] = []): SimWorld {
  world = createSimWorld({
    id: 'test', seed: 1, size: 100, seaLevel: -10,
    terrain: { cells: 10, cellSize: 10, heights: new Float32Array(121) },
    boxes, rocks: [], shapes: [], spawns: [[0, 0.5, 0]], arenaSpawns: [],
    arena: { x: 0, z: 0, radius: 40 }, water: null, br: null,
  });
  return world;
}

/** A grounded duck at the origin. */
function duck(sim: SimWorld): PlayerSim {
  const s = createPlayerSim(0.3, 0.02, 0.3);
  for (let i = 0; i < 10; i++) stepPlayer(sim, s, emptyInput());
  return s;
}

const frame = (buttons: number): InputFrame => ({ ...emptyInput(), buttons });

/** Step with these buttons and return what the step threw or launched. */
function step(sim: SimWorld, s: PlayerSim, buttons: number): number {
  stepPlayer(sim, s, frame(buttons));
  return lastExplosive.kind;
}

describe('packed explosive state', () => {
  it('round-trips and clamps, and every gate fits its bits', () => {
    const e = { nades: 2, rockets: 3, out: 1, nadeCd: 24, rocketCd: 33 };
    expect(unpackEx(packEx(e))).toEqual(e);
    expect(unpackEx(packEx({ nades: 99, rockets: 99, out: 1, nadeCd: 99, rocketCd: 99 }))).toEqual({ nades: 7, rockets: 15, out: 1, nadeCd: 31, rocketCd: 63 });
    expect(EXPLOSIVE.grenade.throwTicks).toBeLessThanOrEqual(EX_MAX.nadeCd);
    expect(Math.max(EXPLOSIVE.rocket.fireTicks, EXPLOSIVE.rocket.equipTicks, EXPLOSIVE.grenade.busyTicks)).toBeLessThanOrEqual(EX_MAX.rocketCd);
    expect(EXPLOSIVE.grenade.perLife).toBeLessThanOrEqual(EX_MAX.nades);
    expect(EXPLOSIVE.rocket.perPickup).toBeLessThanOrEqual(EX_MAX.rockets);
    const s = { ex: 0 };
    setRockets(s, 2);
    setNades(s, 1);
    expect([exNades(s), exRockets(s), exLauncher(s)]).toEqual([1, 2, 0]);
  });
});

describe('grenade throw (shared sim)', () => {
  it('throws on release only, through the throw gate, until none are left', () => {
    const sim = flat();
    const s = duck(sim);
    setNades(s, 2);
    expect(step(sim, s, Button.Grenade)).toBe(0); // holding: nothing yet
    expect(step(sim, s, Button.Grenade)).toBe(0);
    expect(step(sim, s, 0)).toBe(ExplosiveKind.Grenade); // let go: thrown
    expect(exNades(s)).toBe(1);
    // A second press and release right away: the gate is closed.
    step(sim, s, Button.Grenade);
    expect(step(sim, s, 0)).toBe(0);
    expect(exNades(s)).toBe(1);
    for (let i = 0; i < EXPLOSIVE.grenade.throwTicks; i++) step(sim, s, 0);
    step(sim, s, Button.Grenade);
    expect(step(sim, s, 0)).toBe(ExplosiveKind.Grenade);
    expect(exNades(s)).toBe(0);
    for (let i = 0; i < EXPLOSIVE.grenade.throwTicks + 2; i++) step(sim, s, 0);
    step(sim, s, Button.Grenade);
    expect(step(sim, s, 0)).toBe(0); // none left
  });

  it('does nothing for a duck without explosives (the battle royale) and never while healing or dead', () => {
    const sim = flat();
    const s = duck(sim);
    expect(s.ex).toBe(0);
    step(sim, s, Button.Grenade | Button.Slot3);
    expect(step(sim, s, Button.Fire)).toBe(0);
    expect(s.ex).toBe(0);
    setNades(s, 2);
    s.heal = 10;
    step(sim, s, Button.Grenade);
    expect(step(sim, s, 0)).toBe(0);
    s.heal = 0;
    s.alive = 0;
    step(sim, s, Button.Grenade);
    expect(step(sim, s, 0)).toBe(0);
    expect(exNades(s)).toBe(2);
  });

  it('predicts exactly: a copied state replays the same throws and gates', () => {
    const sim = flat();
    const a = duck(sim);
    setNades(a, 2);
    setRockets(a, 3);
    const b = copyPlayerSim(a, createPlayerSim(0, 0, 0));
    const script = [Button.Grenade, Button.Grenade, 0, Button.Slot3, 0, ...Array(14).fill(Button.Fire), 0, Button.Fire, Button.Grenade, 0, Button.Slot1, 0];
    for (const buttons of script) {
      const ka = step(sim, a, buttons);
      const kb = step(sim, b, buttons);
      expect(kb).toBe(ka);
      expect(b).toEqual(a);
    }
  });
});

describe('rocket launcher slot (shared sim)', () => {
  it('raises with rockets only, fires one per press through its gate, and puts itself away after the last', () => {
    const sim = flat();
    const s = duck(sim);
    step(sim, s, Button.Slot3);
    expect(exLauncher(s)).toBe(0); // no rockets: no slot
    step(sim, s, 0);
    setRockets(s, 3);
    step(sim, s, Button.Slot3);
    expect(exLauncher(s)).toBe(1);
    // Raising it takes EXPLOSIVE.rocket.equipTicks (a press before that is lost, like the pistol's).
    for (let i = 0; i < EXPLOSIVE.rocket.equipTicks; i++) step(sim, s, 0);
    const mag = s.mag0;
    let launched = 0;
    let shots = 0;
    // Hold the trigger: semi-automatic, so one rocket; the gun never fires while the launcher is up.
    for (let i = 0; i < 60; i++) {
      const shot = stepPlayer(sim, s, frame(Button.Fire));
      if (shot) shots++;
      if (lastExplosive.kind === ExplosiveKind.Rocket) launched++;
    }
    expect(launched).toBe(1);
    expect(shots).toBe(0);
    expect(s.mag0).toBe(mag);
    // Fast presses: one rocket per EXPLOSIVE.rocket.fireTicks at most.
    const times: number[] = [];
    let equipAfterLast = 0;
    for (let i = 0; i < 80; i++) {
      if (step(sim, s, i % 2 === 0 ? Button.Fire : 0) !== ExplosiveKind.Rocket) continue;
      times.push(i);
      equipAfterLast = s.equip;
    }
    expect(times.length).toBe(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(EXPLOSIVE.rocket.fireTicks);
    expect(exRockets(s)).toBe(0);
    expect(exLauncher(s)).toBe(0); // the slot is gone
    expect(equipAfterLast).toBeGreaterThan(0); // the gun comes back up
  });

  it('Slot1 puts the launcher away and keeps the rockets', () => {
    const sim = flat();
    const s = duck(sim);
    setRockets(s, 2);
    step(sim, s, Button.Slot3);
    step(sim, s, 0);
    step(sim, s, Button.Slot1);
    expect(exLauncher(s)).toBe(0);
    expect(exRockets(s)).toBe(2);
  });
});

describe('grenade flight', () => {
  it('arcs, bounces, rests and is deterministic (same launch, same path)', () => {
    const sim = flat();
    const s = duck(sim);
    s.pitch = 0.3;
    const a = grenadeLaunch(sim, s, emptyFlight());
    const b = grenadeLaunch(sim, s, emptyFlight());
    expect(a).toEqual(b);
    expect(a.kind).toBe(ExplosiveKind.Grenade);
    const speed = Math.hypot(a.vx, a.vy, a.vz);
    expect(speed).toBeCloseTo(EXPLOSIVE.grenade.speed, 0);
    let bounces = 0;
    let peak = a.y;
    for (let i = 0; i < EXPLOSIVE.grenade.fuseTicks * 2; i++) {
      const ia = stepGrenade(sim, a, DT);
      const ib = stepGrenade(sim, b, DT);
      expect(ib).toBe(ia);
      expect(b).toEqual(a);
      if (ia > EXPLOSIVE.grenade.tickSpeed) bounces++;
      peak = Math.max(peak, a.y);
      expect(a.y).toBeGreaterThanOrEqual(0); // never through the ground
    }
    expect(peak).toBeGreaterThan(s.y + 2);
    expect(bounces).toBeGreaterThanOrEqual(1);
    expect(a.rest).toBe(1);
    expect(Math.hypot(a.x - s.x, a.z - s.z)).toBeGreaterThan(10);
    // The preview path is the same flight.
    const c = grenadeLaunch(sim, s, emptyFlight());
    const pts: { x: number; y: number; z: number }[] = [];
    const n = grenadePath(sim, c, 1, DT, pts);
    const d = grenadeLaunch(sim, s, emptyFlight());
    for (let i = 0; i < n - 1; i++) stepGrenade(sim, d, DT);
    expect(pts[n - 1]).toEqual({ x: d.x, y: d.y, z: d.z });
  });

  it('bounces back off a wall', () => {
    // A wall 4 m in front (forward is -z at yaw 0).
    const sim = flat([{ kind: 'wall', c: [0, 2, -4], h: [4, 2, 0.25], q: [0, 0, 0, 1] }]);
    const s = duck(sim);
    const g = grenadeLaunch(sim, s, emptyFlight());
    for (let i = 0; i < 30; i++) stepGrenade(sim, g, DT);
    expect(g.z).toBeGreaterThan(-3.75); // stayed on our side
  });

  it('a rocket flies at the crosshair from the muzzle', () => {
    const sim = flat();
    const s = duck(sim);
    const r = rocketLaunch(sim, s, 1, emptyFlight());
    expect(r.kind).toBe(ExplosiveKind.Rocket);
    expect(Math.hypot(r.vx, r.vy, r.vz)).toBeCloseTo(EXPLOSIVE.rocket.speed, 3);
    expect(r.vz).toBeLessThan(0);
  });
});

describe('blast', () => {
  it('falls off from the core to the edge', () => {
    const G = EXPLOSIVE.grenade;
    expect(blastFalloff(0, G.innerRadius, G.blastRadius, G.edgeScale)).toBe(1);
    expect(blastFalloff(G.innerRadius, G.innerRadius, G.blastRadius, G.edgeScale)).toBe(1);
    const mid = blastFalloff((G.innerRadius + G.blastRadius) / 2, G.innerRadius, G.blastRadius, G.edgeScale);
    expect(mid).toBeCloseTo((1 + G.edgeScale) / 2, 5);
    expect(blastFalloff(G.blastRadius - 1e-6, G.innerRadius, G.blastRadius, G.edgeScale)).toBeCloseTo(G.edgeScale, 4);
    expect(blastFalloff(G.blastRadius, G.innerRadius, G.blastRadius, G.edgeScale)).toBe(0);
  });

  it('reaches a duck in the open, not through a wall', () => {
    const sim = flat([{ kind: 'wall', c: [0, 2, -3], h: [3, 2, 0.25], q: [0, 0, 0, 1] }]);
    const open = blastReach(sim, 0, 0.4, 3, 0, 0, 0, 0, 6.5);
    expect(open).toBeGreaterThan(2);
    expect(open).toBeLessThan(3.2);
    expect(blastReach(sim, 0, 0.4, -6, 0, 0, 0, 0, 6.5)).toBe(-1); // the wall covers every point
    expect(blastReach(sim, 0, 0.4, 20, 0, 0, 0, 0, 6.5)).toBe(-1); // out of range
  });
});
