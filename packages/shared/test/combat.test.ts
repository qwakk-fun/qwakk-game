import { beforeAll, describe, expect, it } from 'vitest';
import {
  aimOrigin,
  Button,
  COMBAT,
  createPlayerSim,
  createSimWorld,
  damageAt,
  inaccuracy,
  initPhysics,
  MOVE,
  resolveShot,
  shotAngles,
  spreadSeed,
  ShotOutcome,
  stepWeapon,
  timeToKill,
  weaponStats,
  WeaponId,
  type BoxDef,
  type InputFrame,
  type MapDef,
  type PlayerSim,
  type ShotFired,
} from '../src/index.ts';

beforeAll(async () => {
  await initPhysics();
});

const input = (buttons = 0): InputFrame => ({ seq: 0, tick: 0, mx: 0, mz: 0, buttons, yaw: 0, pitch: 0 });

/** Step only the weapon (with prevButtons bookkeeping), counting shots. */
function run(s: PlayerSim, frames: number[]): number {
  let shots = 0;
  for (const b of frames) {
    if (stepWeapon(s, input(b))) shots++;
    s.prevButtons = b;
  }
  return shots;
}

/** A flat 100 m test world with optional boxes. */
function flatWorld(boxes: BoxDef[] = []) {
  const cells = 10;
  const map: MapDef = {
    id: 'test',
    seed: 0,
    size: 100,
    seaLevel: -10,
    terrain: { cells, cellSize: 10, heights: new Float32Array((cells + 1) * (cells + 1)) },
    boxes,
    rocks: [],
    spawns: [],
    arena: { x: 0, z: 0, radius: 50 },
    arenaSpawns: [],
    shapes: [],
    water: null,
    br: null,
  };
  return createSimWorld(map);
}

describe('weapon stats', () => {
  const rifle = weaponStats(WeaponId.Rifle);
  const pistol = weaponStats(WeaponId.Pistol);

  it('rifle body time to kill is 0.4 to 0.5 s and headshots are much faster', () => {
    expect(timeToKill(rifle, false)).toBeGreaterThanOrEqual(0.4);
    expect(timeToKill(rifle, false)).toBeLessThanOrEqual(0.5);
    expect(timeToKill(rifle, true)).toBeLessThanOrEqual(timeToKill(rifle, false) / 3);
  });

  it('rifle fires at 600 RPM', () => {
    expect(rifle.fireTicks).toBe(3);
  });

  it('pistol is slower on the body but one-taps heads up close', () => {
    expect(timeToKill(pistol, false)).toBeGreaterThan(timeToKill(rifle, false));
    expect(damageAt(pistol, 10, true)).toBeGreaterThanOrEqual(COMBAT.maxHp);
  });

  it('damage falls off with range but never below the floor', () => {
    expect(damageAt(rifle, 30, false)).toBe(rifle.damage);
    expect(damageAt(rifle, 120, false)).toBeLessThan(rifle.damage);
    expect(damageAt(rifle, 1000, false)).toBe(Math.round(rifle.damage * rifle.minDamageScale));
  });
});

describe('spread', () => {
  const rifle = weaponStats(WeaponId.Rifle);

  it('standing still gives first-shot accuracy, crouching is tighter', () => {
    const s = { ...createPlayerSim(0, 0, 0), grounded: 1 };
    expect(inaccuracy(rifle, s, 0)).toBeCloseTo(rifle.spreadStand, 9);
    expect(inaccuracy(rifle, { ...s, crouch: 1 }, 0)).toBeLessThan(rifle.spreadStand);
  });

  it('running is inaccurate; a counter-strafe below the accurate speed is not', () => {
    const run = { ...createPlayerSim(0, 0, 0), grounded: 1, vx: MOVE.runSpeed };
    const slow = { ...run, vx: MOVE.runSpeed * (COMBAT.accurateSpeedFraction - 0.01) };
    expect(inaccuracy(rifle, run, 0)).toBeGreaterThan(rifle.spreadStand * 10);
    expect(inaccuracy(rifle, slow, 0)).toBeCloseTo(rifle.spreadStand, 9);
  });

  it('jumping is the least accurate', () => {
    const air = { ...createPlayerSim(0, 0, 0), grounded: 0 };
    const run = { ...createPlayerSim(0, 0, 0), grounded: 1, vx: MOVE.runSpeed };
    expect(inaccuracy(rifle, air, 0)).toBeGreaterThan(inaccuracy(rifle, run, 0));
  });

  it('the spray pattern and spread are deterministic per shot', () => {
    const s = createPlayerSim(0, 0, 0);
    const shot: ShotFired = { weapon: 0, sprayIndex: 7, inaccuracy: 0.01, shotSeq: 42 };
    expect(shotAngles(s, shot, 3)).toEqual(shotAngles(s, shot, 3));
    expect(shotAngles(s, shot, 3)).not.toEqual(shotAngles(s, { ...shot, shotSeq: 43 }, 3));
    // The pattern climbs: shot 10 lands well above shot 0 with no spread.
    const a = shotAngles(s, { ...shot, sprayIndex: 0, inaccuracy: 0 }, 3);
    const b = shotAngles(s, { ...shot, sprayIndex: 10, inaccuracy: 0 }, 3);
    expect(b.pitch - a.pitch).toBeGreaterThan(0.05);
  });
});

describe('fire rate and ammo (server-enforced state machine)', () => {
  it('holding the rifle trigger for 1 s fires exactly 10 shots', () => {
    const s = createPlayerSim(0, 0, 0);
    expect(run(s, new Array(30).fill(Button.Fire))).toBe(10);
  });

  it('the pistol is semi-auto: holding fires once, spamming is capped by the fire rate', () => {
    const s = { ...createPlayerSim(0, 0, 0), weapon: WeaponId.Pistol };
    expect(run(s, new Array(30).fill(Button.Fire))).toBe(1);
    const t = { ...createPlayerSim(0, 0, 0), weapon: WeaponId.Pistol };
    const spam = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? Button.Fire : 0));
    expect(run(t, spam)).toBe(5); // one shot per 6 ticks at most
  });

  it('a spamming client can not fire more than the magazine, and reload refills from reserve', () => {
    const s = createPlayerSim(0, 0, 0);
    const rifle = weaponStats(WeaponId.Rifle);
    const spam = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? Button.Fire : 0));
    const shots = run(s, spam.slice(0, 120));
    expect(shots).toBe(rifle.magSize);
    expect(s.mag0).toBe(0);
    // A trigger pull on an empty mag starts a reload (no shot); let it finish.
    expect(run(s, [0, Button.Fire, 0])).toBe(0);
    expect(s.reload).toBeGreaterThan(0);
    run(s, new Array(rifle.reloadTicks + 2).fill(0));
    expect(s.mag0).toBe(rifle.magSize);
    expect(s.res0).toBe(rifle.reserve - rifle.magSize);
  });

  it('cannot fire while equipping, and switching cancels a reload', () => {
    const s = createPlayerSim(0, 0, 0);
    s.mag0 = 5;
    run(s, [Button.Reload, 0]);
    expect(s.reload).toBeGreaterThan(0);
    run(s, [Button.Slot2]);
    expect(s.weapon).toBe(WeaponId.Pistol);
    expect(s.reload).toBe(0);
    expect(run(s, [Button.Fire, 0, Button.Fire])).toBe(0); // still equipping
    run(s, new Array(weaponStats(WeaponId.Pistol).equipTicks).fill(0));
    expect(run(s, [Button.Fire])).toBe(1);
    run(s, [Button.Slot1, 0]);
    expect(s.mag0).toBe(5); // the cancelled reload did not refill
  });
});

describe('spread secrecy', () => {
  it('the random spread depends on the seed; the spray pattern does not', () => {
    const s = createPlayerSim(0, 0, 0);
    const shot: ShotFired = { weapon: 0, sprayIndex: 5, inaccuracy: 0.02, shotSeq: 9 };
    // A client that does not know the server's seed lands somewhere else in the cone.
    expect(shotAngles(s, shot, 123)).not.toEqual(shotAngles(s, shot, 456));
    // With no inaccuracy, only the learnable pattern is left: identical for any seed.
    const still = { ...shot, inaccuracy: 0 };
    expect(shotAngles(s, still, 123)).toEqual(shotAngles(s, still, 456));
  });

  it('round secrets give each player a different seed', () => {
    expect(spreadSeed(1, 1)).not.toBe(spreadSeed(2, 1));
    expect(spreadSeed(1, 1)).not.toBe(spreadSeed(1, 2));
  });

  it('pattern plus spread never points past straight up or down', () => {
    const s = { ...createPlayerSim(0, 0, 0), pitch: 1.45 };
    const a = shotAngles(s, { weapon: 0, sprayIndex: 29, inaccuracy: 0.2, shotSeq: 3 }, 7);
    expect(a.pitch).toBeLessThan(Math.PI / 2);
  });
});

describe('crouching behind cover is fair both ways', () => {
  // Cover 1.15 m tall (the arena's low walls), 1 m in front of the crouched duck at z = 0.
  const cover: BoxDef = { kind: 'cover', c: [0, 0.575, -1], h: [2, 0.575, 0.3], q: [0, 0, 0, 1] };
  const shot: ShotFired = { weapon: 0, sprayIndex: 0, inaccuracy: 0, shotSeq: 1 };

  it('a crouched duck can shoot over the cover its head peeks over', () => {
    const s = { ...createPlayerSim(0, 0, 0), grounded: 1, crouch: 1 };
    const origin = aimOrigin(flatWorld([cover]), s, 1, { x: 0, y: 0, z: 0 });
    s.pitch = Math.atan2(1.0 - origin.y, 20);
    s.yaw = Math.atan2(-(0.75 - origin.x), 20);
    const r = resolveShot(flatWorld([cover]), s, 'me', 1, shot, 1, [{ id: 't', x: 0.75, y: 0, z: -20, crouch: 0 }]);
    expect(r.outcome).toBe(ShotOutcome.Body);
  });

  it('a standing duck can hit that crouched head above the cover, but not the body behind it', () => {
    const shooter = { ...createPlayerSim(0, 0, -20), grounded: 1, yaw: Math.PI };
    const world = flatWorld([cover]);
    const target = { id: 't', x: 0, y: 0, z: 0, crouch: 1 };
    const origin = aimOrigin(world, shooter, 1, { x: 0, y: 0, z: 0 });
    const aimAt = (y: number) => {
      const dx = target.x - origin.x;
      const dz = target.z - origin.z;
      shooter.yaw = Math.atan2(-dx, -dz);
      shooter.pitch = Math.atan2(y - origin.y, Math.hypot(dx, dz));
      return resolveShot(world, shooter, 'me', 1, shot, 1, [target]);
    };
    // The visible top of the head (above the 1.15 m cover line).
    expect(aimAt(1.22).outcome).toBe(ShotOutcome.Head);
    expect(aimAt(0.6).outcome).toBe(ShotOutcome.World);
  });
});

describe('hitscan resolution', () => {
  const shot: ShotFired = { weapon: 0, sprayIndex: 0, inaccuracy: 0, shotSeq: 1 };

  /** Shooter at the origin facing -z, aiming at the chest of a target 20 m away on the right-shoulder line. */
  function setup() {
    const s = { ...createPlayerSim(0, 0, 0), grounded: 1 };
    const target = { id: 't', x: 0.75, y: 0, z: -20, crouch: 0 };
    // Aim from the shoulder point down to the target's chest.
    const eyeY = 1.55 + 0.32;
    s.pitch = Math.atan2(1.0 - eyeY, 20);
    return { s, target };
  }

  it('hits a target in the open', () => {
    const { s, target } = setup();
    const r = resolveShot(flatWorld(), s, 'me', 1, shot, 1, [target]);
    expect(r.outcome).toBe(ShotOutcome.Body);
    expect(r.targetId).toBe('t');
  });

  it('a wall in front of the muzzle stops the shot even though the camera sees the target', () => {
    const { s, target } = setup();
    // A wall that ends at x = 0.5: the shoulder (x = 0.75) sees past it, the gun (x = 0.3) does not.
    const wall: BoxDef = { kind: 'wall', c: [-0.75, 1.5, -1.35], h: [1.25, 1.5, 0.15], q: [0, 0, 0, 1] };
    const r = resolveShot(flatWorld([wall]), s, 'me', 1, shot, 1, [target]);
    expect(r.outcome).toBe(ShotOutcome.World);
    expect(r.blockedByWall).toBe(true);
    expect(r.end.z).toBeGreaterThan(-1.6);
  });

  it('headshots register on the head sphere', () => {
    const s = { ...createPlayerSim(0, 0, 0), grounded: 1 };
    const target = { id: 't', x: 0.75, y: 0, z: -20, crouch: 0 };
    s.pitch = Math.atan2(1.4 - (1.55 + 0.32), 20);
    const r = resolveShot(flatWorld(), s, 'me', 1, shot, 1, [target]);
    expect(r.outcome).toBe(ShotOutcome.Head);
  });

  it('crouching lowers the head hitbox', () => {
    const s = { ...createPlayerSim(0, 0, 0), grounded: 1 };
    s.pitch = Math.atan2(1.4 - (1.55 + 0.32), 20);
    const r = resolveShot(flatWorld(), s, 'me', 1, shot, 1, [{ id: 't', x: 0.75, y: 0, z: -20, crouch: 1 }]);
    expect(r.outcome).not.toBe(ShotOutcome.Head);
  });
});
