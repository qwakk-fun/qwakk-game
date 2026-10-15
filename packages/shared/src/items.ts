/**
 * Battle royale items: kinds, loot tables, armor math and inventory rules.
 * Pure and deterministic; the server owns every inventory change (pickups,
 * damage on armor). Tunable numbers live in LOOT and ARMOR below, with the
 * heal numbers in constants.ts (HEAL), because heals are part of the sim.
 */
import { createRng } from './rng.ts';
import { dcos, dsin } from './math.ts';
import type { LootPoint } from './brMapData.ts';
import { Container } from './brMapData.ts';
import type { PlayerSim } from './sim.ts';
import { WeaponId, weaponStats } from './weapons.ts';

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
  /** A death crate: holds a dead duck's loot (server side contents). */
  Crate: 11,
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
} as const;

/** Item weights per tier (1 to 4): [kind, weight]. */
const TABLES: Record<number, readonly (readonly [number, number])[]> = {
  1: [[Item.Pistol, 14], [Item.Rifle, 6], [Item.PistolAmmo, 18], [Item.RifleAmmo, 14], [Item.Vest1, 8], [Item.Helmet1, 8], [Item.Vest2, 1], [Item.Helmet2, 1], [Item.Bandage, 22], [Item.Medkit, 3]],
  2: [[Item.Pistol, 11], [Item.Rifle, 12], [Item.PistolAmmo, 13], [Item.RifleAmmo, 18], [Item.Vest1, 9], [Item.Helmet1, 9], [Item.Vest2, 3], [Item.Helmet2, 3], [Item.Bandage, 16], [Item.Medkit, 5]],
  3: [[Item.Pistol, 7], [Item.Rifle, 17], [Item.PistolAmmo, 9], [Item.RifleAmmo, 20], [Item.Vest1, 7], [Item.Helmet1, 7], [Item.Vest2, 7], [Item.Helmet2, 7], [Item.Bandage, 12], [Item.Medkit, 7]],
  4: [[Item.Rifle, 18], [Item.RifleAmmo, 18], [Item.Vest2, 14], [Item.Helmet2, 14], [Item.Medkit, 14], [Item.Bandage, 8], [Item.Pistol, 4], [Item.PistolAmmo, 6]],
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
    const count = p.container === Container.Large ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const kind = p.container === Container.Ammo ? pick(AMMO_TABLE, rng()) : pick(TABLES[tier] ?? (TABLES[1] as never), rng());
      // Small offsets so stacks on one point do not overlap.
      const ox = i === 0 ? 0 : (rng() - 0.5) * 0.6;
      const oz = i === 0 ? 0 : (rng() - 0.5) * 0.6;
      out.push({ kind, amount: (ITEM_INFO[kind] as ItemInfo).stack, x: p.x + ox, y: p.y, z: p.z + oz });
      if ((kind === Item.Rifle || kind === Item.Pistol) && !container) {
        for (let a = 0; a < LOOT.ammoWithWeapon; a++) {
          const ammo = ammoFor(kind);
          const ang = rng() * 6.283185307179586;
          out.push({ kind: ammo, amount: (ITEM_INFO[ammo] as ItemInfo).stack, x: p.x + dcos(ang) * 0.5, y: p.y, z: p.z + dsin(ang) * 0.5 });
        }
      }
    }
  }
  return out;
}

/** Armor a duck wears (server side; levels are public, durability owner-only). */
export interface Armor {
  vest: number;
  vestDur: number;
  helmet: number;
  helmetDur: number;
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

/** Is this vest or helmet (with `dur` left, default new) an upgrade over what is worn? (Higher level, or same level with more durability.) */
export function isArmorUpgrade(a: Armor, kind: number, dur?: number): boolean {
  if (kind === Item.Vest1 || kind === Item.Vest2) {
    const lvl = kind === Item.Vest1 ? 1 : 2;
    const d = dur ?? ARMOR.vestDurability[lvl] ?? 0;
    return lvl > a.vest || (lvl === a.vest && d > a.vestDur + 1);
  }
  if (kind === Item.Helmet1 || kind === Item.Helmet2) {
    const lvl = kind === Item.Helmet1 ? 1 : 2;
    const d = dur ?? ARMOR.helmetDurability[lvl] ?? 0;
    return lvl > a.helmet || (lvl === a.helmet && d > a.helmetDur + 1);
  }
  return false;
}

/**
 * Put up to `amount` of an item into the inventory. Returns how much was
 * taken (0: nothing fits, the item stays where it is). Server only: the
 * owner sees the result through its state. Rules:
 * - A gun you do not have: equip it with a full magazine (straight away if
 *   you are unarmed). A gun you already have: its magazine becomes reserve ammo.
 * - Ammo and heals: up to their caps. Armor: only an upgrade, replacing the old piece.
 */
export function applyPickup(s: PlayerSim, a: Armor, kind: number, amount: number, extra: ItemExtra = {}): number {
  if (kind === Item.Rifle || kind === Item.Pistol) {
    const w = kind === Item.Rifle ? WeaponId.Rifle : WeaponId.Pistol;
    const stats = weaponStats(w);
    const bit = 1 << w;
    // A dropped gun carries the rounds it had; a gun found in the world comes loaded.
    const loaded = Math.max(0, Math.min(stats.magSize, extra.mag ?? stats.magSize));
    if (s.arms & bit) {
      const room = (w === WeaponId.Rifle ? LOOT.maxRifleAmmo - s.res0 : LOOT.maxPistolAmmo - s.res1);
      if (room <= 0 || loaded === 0) return loaded === 0 ? amount : 0;
      const add = Math.min(room, loaded);
      if (w === WeaponId.Rifle) s.res0 += add;
      else s.res1 += add;
      return amount;
    }
    const wasArmed = (s.arms >> s.weapon) & 1;
    s.arms |= bit;
    if (w === WeaponId.Rifle) s.mag0 = loaded;
    else s.mag1 = loaded;
    if (!wasArmed) {
      s.weapon = w;
      s.equip = stats.equipTicks;
      s.reload = 0;
      s.spray = 0;
      s.cooldown = 0;
    }
    return amount;
  }
  if (kind === Item.RifleAmmo || kind === Item.PistolAmmo) {
    const rifle = kind === Item.RifleAmmo;
    const room = rifle ? LOOT.maxRifleAmmo - s.res0 : LOOT.maxPistolAmmo - s.res1;
    const take = Math.max(0, Math.min(room, amount));
    if (rifle) s.res0 += take;
    else s.res1 += take;
    return take;
  }
  if (kind === Item.Bandage || kind === Item.Medkit) {
    const band = kind === Item.Bandage;
    const take = Math.max(0, Math.min(band ? LOOT.maxBandages - s.bandages : LOOT.maxMedkits - s.medkits, amount));
    if (band) s.bandages += take;
    else s.medkits += take;
    return take;
  }
  if (kind === Item.Vest1 || kind === Item.Vest2 || kind === Item.Helmet1 || kind === Item.Helmet2) {
    if (!isArmorUpgrade(a, kind, extra.dur)) return 0;
    if (kind === Item.Vest1 || kind === Item.Vest2) {
      a.vest = kind === Item.Vest1 ? 1 : 2;
      a.vestDur = extra.dur ?? ARMOR.vestDurability[a.vest] ?? 0;
    } else {
      a.helmet = kind === Item.Helmet1 ? 1 : 2;
      a.helmetDur = extra.dur ?? ARMOR.helmetDurability[a.helmet] ?? 0;
    }
    return amount;
  }
  return 0;
}

/** Would any of this item fit right now (for the pickup prompt and bots)? */
export function wantsItem(s: PlayerSim, a: Armor, kind: number): boolean {
  switch (kind) {
    case Item.Rifle:
      return !(s.arms & 1) || s.res0 < LOOT.maxRifleAmmo;
    case Item.Pistol:
      return !(s.arms & 2) || s.res1 < LOOT.maxPistolAmmo;
    case Item.RifleAmmo:
      return s.res0 < LOOT.maxRifleAmmo;
    case Item.PistolAmmo:
      return s.res1 < LOOT.maxPistolAmmo;
    case Item.Bandage:
      return s.bandages < LOOT.maxBandages;
    case Item.Medkit:
      return s.medkits < LOOT.maxMedkits;
    case Item.Crate:
      return true;
    default:
      return isArmorUpgrade(a, kind);
  }
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

/** What a dead duck drops: its guns with the rounds in them, its reserve ammo, its armor as worn, its heals. Nothing is created. */
export function dropsOf(s: PlayerSim, a: Armor): DropItem[] {
  const out: DropItem[] = [];
  if (s.arms & 1) out.push({ kind: Item.Rifle, amount: 1, mag: s.mag0 });
  if (s.arms & 2) out.push({ kind: Item.Pistol, amount: 1, mag: s.mag1 });
  if (s.res0 > 0) out.push({ kind: Item.RifleAmmo, amount: s.res0 });
  if (s.res1 > 0) out.push({ kind: Item.PistolAmmo, amount: s.res1 });
  if (a.vest > 0) out.push({ kind: a.vest === 1 ? Item.Vest1 : Item.Vest2, amount: 1, dur: a.vestDur });
  if (a.helmet > 0) out.push({ kind: a.helmet === 1 ? Item.Helmet1 : Item.Helmet2, amount: 1, dur: a.helmetDur });
  if (s.bandages > 0) out.push({ kind: Item.Bandage, amount: s.bandages });
  if (s.medkits > 0) out.push({ kind: Item.Medkit, amount: s.medkits });
  return out;
}
