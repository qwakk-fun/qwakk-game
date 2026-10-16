/**
 * Inventory rules for the battle royale: carrying capacity (PACK), what a
 * pickup takes, why one is refused, and what a drop gives back. Pure and
 * deterministic; the server owns every change (the client uses the same
 * functions to label the pickup prompt and the inventory screen).
 *
 * Model: the two guns sit in their slots and worn armor and the backpack are
 * worn, so they weigh nothing. Ammo and heals go into the backpack: each unit
 * weighs PACK.weight[kind], and the total may not pass PACK.capacity for the
 * backpack level worn. The per-kind caps in LOOT still apply on top.
 */
import { ARMOR, Item, LOOT, PACK, type Armor, type DropItem, type ItemExtra } from './items.ts';
import type { PlayerSim } from './sim.ts';
import { WeaponId, weaponStats } from './weapons.ts';

/** Why a pickup or a drop did nothing (sent to the client as Msg.Denied). */
export const Deny = {
  None: 0,
  /** No room left in the backpack (capacity). */
  Full: 1,
  /** Carrying the most of this item already (LOOT caps). */
  Max: 2,
  /** The armor or backpack worn is as good or better. */
  Worse: 3,
  /** The crate is still opening. */
  Opening: 4,
  /** The backpack cannot come off: what you carry would not fit without it. */
  TooHeavy: 5,
  /** Nothing of that to drop or take. */
  Empty: 6,
} as const;

/** Weight of one unit of an item kind (0: weighs nothing). */
export function weightOf(kind: number): number {
  return PACK.weight[kind] ?? 0;
}

/** Total weight carried in the backpack. */
export function loadOf(s: PlayerSim): number {
  return s.res0 * weightOf(Item.RifleAmmo) + s.res1 * weightOf(Item.PistolAmmo) + s.bandages * weightOf(Item.Bandage) + s.medkits * weightOf(Item.Medkit);
}

/** Carrying capacity for the backpack worn. */
export function capacityOf(a: Armor): number {
  return PACK.capacity[a.pack ?? 0] ?? PACK.capacity[0] ?? 0;
}

export function backpackLevel(kind: number): number {
  return kind === Item.Backpack1 ? 1 : kind === Item.Backpack2 ? 2 : kind === Item.Backpack3 ? 3 : 0;
}

export function backpackItem(level: number): number {
  return level === 1 ? Item.Backpack1 : level === 2 ? Item.Backpack2 : Item.Backpack3;
}

export function vestItem(level: number): number {
  return level === 1 ? Item.Vest1 : Item.Vest2;
}

export function helmetItem(level: number): number {
  return level === 1 ? Item.Helmet1 : Item.Helmet2;
}

/** Ammo and heals: the kinds that go into the backpack. */
export function isStack(kind: number): boolean {
  return weightOf(kind) > 0;
}

/** Units of a stack kind that still fit by weight (0 when the backpack is full). */
export function spaceFor(s: PlayerSim, a: Armor, kind: number): number {
  const w = weightOf(kind);
  if (w <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((capacityOf(a) - loadOf(s)) / w + 1e-9));
}

/** Units of a stack kind left under its LOOT cap. */
function capRoom(s: PlayerSim, kind: number): number {
  switch (kind) {
    case Item.RifleAmmo:
      return LOOT.maxRifleAmmo - s.res0;
    case Item.PistolAmmo:
      return LOOT.maxPistolAmmo - s.res1;
    case Item.Bandage:
      return LOOT.maxBandages - s.bandages;
    case Item.Medkit:
      return LOOT.maxMedkits - s.medkits;
    default:
      return 0;
  }
}

/** Units of a stack kind a pickup can take now: the smaller of the cap and the space. */
export function roomFor(s: PlayerSim, a: Armor, kind: number): number {
  return Math.max(0, Math.min(capRoom(s, kind), spaceFor(s, a, kind)));
}

/**
 * Is this vest, helmet or backpack an upgrade over what is worn? Armor: a
 * higher level, or the same level with more durability (`dur`, default new).
 * Backpack: a higher level.
 */
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
  const pack = backpackLevel(kind);
  if (pack > 0) return pack > (a.pack ?? 0);
  return false;
}

/** Ammo that a gun item's magazine adds to when you already own that gun. */
function gunAmmo(kind: number): number {
  return kind === Item.Rifle ? Item.RifleAmmo : Item.PistolAmmo;
}

/**
 * Why a pickup of this item would take nothing (Deny.None: some of it fits).
 * The server sends the reason; the client labels its prompt with it.
 */
export function pickupBlock(s: PlayerSim, a: Armor, kind: number, extra: ItemExtra = {}): number {
  if (kind === Item.Rifle || kind === Item.Pistol) {
    const w = kind === Item.Rifle ? WeaponId.Rifle : WeaponId.Pistol;
    if (!(s.arms & (1 << w))) return Deny.None;
    const loaded = extra.mag ?? weaponStats(w).magSize;
    if (loaded <= 0) return Deny.None;
    if (capRoom(s, gunAmmo(kind)) <= 0) return Deny.Max;
    return spaceFor(s, a, gunAmmo(kind)) > 0 ? Deny.None : Deny.Full;
  }
  if (isStack(kind)) {
    if (capRoom(s, kind) <= 0) return Deny.Max;
    return spaceFor(s, a, kind) > 0 ? Deny.None : Deny.Full;
  }
  if (kind === Item.Crate) return Deny.None;
  return isArmorUpgrade(a, kind, extra.dur) ? Deny.None : Deny.Worse;
}

/** Would any of this item fit right now (for the pickup prompt and bots)? */
export function wantsItem(s: PlayerSim, a: Armor, kind: number, extra: ItemExtra = {}): boolean {
  return pickupBlock(s, a, kind, extra) === Deny.None;
}

/**
 * Put up to `amount` of an item into the inventory. Returns how much was
 * taken (0: nothing fits, the item stays where it is). Server only: the
 * owner sees the result through its state. Rules:
 * - A gun you do not have: equip it with a full magazine (straight away if
 *   you are unarmed). A gun you already have: its magazine becomes reserve
 *   ammo, as far as it fits (the empty gun is left behind).
 * - Ammo and heals: up to their caps and the backpack's capacity.
 * - Armor and backpacks: only an upgrade, replacing the old piece (the caller
 *   drops the old one on the ground).
 */
export function applyPickup(s: PlayerSim, a: Armor, kind: number, amount: number, extra: ItemExtra = {}): number {
  if (kind === Item.Rifle || kind === Item.Pistol) {
    const w = kind === Item.Rifle ? WeaponId.Rifle : WeaponId.Pistol;
    const stats = weaponStats(w);
    const bit = 1 << w;
    // A dropped gun carries the rounds it had; a gun found in the world comes loaded.
    const loaded = Math.max(0, Math.min(stats.magSize, extra.mag ?? stats.magSize));
    if (s.arms & bit) {
      if (loaded === 0) return amount;
      const room = roomFor(s, a, gunAmmo(kind));
      if (room <= 0) return 0;
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
  if (isStack(kind)) {
    const take = Math.max(0, Math.min(roomFor(s, a, kind), amount));
    if (kind === Item.RifleAmmo) s.res0 += take;
    else if (kind === Item.PistolAmmo) s.res1 += take;
    else if (kind === Item.Bandage) s.bandages += take;
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
  const pack = backpackLevel(kind);
  if (pack > 0) {
    if (pack <= (a.pack ?? 0)) return 0;
    a.pack = pack;
    return amount;
  }
  return 0;
}

/** The worn pieces an upgrade pickup of `kind` would replace (to drop them on the ground). */
export function replacedBy(a: Armor, kind: number): DropItem | null {
  if ((kind === Item.Vest1 || kind === Item.Vest2) && a.vest > 0) return { kind: vestItem(a.vest), amount: 1, dur: a.vestDur };
  if ((kind === Item.Helmet1 || kind === Item.Helmet2) && a.helmet > 0) return { kind: helmetItem(a.helmet), amount: 1, dur: a.helmetDur };
  if (backpackLevel(kind) > 0 && (a.pack ?? 0) > 0) return { kind: backpackItem(a.pack ?? 0), amount: 1 };
  return null;
}

/**
 * Take an item out of the inventory to drop it on the ground: a stack (up to
 * `amount`), a gun with the rounds in its magazine, a worn armor piece with
 * its durability, or the backpack (only when what you carry fits without
 * it). Mutates the duck; returns what to put on the ground, or why not.
 */
export function takeOut(s: PlayerSim, a: Armor, kind: number, amount: number): { item: DropItem | null; deny: number } {
  const none = (deny: number) => ({ item: null, deny });
  if (isStack(kind)) {
    const have = kind === Item.RifleAmmo ? s.res0 : kind === Item.PistolAmmo ? s.res1 : kind === Item.Bandage ? s.bandages : s.medkits;
    const n = Math.min(have, Math.max(0, Math.floor(amount)));
    if (n <= 0) return none(Deny.Empty);
    if (kind === Item.RifleAmmo) s.res0 -= n;
    else if (kind === Item.PistolAmmo) s.res1 -= n;
    else if (kind === Item.Bandage) s.bandages -= n;
    else s.medkits -= n;
    // Dropping the last of the heal in progress stops it.
    const left = kind === Item.Bandage ? s.bandages : kind === Item.Medkit ? s.medkits : 1;
    if (left === 0 && s.heal > 0 && s.healKind === (kind === Item.Bandage ? 1 : 2)) {
      s.heal = 0;
      s.healKind = 0;
    }
    return { item: { kind, amount: n }, deny: Deny.None };
  }
  if (kind === Item.Rifle || kind === Item.Pistol) {
    const w = kind === Item.Rifle ? WeaponId.Rifle : WeaponId.Pistol;
    if (!(s.arms & (1 << w))) return none(Deny.Empty);
    const mag = w === WeaponId.Rifle ? s.mag0 : s.mag1;
    s.arms &= ~(1 << w);
    if (w === WeaponId.Rifle) s.mag0 = 0;
    else s.mag1 = 0;
    if (s.weapon === w) {
      s.reload = 0;
      s.spray = 0;
      s.cooldown = 0;
      const other = w === WeaponId.Rifle ? WeaponId.Pistol : WeaponId.Rifle;
      if (s.arms & (1 << other)) {
        s.weapon = other;
        s.equip = weaponStats(other).equipTicks;
      } else s.equip = 0;
    }
    return { item: { kind, amount: 1, mag }, deny: Deny.None };
  }
  if (kind === Item.Vest1 || kind === Item.Vest2) {
    if (a.vest <= 0) return none(Deny.Empty);
    const item = { kind: vestItem(a.vest), amount: 1, dur: a.vestDur };
    a.vest = 0;
    a.vestDur = 0;
    return { item, deny: Deny.None };
  }
  if (kind === Item.Helmet1 || kind === Item.Helmet2) {
    if (a.helmet <= 0) return none(Deny.Empty);
    const item = { kind: helmetItem(a.helmet), amount: 1, dur: a.helmetDur };
    a.helmet = 0;
    a.helmetDur = 0;
    return { item, deny: Deny.None };
  }
  if (backpackLevel(kind) > 0) {
    const level = a.pack ?? 0;
    if (level <= 0) return none(Deny.Empty);
    if (loadOf(s) > (PACK.capacity[0] ?? 0)) return none(Deny.TooHeavy);
    a.pack = 0;
    return { item: { kind: backpackItem(level), amount: 1 }, deny: Deny.None };
  }
  return none(Deny.Empty);
}

/** What a dead duck drops: its guns with the rounds in them, its reserve ammo, its armor and backpack as worn, its heals. Nothing is created. */
export function dropsOf(s: PlayerSim, a: Armor): DropItem[] {
  const out: DropItem[] = [];
  if (s.arms & 1) out.push({ kind: Item.Rifle, amount: 1, mag: s.mag0 });
  if (s.arms & 2) out.push({ kind: Item.Pistol, amount: 1, mag: s.mag1 });
  if (s.res0 > 0) out.push({ kind: Item.RifleAmmo, amount: s.res0 });
  if (s.res1 > 0) out.push({ kind: Item.PistolAmmo, amount: s.res1 });
  if (a.vest > 0) out.push({ kind: vestItem(a.vest), amount: 1, dur: a.vestDur });
  if (a.helmet > 0) out.push({ kind: helmetItem(a.helmet), amount: 1, dur: a.helmetDur });
  if ((a.pack ?? 0) > 0) out.push({ kind: backpackItem(a.pack ?? 0), amount: 1 });
  if (s.bandages > 0) out.push({ kind: Item.Bandage, amount: s.bandages });
  if (s.medkits > 0) out.push({ kind: Item.Medkit, amount: s.medkits });
  return out;
}

/** The one number an item carries on the wire: a gun's magazine, an armor piece's durability (rounded up), else 0. */
export function extraValue(kind: number, extra: ItemExtra | null | undefined): number {
  if (!extra) return 0;
  if (kind === Item.Rifle || kind === Item.Pistol) return Math.max(0, Math.min(255, Math.round(extra.mag ?? 0)));
  if (kind === Item.Vest1 || kind === Item.Vest2 || kind === Item.Helmet1 || kind === Item.Helmet2) return Math.max(0, Math.min(255, Math.ceil(extra.dur ?? 0)));
  return 0;
}

/** Back from the wire number (0 means "as new" for armor found in the world: no extra). */
export function extraFrom(kind: number, value: number, known: boolean): ItemExtra {
  if (!known) return {};
  if (kind === Item.Rifle || kind === Item.Pistol) return { mag: value };
  if (kind === Item.Vest1 || kind === Item.Vest2 || kind === Item.Helmet1 || kind === Item.Helmet2) return { dur: value };
  return {};
}

/**
 * A crate's contents on the wire (LootItem.c): `kind:amount:extra:known`
 * entries joined by commas, `known` 1 when the item carries its own
 * magazine or durability (a dead duck's gear), 0 when it is new.
 */
export function packContents(items: readonly DropItem[]): string {
  return items.map((c) => `${c.kind}:${c.amount}:${extraValue(c.kind, c)}:${c.mag !== undefined || c.dur !== undefined ? 1 : 0}`).join(',');
}

export function unpackContents(text: string): DropItem[] {
  if (!text) return [];
  const out: DropItem[] = [];
  for (const part of text.split(',')) {
    const [k, n, e, known] = part.split(':').map(Number);
    if (!Number.isFinite(k) || !Number.isFinite(n)) continue;
    out.push({ kind: k as number, amount: n as number, ...extraFrom(k as number, e ?? 0, known === 1) });
  }
  return out;
}
