/**
 * Collision groups for the static world and the queries that read it.
 *
 * Every static collider carries membership bits that say what it blocks:
 * - Move: the character controller (players walk into it).
 * - Bullet: hitscan shots.
 * - Sight: line of sight for bots (bushes count: they hide players).
 * - Opaque: solid sight blockers the camera stops at and the server's
 *   anti-wallhack culling trusts (walls, hedges; not bushes, wire or fences).
 *
 * The map's `kinds` table (colliders.json) maps to these bits: `wire` and
 * `fence` block movement only, `hedge` blocks movement and sight but not
 * bullets, `foliage` only hides. Rapier InteractionGroups put the membership
 * in the high 16 bits and the filter in the low 16.
 *
 * - DuckOnly: static colliders that only ducks bump into (Hunt Season's
 *   gate wicket, raid/keep.ts). The duck's movement queries include it;
 *   the hunters' mover and the bot navmesh do not. Never toggled: the
 *   duck sim must see the same colliders on both sides at every tick.
 */
export const CG = {
  Move: 1 << 0,
  Player: 1 << 1,
  Bullet: 1 << 2,
  Sight: 1 << 3,
  Opaque: 1 << 4,
  DuckOnly: 1 << 5,
} as const;

/** A collider that blocks everything (terrain, greybox boxes, walls). */
export const SOLID_BITS = CG.Move | CG.Bullet | CG.Sight | CG.Opaque;

/** Rapier groups for a static collider with these membership bits. */
export function staticGroups(bits: number): number {
  return ((bits & 0xffff) << 16) | 0xffff;
}

/** Rapier groups for a query that acts as a player and hits colliders with any of `filter`. */
export function queryGroups(filter: number): number {
  return (CG.Player << 16) | (filter & 0xffff);
}

/** What blocks movement for everyone (bot and hunter ground probes, wall checks; the navmesh). */
export const MOVE_QUERY_GROUPS = queryGroups(CG.Move);
/** A duck's character controller, ground probes and headroom: also the duck-only colliders. */
export const DUCK_MOVE_QUERY_GROUPS = queryGroups(CG.Move | CG.DuckOnly);
/** Hitscan shots (aim ray and muzzle trace). */
export const BULLET_QUERY_GROUPS = queryGroups(CG.Bullet);
/** Bot line of sight (bushes hide). */
export const SIGHT_QUERY_GROUPS = queryGroups(CG.Sight);
/** Camera arm, aim-origin pull-in and anti-wallhack visibility. */
export const OPAQUE_QUERY_GROUPS = queryGroups(CG.Opaque);

export interface KindFlags {
  move: boolean;
  bullets: boolean;
  sight: boolean;
}

/** Membership bits for a collider kind from the map's `kinds` table. */
export function kindBits(k: KindFlags): number {
  let bits = 0;
  if (k.move) bits |= CG.Move;
  if (k.bullets) bits |= CG.Bullet;
  if (k.sight) bits |= CG.Sight;
  // The camera and the visibility culling trust only solid, walk-blocking sight blockers.
  if (k.sight && k.move) bits |= CG.Opaque;
  return bits;
}
