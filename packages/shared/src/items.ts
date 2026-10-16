/**
 * Battle royale items: kinds, loot tables and armor math. Pure and
 * deterministic; the server owns every inventory change (pickups, drops,
 * damage on armor). Tunable numbers live in LOOT, PACK and ARMOR below, with
 * the heal numbers in constants.ts (HEAL), because heals are part of the sim.
 * The inventory rules (capacity, pickups, drops) are in inventory.ts.
 */
import { createRng } from './rng.ts';
import { dcos, dsin } from './math.ts';
import type { LootPoint } from './brMapData.ts';
import { Container } from './brMapData.ts';

export const Item = {
  Rifle: 1,
  Pistol: 2,
  RifleAmmo: 3,
  PistolAmmo: 4,
  Vest1: 5,
  Vest2: 6,
  Helmet1: 7,
  Helmet2: 8,
  Bandage: 9,
  Medkit: 10,
  /**
   * A crate: a dead duck's drop, or a loot crate of the map (an ammo box
   * included) that opens with the Use button. Server side contents.
   */
  Crate: 11,
  /** Backpacks: more carrying capacity per level (PACK.capacity). */
  Backpack1: 12,
  Backpack2: 13,
  Backpack3: 14,
} as const;
export type ItemKind = (typeof Item)[keyof typeof Item];

export interface ItemInfo {
  name: string;
  /** Amount in one stack when it spawns. */
  stack: number;
}

export const ITEM_INFO: Record<number, ItemInfo> = {
  [Item.Rifle]: { name: 'Rifle', stack: 1 },
  [Item.Pistol]: { name: 'Pistol', stack: 1 },
  [Item.RifleAmmo]: { name: 'Rifle ammo', stack: 30 },
  [Item.PistolAmmo]: { name: 'Pistol ammo', stack: 24 },
  [Item.Vest1]: { name: 'Vest (level 1)', stack: 1 },
  [Item.Vest2]: { name: 'Vest (level 2)', stack: 1 },
  [Item.Helmet1]: { name: 'Helmet (level 1)', stack: 1 },
  [Item.Helmet2]: { name: 'Helmet (level 2)', stack: 1 },
  [Item.Bandage]: { name: 'Bandage', stack: 2 },
  [Item.Medkit]: { name: 'Medkit', stack: 1 },
  [Item.Crate]: { name: 'Loot crate', stack: 1 },
  [Item.Backpack1]: { name: 'Backpack (level 1)', stack: 1 },
  [Item.Backpack2]: { name: 'Backpack (level 2)', stack: 1 },
  [Item.Backpack3]: { name: 'Backpack (level 3)', stack: 1 },
};

export function itemName(kind: number): string {
  return ITEM_INFO[kind]?.name ?? 'Item';
}

export const ARMOR = {
  /** Share of body damage a vest absorbs, by level (index 0 = none). */
  vestReduce: [0, 0.3, 0.4],
  /** Share of head damage a helmet absorbs. */
  helmetReduce: [0, 0.3, 0.4],
  /** Durability when picked up new. */
  vestDurability: [0, 100, 150],
  helmetDurability: [0, 80, 120],
  /** Durability lost per point of raw damage the piece takes. */
  wearPerDamage: 0.75,
} as const;

export const LOOT = {
  /** Chance a floor loot point holds something this match. */
  spawnChance: 0.7,
  /** Containers always hold something. */
  containerChance: 1,
  /** Weapons come with this many ammo stacks next to them. */
  ammoWithWeapon: 1,
  /** Reserve ammo caps (the schema stores them as uint8). */
  maxRifleAmmo: 180,
  maxPistolAmmo: 96,
  maxBandages: 10,
  maxMedkits: 3,
  /** Pick-up reach from the duck's chest (m). */
  reach: 2.6,
  /** Items in a map crate: small, large (one tier better) and ammo box. */
  smallCrateItems: 2,
  largeCrateItems: 3,
  ammoBoxItems: 2,
  /** A crate's lid swings open for this long before its contents can be taken (ticks). */
  crateOpenTicks: 9,
  /** Inventory requests (drop, take) a duck may make per second (server rate limit). */
  invOpsPerSecond: 8,
} as const;

/**
 * Carrying capacity (PUBG style weight). Ammo and heals in the backpack
 * weigh something; the two guns in their slots, worn armor and the backpack
 * itself weigh nothing. Weights are multiples of 0.25 so sums stay exact.
 */
export const PACK = {
  /** Capacity by backpack level (index 0: no backpack). */
  capacity: [50, 90, 130, 170],
  /** Weight of one unit, by item kind. */
  weight: {
    [Item.RifleAmmo]: 0.5,
    [Item.PistolAmmo]: 0.25,
    [Item.Bandage]: 2,
    [Item.Medkit]: 6,
  } as Readonly<Record<number, number>>,
} as const;

/** Item weights per tier (1 to 4): [kind, weight]. */
const TABLES: Record<number, readonly (readonly [number, number])[]> = {
  1: [[Item.Pistol, 14], [Item.Rifle, 6], [Item.PistolAmmo, 18], [Item.RifleAmmo, 14], [Item.Vest1, 8], [Item.Helmet1, 8], [Item.Vest2, 1], [Item.Helmet2, 1], [Item.Bandage, 22], [Item.Medkit, 3], [Item.Backpack1, 6], [Item.Backpack2, 1]],
  2: [[Item.Pistol, 11], [Item.Rifle, 12], [Item.PistolAmmo, 13], [Item.RifleAmmo, 18], [Item.Vest1, 9], [Item.Helmet1, 9], [Item.Vest2, 3], [Item.Helmet2, 3], [Item.Bandage, 16], [Item.Medkit, 5], [Item.Backpack1, 5], [Item.Backpack2, 3], [Item.Backpack3, 0.5]],
  3: [[Item.Pistol, 7], [Item.Rifle, 17], [Item.PistolAmmo, 9], [Item.RifleAmmo, 20], [Item.Vest1, 7], [Item.Helmet1, 7], [Item.Vest2, 7], [Item.Helmet2, 7], [Item.Bandage, 12], [Item.Medkit, 7], [Item.Backpack1, 3], [Item.Backpack2, 4], [Item.Backpack3, 1.5]],
  4: [[Item.Rifle, 18], [Item.RifleAmmo, 18], [Item.Vest2, 14], [Item.Helmet2, 14], [Item.Medkit, 14], [Item.Bandage, 8], [Item.Pistol, 4], [Item.PistolAmmo, 6], [Item.Backpack2, 4], [Item.Backpack3, 4]],
};
const AMMO_TABLE: readonly (readonly [number, number])[] = [[Item.RifleAmmo, 3], [Item.PistolAmmo, 2]];

function pick(table: readonly (readonly [number, number])[], u: number): number {
  let total = 0;
  for (const [, w] of table) total += w;
  let x = u * total;
  for (const [k, w] of table) {
    x -= w;
    if (x < 0) return k;
  }
  return (table[table.length - 1] as readonly [number, number])[0];
}

export interface SpawnedItem {
  kind: number;
  amount: number;
  x: number;
  y: number;
  z: number;
  /** The loot point it was rolled for. */
  point: number;
  /** Container.* of that point: items with a container go inside its crate. */
  box: number;
}

/** Ammo that fits a weapon kind. */
export function ammoFor(weaponItem: number): number {
  return weaponItem === Item.Rifle ? Item.RifleAmmo : Item.PistolAmmo;
}

/**
 * Roll the loot for a match from the map's loot points and the match seed.
 * Deterministic: the same seed gives the same items. Server only (clients
 * just see the result), so the seed never needs to reach a client.
 */
export function rollLoot(points: readonly LootPoint[], seed: number): SpawnedItem[] {
  const out: SpawnedItem[] = [];
  for (const p of points) {
    const rng = createRng((Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(p.id + 1, 0x85ebca6b)) >>> 0);
    const container = p.container !== Container.None;
    if (rng() >= (container ? LOOT.containerChance : LOOT.spawnChance)) continue;
    const tier = Math.min(4, p.tier + (p.container === Container.Large ? 1 : 0));
    const count = p.container === Container.Large ? LOOT.largeCrateItems : p.container === Container.Small ? LOOT.smallCrateItems : p.container === Container.Ammo ? LOOT.ammoBoxItems : 1;
    const box = p.container;
    for (let i = 0; i < count; i++) {
      const kind = p.container === Container.Ammo ? pick(AMMO_TABLE, rng()) : pick(TABLES[tier] ?? (TABLES[1] as never), rng());
      // Small offsets so stacks on one point do not overlap.
      const ox = i === 0 ? 0 : (rng() - 0.5) * 0.6;
      const oz = i === 0 ? 0 : (rng() - 0.5) * 0.6;
      out.push({ kind, amount: (ITEM_INFO[kind] as ItemInfo).stack, x: p.x + ox, y: p.y, z: p.z + oz, point: p.id, box });
      // A gun comes with ammo: next to it on the floor, in the same crate in a container.
      if (kind === Item.Rifle || kind === Item.Pistol) {
        for (let a = 0; a < LOOT.ammoWithWeapon; a++) {
          const ammo = ammoFor(kind);
          const ang = rng() * 6.283185307179586;
          out.push({ kind: ammo, amount: (ITEM_INFO[ammo] as ItemInfo).stack, x: p.x + dcos(ang) * 0.5, y: p.y, z: p.z + dsin(ang) * 0.5, point: p.id, box });
        }
      }
    }
  }
  return out;
}

/** Gear a duck wears (server side; levels are public, durability owner-only). */
export interface Armor {
  vest: number;
  vestDur: number;
  helmet: number;
  helmetDur: number;
  /** Backpack level (0: none). Left out means none. */
  pack?: number;
}

/**
 * Damage after armor. Body hits go through the vest, head hits through the
 * helmet; the piece loses durability and breaks at 0. Mutates `a`.
 */
export function absorbDamage(a: Armor, raw: number, head: boolean): number {
  const level = head ? a.helmet : a.vest;
  if (level <= 0) return raw;
  const reduce = (head ? ARMOR.helmetReduce : ARMOR.vestReduce)[level] ?? 0;
  const dealt = Math.max(1, Math.round(raw * (1 - reduce)));
  const wear = raw * ARMOR.wearPerDamage;
  if (head) {
    a.helmetDur = Math.max(0, a.helmetDur - wear);
    if (a.helmetDur <= 0) a.helmet = 0;
  } else {
    a.vestDur = Math.max(0, a.vestDur - wear);
    if (a.vestDur <= 0) a.vest = 0;
  }
  return dealt;
}

/** What a dropped item carries: a gun's magazine, a used armor piece's durability. */
export interface ItemExtra {
  mag?: number;
  dur?: number;
}

export interface PickupCandidate {
  id: string;
  x: number;
  y: number;
  z: number;
}

/**
 * The item a duck at (x, y, z) looking along (dx, dy, dz) would pick up: in
 * reach of its chest, preferring what is near the crosshair, then what is
 * close. Line of sight is checked by the caller. Shared so the client's
 * prompt names the same item the server will hand over.
 */
export function choosePickup<T extends PickupCandidate>(items: Iterable<T>, x: number, y: number, z: number, dx: number, dy: number, dz: number, reach: number = LOOT.reach): T | null {
  const cy = y + 0.9;
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const it of items) {
    const ox = it.x - x;
    const oy = it.y + 0.15 - cy;
    const oz = it.z - z;
    const d = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (d > reach) continue;
    const facing = d > 1e-3 ? (ox * dx + oy * dy + oz * dz) / d : 1;
    const score = facing * 2 - d / reach;
    if (score > bestScore) {
      bestScore = score;
      best = it;
    }
  }
  return best;
}

/** One thing in a crate. */
export interface DropItem extends ItemExtra {
  kind: number;
  amount: number;
}
