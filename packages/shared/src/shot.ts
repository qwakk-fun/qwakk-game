/**
 * Hitscan resolution for third-person shooting.
 *
 * TPS rule: the camera ray through the crosshair finds the aim point, then the
 * shot is traced from the gun muzzle to that point. If a wall sits between the
 * muzzle and the aim point (the camera sees past a corner the gun cannot), the
 * shot hits the wall. Same function on client (instant feedback) and server
 * (authority, with targets rewound to what the shooter saw).
 *
 * The camera ray starts at the shoulder point, not at the camera: the camera
 * sits on the same line further back (camera = shoulder - dir * arm), so the
 * line is identical, minus whatever is behind the player.
 */
import { dcos, dsin } from './math.ts';
import { PLAYER_QUERY_GROUPS, type SimWorld } from './physics.ts';
import { rayHitbox, type HitTarget } from './hitbox.ts';
import type { PlayerSim } from './sim.ts';
import { eyeHeight } from './sim.ts';
import type { ShotFired } from './combat.ts';
import { COMBAT, weaponStats } from './weapons.ts';

/** Shoulder offset of the aim ray (matches the camera rig). */
export const AIM = {
  shoulderX: 0.75,
  shoulderY: 0.32,
  /** Gun muzzle relative to the feet: right, up (standing / crouched), forward. */
  muzzleRight: 0.3,
  muzzleUp: 1.22,
  /** Crouched: high enough to clear what the crouched head clears (1.15 m cover), so crouching behind cover is fair both ways. */
  muzzleUpCrouch: 1.2,
  muzzleForward: 0.6,
} as const;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Unit direction for a yaw/pitch (forward is -z at yaw 0). */
export function directionOf(yaw: number, pitch: number, out: Vec3Like): Vec3Like {
  const cp = dcos(pitch);
  out.x = -dsin(yaw) * cp;
  out.y = dsin(pitch);
  out.z = -dcos(yaw) * cp;
  return out;
}

/** Integer hash to two uniforms in [0, 1), from the shot counter and a spread seed. */
export function spreadSample(shotSeq: number, seed: number): [number, number] {
  let h = Math.imul(shotSeq ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul((seed | 0) + 0x9e37, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  const a = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  let g = Math.imul(h ^ 0x68e31da4, 0x1b873593);
  g = Math.imul(g ^ (g >>> 16), 0x85ebca6b);
  const b = ((g ^ (g >>> 13)) >>> 0) / 4294967296;
  return [a, b];
}

/** Mix a round secret and a player id into a spread seed (server side). */
export function spreadSeed(secret: number, pid: number): number {
  let h = Math.imul(secret ^ 0x2545f491, 0x9e3779b1) ^ Math.imul(pid + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  return (h ^ (h >>> 15)) >>> 0;
}

const PITCH_LIMIT = 1.5607963267948966; // pi/2 - 0.01

/**
 * Final yaw and pitch of a shot: the aim, plus the spray pattern offset
 * (deterministic: learnable and predicted), plus a random point inside the
 * spread cone from `seed`. The server's seed contains a per-round secret the
 * client never sees, so the random part cannot be predicted or cancelled out
 * by a cheat; the client draws its tracer with its own local guess.
 */
export function shotAngles(s: PlayerSim, shot: ShotFired, seed: number): { yaw: number; pitch: number } {
  const w = weaponStats(shot.weapon);
  const p = w.pattern[shot.sprayIndex] ?? [0, 0];
  const [u, v] = spreadSample(shot.shotSeq, seed);
  const r = shot.inaccuracy * Math.sqrt(u);
  const th = 6.283185307179586 * v;
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, s.pitch + p[0] + r * dsin(th)));
  const yaw = s.yaw - p[1] + r * dcos(th);
  return { yaw, pitch };
}

/** World-only ray: distance to the first hit, or `max`. */
function worldRay(sim: SimWorld, o: Vec3Like, d: Vec3Like, max: number): number {
  const ray = new sim.rapier.Ray(o, d);
  const hit = sim.world.castRay(ray, max, true, undefined, PLAYER_QUERY_GROUPS);
  return hit ? hit.timeOfImpact : max;
}

/** Start of the aim ray: the shoulder point, pulled in if a wall is closer. */
export function aimOrigin(sim: SimWorld, s: PlayerSim, side: number, out: Vec3Like): Vec3Like {
  const eyeY = s.y + eyeHeight(s.crouch);
  const rx = dcos(s.yaw) * AIM.shoulderX * side;
  const rz = -dsin(s.yaw) * AIM.shoulderX * side;
  const len = Math.sqrt(rx * rx + AIM.shoulderY * AIM.shoulderY + rz * rz);
  const d = { x: rx / len, y: AIM.shoulderY / len, z: rz / len };
  const free = Math.max(0, worldRay(sim, { x: s.x, y: eyeY, z: s.z }, d, len) - 0.05);
  out.x = s.x + d.x * free;
  out.y = eyeY + d.y * free;
  out.z = s.z + d.z * free;
  return out;
}

/** Gun muzzle in the sim (not the drawn gun), pulled back if it would poke through a wall. */
export function muzzleOf(sim: SimWorld, s: PlayerSim, out: Vec3Like): Vec3Like {
  const fx = -dsin(s.yaw);
  const fz = -dcos(s.yaw);
  const rx = dcos(s.yaw);
  const rz = -dsin(s.yaw);
  const up = s.crouch ? AIM.muzzleUpCrouch : AIM.muzzleUp;
  const chest = { x: s.x, y: s.y + up, z: s.z };
  const tx = rx * AIM.muzzleRight + fx * AIM.muzzleForward;
  const tz = rz * AIM.muzzleRight + fz * AIM.muzzleForward;
  const len = Math.sqrt(tx * tx + tz * tz);
  const d = { x: tx / len, y: 0, z: tz / len };
  const free = Math.max(0, worldRay(sim, chest, d, len) - 0.03);
  out.x = chest.x + d.x * free;
  out.y = chest.y;
  out.z = chest.z + d.z * free;
  return out;
}

export const ShotOutcome = {
  Miss: 0,
  World: 1,
  Body: 2,
  Head: 3,
} as const;

export interface ShotResult {
  outcome: number;
  /** Target id on a body or head hit. */
  targetId: string;
  muzzle: Vec3Like;
  /** Where the tracer ends: the impact point, or the end of range. */
  end: Vec3Like;
  /** Muzzle to impact distance (m), for damage falloff. */
  distance: number;
  /** The camera ray saw a target, but a wall blocked the muzzle. */
  blockedByWall: boolean;
}

function nearestTarget(o: Vec3Like, d: Vec3Like, targets: readonly HitTarget[], maxT: number, skipId: string): { t: number; head: boolean; id: string } | null {
  let best: { t: number; head: boolean; id: string } | null = null;
  for (const tg of targets) {
    if (tg.id === skipId) continue;
    // Broad phase: skip targets far from the ray.
    const cx = tg.x - o.x;
    const cy = tg.y + 0.9 - o.y;
    const cz = tg.z - o.z;
    const along = cx * d.x + cy * d.y + cz * d.z;
    if (along < -1.5 || along > maxT + 1.5) continue;
    const px = cx - d.x * along;
    const py = cy - d.y * along;
    const pz = cz - d.z * along;
    if (px * px + py * py + pz * pz > 2.25) continue;
    const hit = rayHitbox(o.x, o.y, o.z, d.x, d.y, d.z, tg, maxT);
    if (hit && (!best || hit.t < best.t)) best = { t: hit.t, head: hit.head, id: tg.id };
  }
  return best;
}

/**
 * Resolve a fired shot. `targets` are every other player's hitboxes as the
 * shooter saw them (the server passes rewound positions).
 */
export function resolveShot(sim: SimWorld, s: PlayerSim, shooterId: string, side: number, shot: ShotFired, seed: number, targets: readonly HitTarget[]): ShotResult {
  const range = COMBAT.maxRange;
  const { yaw, pitch } = shotAngles(s, shot, seed);
  const dir = directionOf(yaw, pitch, { x: 0, y: 0, z: 0 });

  // 1. Camera ray from the shoulder: the aim point.
  const origin = aimOrigin(sim, s, side, { x: 0, y: 0, z: 0 });
  const wallT = worldRay(sim, origin, dir, range);
  const seen = nearestTarget(origin, dir, targets, wallT, shooterId);
  const aimT = seen ? seen.t : wallT;
  const aim = { x: origin.x + dir.x * aimT, y: origin.y + dir.y * aimT, z: origin.z + dir.z * aimT };

  // 2. Muzzle to aim point.
  const muzzle = muzzleOf(sim, s, { x: 0, y: 0, z: 0 });
  let mx = aim.x - muzzle.x;
  let my = aim.y - muzzle.y;
  let mz = aim.z - muzzle.z;
  const segLen = Math.sqrt(mx * mx + my * my + mz * mz);
  if (segLen < 1e-4) {
    return { outcome: ShotOutcome.Miss, targetId: '', muzzle, end: aim, distance: 0, blockedByWall: false };
  }
  mx /= segLen;
  my /= segLen;
  mz /= segLen;
  const md = { x: mx, y: my, z: mz };
  // Trace a little past the aim point so the target the camera saw is still found.
  const traceLen = seen ? segLen + 0.5 : segLen;
  const wallOnSeg = worldRay(sim, muzzle, md, traceLen);
  const hit = nearestTarget(muzzle, md, targets, Math.min(wallOnSeg, traceLen), shooterId);
  const at = (t: number) => ({ x: muzzle.x + mx * t, y: muzzle.y + my * t, z: muzzle.z + mz * t });

  if (hit) {
    return { outcome: hit.head ? ShotOutcome.Head : ShotOutcome.Body, targetId: hit.id, muzzle, end: at(hit.t), distance: hit.t, blockedByWall: false };
  }
  if (wallOnSeg < segLen - 0.05) {
    return { outcome: ShotOutcome.World, targetId: '', muzzle, end: at(wallOnSeg), distance: wallOnSeg, blockedByWall: seen !== null };
  }
  if (aimT < range) {
    return { outcome: seen ? ShotOutcome.Miss : ShotOutcome.World, targetId: '', muzzle, end: aim, distance: segLen, blockedByWall: false };
  }
  return { outcome: ShotOutcome.Miss, targetId: '', muzzle, end: aim, distance: segLen, blockedByWall: false };
}

