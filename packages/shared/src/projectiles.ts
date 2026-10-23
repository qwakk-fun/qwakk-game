/**
 * Flight math of the deathmatch explosives: where a grenade or a rocket
 * starts, how a grenade arcs and bounces, the blast falloff and the blast's
 * line of sight. Pure (state in, state out, the read-only world), so the
 * server runs the authoritative flight with it and the client draws the
 * throw preview and the grenades it was told about with the very same steps.
 *
 * Rays use BULLET_QUERY_GROUPS: grenades bounce off and rockets hit what
 * stops a bullet, and a blast hurts only through what a bullet passes
 * (walls protect; hedges, wire and bushes do not).
 */
import { EXPLOSIVE } from './constants.ts';
import { BULLET_QUERY_GROUPS } from './collision.ts';
import { dcos, dsin } from './math.ts';
import type { SimWorld } from './physics.ts';
import { rayHitbox, type HitTarget } from './hitbox.ts';
import { aimOrigin, directionOf, muzzleOf, type Vec3Like } from './shot.ts';
import type { PlayerSim } from './sim.ts';

/** A grenade or rocket in flight. Plain numbers; `kind` is ExplosiveKind. */
export interface Flight {
  kind: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Ticks since launch. */
  age: number;
  /** 1 once a grenade lies still. */
  rest: number;
}

export function emptyFlight(kind = 0): Flight {
  return { kind, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, rest: 0 };
}

const G = EXPLOSIVE.grenade;
const R = EXPLOSIVE.rocket;

function worldDistance(sim: SimWorld, o: Vec3Like, d: Vec3Like, max: number): number {
  const hit = sim.world.castRay(new sim.rapier.Ray(o, d), max, true, undefined, BULLET_QUERY_GROUPS);
  return hit ? hit.timeOfImpact : max;
}

/**
 * A grenade leaving the hand of `s` (post-step state): from the hand,
 * pulled back if a wall is closer, along the aim tilted up a little, plus a
 * share of the thrower's ground velocity.
 */
export function grenadeLaunch(sim: SimWorld, s: PlayerSim, out: Flight): Flight {
  const fx = -dsin(s.yaw);
  const fz = -dcos(s.yaw);
  const rx = dcos(s.yaw);
  const rz = -dsin(s.yaw);
  const chest = { x: s.x, y: s.y + (s.crouch ? G.handUpCrouch : G.handUp), z: s.z };
  const tx = rx * G.handRight + fx * G.handForward;
  const tz = rz * G.handRight + fz * G.handForward;
  const len = Math.sqrt(tx * tx + tz * tz);
  const free = Math.max(0, worldDistance(sim, chest, { x: tx / len, y: 0, z: tz / len }, len) - G.radius);
  const dir = directionOf(s.yaw, Math.min(1.45, s.pitch + G.upBias), { x: 0, y: 0, z: 0 });
  out.kind = 1;
  out.x = chest.x + (tx / len) * free;
  out.y = chest.y;
  out.z = chest.z + (tz / len) * free;
  out.vx = dir.x * G.speed + s.vx * G.inherit;
  out.vy = dir.y * G.speed;
  out.vz = dir.z * G.speed + s.vz * G.inherit;
  out.age = 0;
  out.rest = 0;
  return out;
}

/**
 * A rocket leaving the launcher of `s`: the camera ray through the crosshair
 * finds the point it aims at (the world, or a duck of `targets` in front of
 * it, as for a shot in shot.ts), and the rocket flies from the muzzle
 * straight at it. `side` is the shoulder (+1 right).
 */
export function rocketLaunch(sim: SimWorld, s: PlayerSim, side: number, out: Flight, targets: readonly HitTarget[] = []): Flight {
  const dir = directionOf(s.yaw, s.pitch, { x: 0, y: 0, z: 0 });
  const origin = aimOrigin(sim, s, side, { x: 0, y: 0, z: 0 });
  const range = R.speed * (R.maxTicks / 30);
  let t = worldDistance(sim, origin, dir, range);
  for (const tg of targets) {
    const h = rayHitbox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, tg, t);
    if (h && h.t < t) t = h.t;
  }
  const muzzle = muzzleOf(sim, s, { x: 0, y: 0, z: 0 });
  let dx = origin.x + dir.x * t - muzzle.x;
  let dy = origin.y + dir.y * t - muzzle.y;
  let dz = origin.z + dir.z * t - muzzle.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1) {
    dx = dir.x;
    dy = dir.y;
    dz = dir.z;
  } else {
    dx /= d;
    dy /= d;
    dz /= d;
  }
  out.kind = 2;
  out.x = muzzle.x;
  out.y = muzzle.y;
  out.z = muzzle.z;
  out.vx = dx * R.speed;
  out.vy = dy * R.speed;
  out.vz = dz * R.speed;
  out.age = 0;
  out.rest = 0;
  return out;
}

/**
 * One step of a grenade: gravity, a swept ray along the move, a bounce off
 * whatever it meets (restitution on the normal part, friction on the rest),
 * rolling friction on the ground and rest once slow. Returns the normal
 * impact speed of a bounce this step (0: none), for the tick sound.
 */
export function stepGrenade(sim: SimWorld, g: Flight, dt: number): number {
  g.age += 1;
  if (g.rest) return 0;
  g.vy -= G.gravity * dt;
  let impact = 0;
  // At most two contacts per step (a corner); the rest of the move after a bounce is dropped.
  for (let i = 0; i < 2; i++) {
    const sp = Math.sqrt(g.vx * g.vx + g.vy * g.vy + g.vz * g.vz);
    const move = sp * dt;
    if (move < 1e-6) break;
    const d = { x: g.vx / sp, y: g.vy / sp, z: g.vz / sp };
    const hit = sim.world.castRayAndGetNormal(new sim.rapier.Ray({ x: g.x, y: g.y, z: g.z }, d), move + G.radius, true, undefined, BULLET_QUERY_GROUPS);
    if (!hit) {
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      break;
    }
    const t = Math.max(0, hit.timeOfImpact - G.radius);
    g.x += d.x * t;
    g.y += d.y * t;
    g.z += d.z * t;
    let nx = hit.normal.x;
    let ny = hit.normal.y;
    let nz = hit.normal.z;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl < 1e-6) {
      // Started inside something: push back the way it came.
      nx = -d.x;
      ny = -d.y;
      nz = -d.z;
    } else {
      nx /= nl;
      ny /= nl;
      nz /= nl;
    }
    const vn = g.vx * nx + g.vy * ny + g.vz * nz;
    if (vn >= 0) break;
    impact = Math.max(impact, -vn);
    // Reflect: normal part bounced back (restitution), tangential part kept (friction).
    const tx = g.vx - vn * nx;
    const ty = g.vy - vn * ny;
    const tz = g.vz - vn * nz;
    const e = -vn < 1.2 ? 0 : G.restitution;
    g.vx = tx * G.friction - vn * e * nx;
    g.vy = ty * G.friction - vn * e * ny;
    g.vz = tz * G.friction - vn * e * nz;
    if (ny > 0.7 && Math.abs(g.vy) < 1) {
      // On the ground: roll, losing speed, and stop when slow.
      g.vy = 0;
      const h = Math.sqrt(g.vx * g.vx + g.vz * g.vz);
      const left = Math.max(0, h - G.rollDecel * dt);
      if (left < G.restSpeed) {
        g.vx = 0;
        g.vz = 0;
        g.rest = 1;
        break;
      }
      g.vx *= left / h;
      g.vz *= left / h;
    }
  }
  return impact;
}

/**
 * The points of a grenade's path from a launch, for the throw preview: one
 * per step until it rests (or, with `toFirstBounce`, first touches
 * something: the last point is then where it lands), the time runs out, or
 * `max` points.
 */
export function grenadePath(sim: SimWorld, from: Flight, seconds: number, dt: number, out: Vec3Like[], max = 64, toFirstBounce = false): number {
  const g = { ...from };
  let n = 0;
  const steps = Math.min(max, Math.round(seconds / dt));
  for (let i = 0; i < steps; i++) {
    const p = out[n] ?? (out[n] = { x: 0, y: 0, z: 0 });
    p.x = g.x;
    p.y = g.y;
    p.z = g.z;
    n++;
    if (g.rest) break;
    if (stepGrenade(sim, g, dt) > 0 && toFirstBounce) {
      const q = out[n] ?? (out[n] = { x: 0, y: 0, z: 0 });
      q.x = g.x;
      q.y = g.y;
      q.z = g.z;
      n++;
      break;
    }
  }
  return n;
}

/**
 * Damage share at `distance` from a blast: 1 inside `inner`, falling off
 * linearly to `edge` at `radius`, 0 beyond.
 */
export function blastFalloff(distance: number, inner: number, radius: number, edge: number): number {
  if (distance >= radius) return 0;
  if (distance <= inner) return 1;
  return 1 - (1 - edge) * ((distance - inner) / (radius - inner));
}

/** Points on a duck the blast tests, as heights above the feet (standing, crouched): feet, belly, head. */
const BLAST_POINTS = { stand: [0.25, 0.8, 1.36], crouch: [0.25, 0.6, 1.04] } as const;

/**
 * The nearest point of a duck (feet at x, y, z) a blast at (cx, cy, cz) can
 * reach through the world, as its distance, or -1 when walls cover every
 * point. Rays use BULLET_QUERY_GROUPS: cover that stops a bullet stops the blast.
 */
export function blastReach(sim: SimWorld, cx: number, cy: number, cz: number, x: number, y: number, z: number, crouch: number, radius: number): number {
  let best = -1;
  for (const h of crouch ? BLAST_POINTS.crouch : BLAST_POINTS.stand) {
    const dx = x - cx;
    const dy = y + h - cy;
    const dz = z - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d >= radius || (best >= 0 && d >= best)) continue;
    if (d > 1e-3 && worldDistance(sim, { x: cx, y: cy, z: cz }, { x: dx / d, y: dy / d, z: dz / d }, d) < d - 0.05) continue;
    best = d;
  }
  return best;
}
