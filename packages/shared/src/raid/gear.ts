/**
 * Hunt Season progression, part 2: the gear a duck buys with Tüy (Feathers)
 * at Duck Plaza's Blacksmith and Armorer. Hunt Season only: nothing here is
 * ever read by the deathmatch or the battle royale.
 *
 * Every number is a server-only effect (raid/blade.ts and raid/raid.ts on the
 * server): katana damage and crit chance, max health and damage taken. None
 * changes what the client simulates (swing timings, the dash, movement), so
 * prediction is untouched. Each tier is about 8 to 11 percent better than the
 * one before (docs/progression.md has the tables), never a jump.
 *
 * Looks: a tier tints the existing katana's blade (and gives the top tiers a
 * glow) and the armor is a tinted vest band on the duck's chest. No new art,
 * never a hitbox change.
 */

/** Gear slots. Helmet and charm exist in the data model; nothing is sold for them yet. */
export const GEAR_SLOTS = ['katana', 'armor', 'helmet', 'charm'] as const;
export type GearSlot = (typeof GEAR_SLOTS)[number];

export interface GearItem {
  id: string;
  slot: GearSlot;
  /** 0 for the starter, then 1, 2, ... */
  tier: number;
  /** Level needed to buy it. */
  level: number;
  /** Price in Tüy (0: the free starter every duck owns). */
  cost: number;
  /** Katana: damage multiplier on every cut and the chance (0..1) that a cut crits. */
  blade?: number;
  crit?: number;
  /** Armor: extra max health and the share of hunter damage it stops (0..1). */
  hp?: number;
  guard?: number;
  /** Look: the blade's (or the vest's) tint, a glow color (0: none) and a band color (0: none). */
  color: number;
  glow: number;
  band: number;
}

export const GEAR: readonly GearItem[] = [
  { id: 'katana_bokken', slot: 'katana', tier: 0, level: 1, cost: 0, blade: 1.0, crit: 0, color: 0xc59a62, glow: 0, band: 0 },
  { id: 'katana_bamboo', slot: 'katana', tier: 1, level: 3, cost: 200, blade: 1.07, crit: 0.02, color: 0xd3dc84, glow: 0, band: 0 },
  { id: 'katana_steel', slot: 'katana', tier: 2, level: 7, cost: 750, blade: 1.14, crit: 0.04, color: 0xffffff, glow: 0, band: 0 },
  { id: 'katana_moon', slot: 'katana', tier: 3, level: 12, cost: 2000, blade: 1.22, crit: 0.06, color: 0xb6d0ff, glow: 0x2f5aa8, band: 0 },
  { id: 'katana_dragon', slot: 'katana', tier: 4, level: 18, cost: 4500, blade: 1.3, crit: 0.08, color: 0xffa45e, glow: 0x9a2a00, band: 0 },
  { id: 'armor_padded', slot: 'armor', tier: 1, level: 2, cost: 150, hp: 8, guard: 0.03, color: 0xeadcbf, glow: 0, band: 0 },
  { id: 'armor_leather', slot: 'armor', tier: 2, level: 5, cost: 550, hp: 16, guard: 0.06, color: 0x8c5a32, glow: 0, band: 0xffd43b },
  { id: 'armor_chain', slot: 'armor', tier: 3, level: 10, cost: 1500, hp: 24, guard: 0.09, color: 0x9ba4ae, glow: 0, band: 0xff8a3d },
  { id: 'armor_plate', slot: 'armor', tier: 4, level: 16, cost: 3500, hp: 32, guard: 0.12, color: 0xd9dee4, glow: 0, band: 0xffd43b },
];

/** The katana every duck starts with (owned and equipped from the first run). */
export const STARTER_KATANA = 'katana_bokken';

const BY_ID = new Map(GEAR.map((g) => [g.id, g]));

export function gearById(id: unknown): GearItem | null {
  return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

/** The items of one slot, by tier. */
export function gearOfSlot(slot: GearSlot): GearItem[] {
  return GEAR.filter((g) => g.slot === slot).sort((a, b) => a.tier - b.tier);
}

/** Tier of an item id in its slot (0 for none or unknown). */
export function gearTier(id: string | null | undefined): number {
  return gearById(id)?.tier ?? 0;
}

/** The item of a slot at a tier, or null (armor tier 0: none). */
export function gearAt(slot: GearSlot, tier: number): GearItem | null {
  return GEAR.find((g) => g.slot === slot && g.tier === tier) ?? null;
}
