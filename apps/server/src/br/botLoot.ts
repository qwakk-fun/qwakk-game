/**
 * What a bot wants from the floor, and how much: guns first until armed,
 * then armor upgrades, a bigger backpack, ammo for the guns it has, heals,
 * and only what still fits in its backpack. Closed crates are worth a look
 * (nobody can tell what is inside); an open crate is worth its best content.
 * It only goes for items it can see (a sight ray from its eye), like a player.
 */
import { isArmorUpgrade, Item, LOOT, SIGHT_QUERY_GROUPS, wantsItem, type Armor, type ItemExtra, type PlayerSim, type SimWorld } from '@qwakk/shared';
import type { LootEntity } from './loot.ts';

/** Score for picking up an item of this kind now (0: not interested, or it does not fit). */
export function lootScore(s: PlayerSim, a: Armor, kind: number, extra: ItemExtra = {}): number {
  if (kind !== Item.Crate && !wantsItem(s, a, kind, extra)) return 0;
  const armed = (s.arms & 3) !== 0;
  switch (kind) {
    case Item.Rifle:
      return s.arms & 1 ? (s.res0 < 60 ? 2 : 0) : 10;
    case Item.Pistol:
      return s.arms & 2 ? 0 : armed ? 4 : 9;
    case Item.RifleAmmo:
      return s.arms & 1 ? (s.res0 < 90 ? 6 : s.res0 < LOOT.maxRifleAmmo ? 1.5 : 0) : 1;
    case Item.PistolAmmo:
      return s.arms & 2 ? (s.res1 < 36 ? 4 : s.res1 < LOOT.maxPistolAmmo ? 1 : 0) : 0.5;
    case Item.Vest1:
    case Item.Vest2:
    case Item.Helmet1:
    case Item.Helmet2:
      return isArmorUpgrade(a, kind, extra.dur) ? (kind === Item.Vest2 || kind === Item.Helmet2 ? 7 : 5) : 0;
    case Item.Backpack1:
    case Item.Backpack2:
    case Item.Backpack3:
      return isArmorUpgrade(a, kind) ? 4 + (kind - Item.Backpack1) : 0;
    case Item.Bandage:
      return s.bandages < 5 ? 3 : s.bandages < LOOT.maxBandages ? 1 : 0;
    case Item.Medkit:
      return s.medkits < LOOT.maxMedkits ? 4 : 0;
    default:
      return 0;
  }
}

/** Score for an item in the world: a crate by what a duck looking at it can tell. */
export function entityScore(s: PlayerSim, a: Armor, e: LootEntity): number {
  if (e.kind !== Item.Crate) return lootScore(s, a, e.kind, e.extra ?? {});
  if (!e.open) return 5;
  let best = 0;
  for (const c of e.contents ?? []) best = Math.max(best, lootScore(s, a, c.kind, c));
  return best;
}

/** Fully geared: armed with ammo, some armor and heals. Geared bots stop detouring for loot. */
export function geared(s: PlayerSim, a: Armor): boolean {
  return (s.arms & 1) !== 0 && s.res0 >= 60 && a.vest > 0 && s.bandages + s.medkits >= 3;
}

export function sees(sim: SimWorld, s: PlayerSim, e: LootEntity): boolean {
  const ey = s.y + 1.5;
  const dx = e.x - s.x;
  const dy = e.y + 0.2 - ey;
  const dz = e.z - s.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.1) return true;
  const hit = sim.world.castRay(new sim.rapier.Ray({ x: s.x, y: ey, z: s.z }, { x: dx / d, y: dy / d, z: dz / d }), d, true, undefined, SIGHT_QUERY_GROUPS);
  return !hit || hit.timeOfImpact > d - 0.3;
}

/** The best visible item within `radius`, weighed by score and distance. */
export function pickItem(sim: SimWorld, s: PlayerSim, a: Armor, items: readonly LootEntity[], radius: number, skip: ReadonlySet<string>): LootEntity | null {
  const scored: { e: LootEntity; v: number }[] = [];
  for (const e of items) {
    if (skip.has(e.id)) continue;
    const sc = entityScore(s, a, e);
    if (sc <= 0) continue;
    const d = Math.hypot(e.x - s.x, e.z - s.z);
    if (d > radius || Math.abs(e.y - s.y) > 7) continue;
    scored.push({ e, v: sc / (1 + d / 8) });
  }
  scored.sort((p, q) => q.v - p.v);
  // Sight rays only for the few best.
  for (let i = 0; i < Math.min(5, scored.length); i++) {
    const c = scored[i]!;
    if (Math.hypot(c.e.x - s.x, c.e.z - s.z) < 2.5 || sees(sim, s, c.e)) return c.e;
  }
  return null;
}
