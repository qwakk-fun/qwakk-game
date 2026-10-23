/**
 * A hunter's shot: from its muzzle (pulled back if a wall is closer), along
 * the aim plus a random spread per pellet, against the world
 * (BULLET_QUERY_GROUPS: a wall stops it) and the standing ducks' hitboxes at
 * their current positions (hunters never rewind, like bots). Server only, so
 * Math.random is fine: the spread cannot be predicted by anyone.
 */
import { BULLET_QUERY_GROUPS, directionOf, HUNTER_MUZZLE, rayHitbox, type HunterKindId, type SimWorld, type Vec3Like } from '@qwakk/shared';
import type { GunNumbers, HunterAgent } from './hunter.ts';
import type { DuckTarget } from './sight.ts';

export interface PelletHit {
  duck: DuckTarget;
  damage: number;
  head: boolean;
}

export interface ShotTrace {
  from: Vec3Like;
  to: Vec3Like;
  /** ShotOutcome-like: 0 miss, 1 world, 2 body, 3 head. */
  outcome: number;
}

/** The muzzle in the world, pulled back from a wall in front of it. */
export function hunterMuzzle(sim: SimWorld, h: HunterAgent): Vec3Like {
  const [f, up] = HUNTER_MUZZLE[h.kind as HunterKindId] ?? [0.8, 1.35];
  const fx = -Math.sin(h.yaw);
  const fz = -Math.cos(h.yaw);
  const chest = { x: h.x, y: h.y + up, z: h.z };
  const hit = sim.world.castRay(new sim.rapier.Ray(chest, { x: fx, y: 0, z: fz }), f, true, undefined, BULLET_QUERY_GROUPS);
  const free = Math.max(0, (hit ? hit.timeOfImpact : f) - 0.05);
  return { x: chest.x + fx * free, y: chest.y, z: chest.z + fz * free };
}

/** Damage scale at a distance (full to `near`, down to `minScale` at `far`, none past `range`). */
export function falloff(g: GunNumbers, d: number): number {
  if (d > g.range) return 0;
  if (d <= g.near) return 1;
  if (d >= g.far) return g.minScale;
  return 1 - (1 - g.minScale) * ((d - g.near) / (g.far - g.near));
}

/**
 * Fire one shot (all its pellets) along (yaw, pitch). `ducks` are every duck;
 * only standing ones can be hit (a knocked duck is left for its friends).
 * Returns the hits and the tracers.
 */
export function fireHunterGun(sim: SimWorld, h: HunterAgent, g: GunNumbers, yaw: number, pitch: number, spread: number, damageScale: number, ducks: readonly DuckTarget[]): { hits: PelletHit[]; traces: ShotTrace[] } {
  const from = hunterMuzzle(sim, h);
  const hits: PelletHit[] = [];
  const traces: ShotTrace[] = [];
  const dir = { x: 0, y: 0, z: 0 };
  for (let p = 0; p < g.pellets; p++) {
    const r = (g.cone + spread) * Math.sqrt(Math.random());
    const th = Math.random() * Math.PI * 2;
    directionOf(yaw + r * Math.cos(th), pitch + r * Math.sin(th), dir);
    const wall = sim.world.castRay(new sim.rapier.Ray(from, dir), g.range, true, undefined, BULLET_QUERY_GROUPS);
    const wallT = wall ? wall.timeOfImpact : g.range;
    let best: { duck: DuckTarget; t: number; head: boolean } | null = null;
    for (const d of ducks) {
      if (!d.standing) continue;
      const hit = rayHitbox(from.x, from.y, from.z, dir.x, dir.y, dir.z, { id: d.id, x: d.x, y: d.y, z: d.z, crouch: d.crouch }, wallT);
      if (hit && (!best || hit.t < best.t)) best = { duck: d, t: hit.t, head: hit.head };
    }
    const t = best ? best.t : wallT;
    const to = { x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t };
    traces.push({ from, to, outcome: best ? (best.head ? 3 : 2) : wall ? 1 : 0 });
    if (!best) continue;
    const dmg = g.damage * (best.head ? g.headMult : 1) * falloff(g, best.t) * damageScale;
    if (dmg > 0) hits.push({ duck: best.duck, damage: dmg, head: best.head });
  }
  return { hits, traces };
}
