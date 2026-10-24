/**
 * The bread cannon's shot (Hunt Season, Pond Keep): where a manned cannon
 * lobs a loaf for the duck's aim, and how a loaf flies. Pure (state in, the
 * read-only world), so the server fires and flies the loaves with it and the
 * client draws the aim preview, turns the barrel and draws the loaves it was
 * told about with the very same steps. Damage, splash, knockback, the fire
 * rate and the heat are server settings (`raid.cannon.*`).
 */
import { BULLET_QUERY_GROUPS } from '../collision.ts';
import { rayHitbox, type HitTarget } from '../hitbox.ts';
import type { SimWorld } from '../physics.ts';
import type { Flight } from '../projectiles.ts';
import { aimOrigin, directionOf, type Vec3Like } from '../shot.ts';
import type { PlayerSim } from '../sim.ts';
import type { KeepGeometry } from './keep.ts';

/** The bread cannon's barrel and loaf (the arc preview and the drawn loaves use these; damage and heat are server settings). */
export const CANNON = {
  /** Pivot (trunnion) height above the mount and barrel length to the muzzle (m), from bread_cannon.glb's anchors. */
  pivotUp: 0.95,
  barrel: 1.55,
  /** Loaf launch speed (m/s) and gravity (m/s²): about 150 m at the top elevation from a tower. */
  speed: 54,
  gravity: 14,
  /**
   * How far the barrel turns either way from straight out (rad), and its
   * elevation range (rad): what clears the barbette's sill and merlons on
   * Pond Keep's towers (about 40 degrees either way, 23 up and down).
   */
  yawArc: 0.7,
  pitchMin: -0.4,
  pitchMax: 0.4,
  /** The crosshair's aim point is looked for this far (m), past the first few meters (the cannon itself). */
  aimRange: 180,
  aimSkip: 2.5,
  /** A loaf's collision radius (m) and longest flight (ticks). */
  radius: 0.2,
  maxTicks: 8 * 30,
} as const;

const wrapPi = (a: number): number => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

export interface CannonAim extends Flight {
  /** The barrel's turn (sim yaw) and elevation. */
  yaw: number;
  pitch: number;
  /** Where the crosshair points (what the loaf is lobbed at). */
  ax: number;
  ay: number;
  az: number;
}

export function emptyAim(): CannonAim {
  return { kind: 4, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, rest: 0, yaw: 0, pitch: 0, ax: 0, ay: 0, az: 0 };
}

/**
 * Where cannon `i` lobs a loaf for a duck aiming like `s` (TPS rule: the
 * camera ray through the crosshair finds the point): the barrel turns toward
 * it within its arc and takes the low arc that lands there at the loaf's
 * speed (its top elevation when it is out of reach), within its elevation range.
 * The server fires with it; the client draws the preview arc and turns the
 * barrel with the same numbers.
 */
export function cannonAim(sim: SimWorld, g: KeepGeometry, i: number, s: PlayerSim, side: number, out: CannonAim): CannonAim {
  const c = g.cannons[i] ?? g.cannons[0]!;
  const dir = directionOf(s.yaw, s.pitch, { x: 0, y: 0, z: 0 });
  const o = aimOrigin(sim, s, side, { x: 0, y: 0, z: 0 });
  const ox = o.x + dir.x * CANNON.aimSkip;
  const oy = o.y + dir.y * CANNON.aimSkip;
  const oz = o.z + dir.z * CANNON.aimSkip;
  const hit = sim.world.castRay(new sim.rapier.Ray({ x: ox, y: oy, z: oz }, dir), CANNON.aimRange, true, undefined, BULLET_QUERY_GROUPS);
  const t = hit ? hit.timeOfImpact : CANNON.aimRange;
  out.ax = ox + dir.x * t;
  out.ay = oy + dir.y * t;
  out.az = oz + dir.z * t;
  const py = c.y + CANNON.pivotUp;
  const hx = out.ax - c.x;
  const hz = out.az - c.z;
  const d = Math.max(2, Math.hypot(hx, hz));
  let yaw = Math.atan2(-hx, -hz);
  const turn = wrapPi(yaw - c.yaw);
  yaw = wrapPi(c.yaw + Math.max(-CANNON.yawArc, Math.min(CANNON.yawArc, turn)));
  const v = CANNON.speed;
  const gr = CANNON.gravity;
  const h = out.ay - py;
  const disc = v * v * v * v - gr * (gr * d * d + 2 * h * v * v);
  // The low arc that lands there; out of reach: the highest elevation the barrel has (the longest throw it can make).
  let pitch = disc >= 0 ? Math.atan((v * v - Math.sqrt(disc)) / (gr * d)) : CANNON.pitchMax;
  pitch = Math.max(CANNON.pitchMin, Math.min(CANNON.pitchMax, pitch));
  const bd = directionOf(yaw, pitch, { x: 0, y: 0, z: 0 });
  out.kind = 4;
  out.yaw = yaw;
  out.pitch = pitch;
  out.x = c.x + bd.x * CANNON.barrel;
  out.y = py + bd.y * CANNON.barrel;
  out.z = c.z + bd.z * CANNON.barrel;
  out.vx = bd.x * v;
  out.vy = bd.y * v;
  out.vz = bd.z * v;
  out.age = 0;
  out.rest = 0;
  return out;
}

/** What a loaf hit this step: nothing (0), the world (1) or a target (2, `id`). Reused object. */
export const breadHit = { kind: 0, id: '' as string, x: 0, y: 0, z: 0 };

/**
 * One step of a loaf: gravity, then a swept ray along the move against what
 * stops a bullet and against `targets` (hunters). On a hit the loaf stops at
 * the point (breadHit says what it hit). Returns breadHit.kind.
 */
export function stepBread(sim: SimWorld, f: Flight, dt: number, targets: readonly HitTarget[] = []): number {
  f.age += 1;
  breadHit.kind = 0;
  breadHit.id = '';
  f.vy -= CANNON.gravity * dt;
  const sp = Math.sqrt(f.vx * f.vx + f.vy * f.vy + f.vz * f.vz);
  const move = sp * dt;
  if (move < 1e-6) return 0;
  const d = { x: f.vx / sp, y: f.vy / sp, z: f.vz / sp };
  const wall = sim.world.castRay(new sim.rapier.Ray({ x: f.x, y: f.y, z: f.z }, d), move + CANNON.radius, true, undefined, BULLET_QUERY_GROUPS);
  let t = wall ? Math.max(0, wall.timeOfImpact - CANNON.radius) : move;
  let kind = wall ? 1 : 0;
  for (const tg of targets) {
    if (Math.abs(tg.x - f.x) > move + 3 || Math.abs(tg.z - f.z) > move + 3) continue;
    const h = rayHitbox(f.x, f.y, f.z, d.x, d.y, d.z, tg, t + CANNON.radius);
    if (h && h.t <= t + CANNON.radius) {
      t = Math.max(0, h.t - CANNON.radius * 0.5);
      kind = 2;
      breadHit.id = tg.id;
    }
  }
  f.x += d.x * t;
  f.y += d.y * t;
  f.z += d.z * t;
  if (kind) {
    f.rest = 1;
    breadHit.kind = kind;
    breadHit.x = f.x;
    breadHit.y = f.y;
    breadHit.z = f.z;
  } else if (f.age >= CANNON.maxTicks || f.y < -60) {
    f.rest = 1;
    breadHit.kind = 1;
    breadHit.x = f.x;
    breadHit.y = f.y;
    breadHit.z = f.z;
  }
  return breadHit.kind;
}

/** The arc a loaf flies (the client's aim preview): points every other step, up to the first hit. Returns the count. */
export function breadPath(sim: SimWorld, from: Flight, dt: number, out: Vec3Like[], max = 48): number {
  const f: Flight = { ...from };
  let n = 0;
  const push = (): void => {
    const p = out[n] ?? (out[n] = { x: 0, y: 0, z: 0 });
    p.x = f.x;
    p.y = f.y;
    p.z = f.z;
    n++;
  };
  push();
  for (let i = 0; i < CANNON.maxTicks && n < max; i++) {
    const k = stepBread(sim, f, dt);
    if (k || i % 2 === 1) push();
    if (k) break;
  }
  return n;
}
