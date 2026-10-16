/**
 * Inventory rules: carrying capacity (PACK), backpacks, pickups that do not
 * fit and why, drops (stacks, guns, armor, the backpack), what a dead duck
 * drops, the crate contents wire format, and crates in the loot roll.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPickup,
  capacityOf,
  Container,
  createPlayerSim,
  Deny,
  dropsOf,
  Item,
  LOOT,
  loadOf,
  PACK,
  packContents,
  pickupBlock,
  replacedBy,
  rollLoot,
  roomFor,
  takeOut,
  unpackContents,
  wantsItem,
  WeaponId,
  weaponStats,
  type Armor,
  type LootPoint,
  type PlayerSim,
} from '../src/index.ts';

const gear = (pack = 0): Armor => ({ vest: 0, vestDur: 0, helmet: 0, helmetDur: 0, pack });

function unarmed(): PlayerSim {
  const s = createPlayerSim(0, 0.02, 0);
  Object.assign(s, { arms: 0, mag0: 0, mag1: 0, res0: 0, res1: 0, bandages: 0, medkits: 0 });
  return s;
}

describe('carrying capacity', () => {
  it('ammo and heals weigh their PACK weight; guns, armor and the backpack weigh nothing', () => {
    const s = unarmed();
    Object.assign(s, { res0: 60, res1: 24, bandages: 3, medkits: 1, arms: 3, mag0: 30, mag1: 12 });
    expect(loadOf(s)).toBe(60 * 0.5 + 24 * 0.25 + 3 * 2 + 6);
    expect(PACK.weight[Item.Rifle]).toBeUndefined();
    expect(capacityOf(gear(0))).toBe(PACK.capacity[0]);
    expect(capacityOf({ vest: 2, vestDur: 150, helmet: 2, helmetDur: 120 })).toBe(PACK.capacity[0]);
    expect(capacityOf(gear(3))).toBe(PACK.capacity[3]);
    for (let i = 1; i < PACK.capacity.length; i++) expect(PACK.capacity[i]).toBeGreaterThan(PACK.capacity[i - 1]!);
  });

  it('a stack is taken only as far as it fits; the rest stays, and the refusal says why', () => {
    const s = unarmed();
    const a = gear(0);
    s.medkits = 1; // 6
    s.bandages = 5; // 10
    s.res0 = 60; // 30: load 46 of 50
    expect(roomFor(s, a, Item.RifleAmmo)).toBe(8);
    expect(applyPickup(s, a, Item.RifleAmmo, 30)).toBe(8);
    expect(loadOf(s)).toBe(50);
    expect(applyPickup(s, a, Item.Bandage, 2)).toBe(0);
    expect(pickupBlock(s, a, Item.Bandage)).toBe(Deny.Full);
    expect(wantsItem(s, a, Item.PistolAmmo)).toBe(false);
    // A backpack makes room.
    expect(applyPickup(s, a, Item.Backpack1, 1)).toBe(1);
    expect(a.pack).toBe(1);
    expect(applyPickup(s, a, Item.Bandage, 2)).toBe(2);
  });

  it('the per-kind caps still apply on top (Deny.Max), even with room left', () => {
    const s = unarmed();
    const a = gear(3);
    s.medkits = LOOT.maxMedkits;
    expect(pickupBlock(s, a, Item.Medkit)).toBe(Deny.Max);
    expect(applyPickup(s, a, Item.Medkit, 1)).toBe(0);
  });

  it('a second gun of a kind you own only adds its rounds when they fit', () => {
    const s = unarmed();
    const a = gear(0);
    expect(applyPickup(s, a, Item.Rifle, 1)).toBe(1);
    s.res0 = 100; // 50: full
    expect(pickupBlock(s, a, Item.Rifle)).toBe(Deny.Full);
    expect(applyPickup(s, a, Item.Rifle, 1)).toBe(0);
    s.res0 = 90; // room for 10
    expect(applyPickup(s, a, Item.Rifle, 1)).toBe(1);
    expect(s.res0).toBe(100);
    // An empty duplicate is simply used up: nothing to add, nothing refused.
    expect(pickupBlock(s, a, Item.Rifle, { mag: 0 })).toBe(Deny.None);
  });

  it('backpacks and armor are taken only as an upgrade, and the old piece is what drops', () => {
    const a = gear(2);
    const s = unarmed();
    expect(pickupBlock(s, a, Item.Backpack1)).toBe(Deny.Worse);
    expect(pickupBlock(s, a, Item.Backpack2)).toBe(Deny.Worse);
    expect(replacedBy(a, Item.Backpack3)).toEqual({ kind: Item.Backpack2, amount: 1 });
    expect(applyPickup(s, a, Item.Backpack3, 1)).toBe(1);
    expect(a.pack).toBe(3);
    a.vest = 1;
    a.vestDur = 40;
    expect(replacedBy(a, Item.Vest2)).toEqual({ kind: Item.Vest1, amount: 1, dur: 40 });
    expect(replacedBy(gear(0), Item.Backpack1)).toBeNull();
  });
});

describe('dropping from the inventory', () => {
  it('drops part of a stack or all of it, never more than carried', () => {
    const s = unarmed();
    const a = gear(1);
    s.res0 = 50;
    expect(takeOut(s, a, Item.RifleAmmo, 30)).toEqual({ item: { kind: Item.RifleAmmo, amount: 30 }, deny: Deny.None });
    expect(takeOut(s, a, Item.RifleAmmo, 999).item).toEqual({ kind: Item.RifleAmmo, amount: 20 });
    expect(s.res0).toBe(0);
    expect(takeOut(s, a, Item.RifleAmmo, 5)).toEqual({ item: null, deny: Deny.Empty });
    expect(takeOut(s, a, Item.Medkit, 1).deny).toBe(Deny.Empty);
  });

  it('dropping the last bandage stops a bandage in progress', () => {
    const s = unarmed();
    Object.assign(s, { bandages: 1, heal: 50, healKind: 1, hp: 40 });
    takeOut(s, gear(), Item.Bandage, 1);
    expect(s.heal).toBe(0);
    expect(s.healKind).toBe(0);
  });

  it('a dropped gun keeps its magazine; dropping the gun in hand switches to the other one', () => {
    const s = unarmed();
    Object.assign(s, { arms: 3, weapon: WeaponId.Rifle, mag0: 17, mag1: 9, reload: 20 });
    const out = takeOut(s, gear(), Item.Rifle, 1);
    expect(out.item).toEqual({ kind: Item.Rifle, amount: 1, mag: 17 });
    expect(s.arms).toBe(2);
    expect(s.mag0).toBe(0);
    expect(s.weapon).toBe(WeaponId.Pistol);
    expect(s.reload).toBe(0);
    expect(s.equip).toBe(weaponStats(WeaponId.Pistol).equipTicks);
    // The last gun: unarmed.
    takeOut(s, gear(), Item.Pistol, 1);
    expect(s.arms).toBe(0);
    // Picking it back up gives the same rounds.
    applyPickup(s, gear(), Item.Rifle, 1, { mag: 17 });
    expect(s.mag0).toBe(17);
  });

  it('armor drops with its durability', () => {
    const a: Armor = { vest: 2, vestDur: 33.5, helmet: 1, helmetDur: 80, pack: 0 };
    expect(takeOut(unarmed(), a, Item.Vest1, 1).item).toEqual({ kind: Item.Vest2, amount: 1, dur: 33.5 });
    expect(a.vest).toBe(0);
    expect(takeOut(unarmed(), a, Item.Helmet2, 1).item).toEqual({ kind: Item.Helmet1, amount: 1, dur: 80 });
    expect(takeOut(unarmed(), a, Item.Vest2, 1).deny).toBe(Deny.Empty);
  });

  it('the backpack comes off only when what you carry fits without it', () => {
    const s = unarmed();
    const a = gear(2);
    s.res0 = 120; // 60 > 50
    expect(takeOut(s, a, Item.Backpack2, 1)).toEqual({ item: null, deny: Deny.TooHeavy });
    expect(a.pack).toBe(2);
    s.res0 = 100; // 50: fits
    expect(takeOut(s, a, Item.Backpack1, 1).item).toEqual({ kind: Item.Backpack2, amount: 1 });
    expect(a.pack).toBe(0);
  });

  it('a dead duck drops its backpack too', () => {
    const s = unarmed();
    s.res1 = 40;
    expect(dropsOf(s, gear(3))).toContainEqual({ kind: Item.Backpack3, amount: 1 });
  });
});

describe('crate contents on the wire', () => {
  it('round trips kinds, amounts, magazines and durability (new items stay new)', () => {
    const list = [
      { kind: Item.Rifle, amount: 1, mag: 12 },
      { kind: Item.RifleAmmo, amount: 90 },
      { kind: Item.Vest2, amount: 1, dur: 40.2 },
      { kind: Item.Helmet1, amount: 1 },
      { kind: Item.Backpack2, amount: 1 },
    ];
    expect(unpackContents(packContents(list))).toEqual([
      { kind: Item.Rifle, amount: 1, mag: 12 },
      { kind: Item.RifleAmmo, amount: 90 },
      { kind: Item.Vest2, amount: 1, dur: 41 },
      { kind: Item.Helmet1, amount: 1 },
      { kind: Item.Backpack2, amount: 1 },
    ]);
    expect(unpackContents('')).toEqual([]);
  });
});

describe('crates in the loot roll', () => {
  const points: LootPoint[] = [
    { id: 1, kind: 'container', x: 0, y: 1, z: 0, tier: 2, zone: 0, container: Container.Small },
    { id: 2, kind: 'container', x: 5, y: 1, z: 0, tier: 2, zone: 0, container: Container.Large },
    { id: 3, kind: 'container', x: 9, y: 1, z: 0, tier: 2, zone: 0, container: Container.Ammo },
    { id: 4, kind: 'ground', x: 20, y: 1, z: 0, tier: 2, zone: 0, container: Container.None },
  ];

  it('every crate is filled (small, large, ammo box counts), tagged with its point; ammo boxes hold ammo', () => {
    for (let seed = 1; seed < 40; seed++) {
      const items = rollLoot(points, seed);
      const rolled = (id: number) => items.filter((i) => i.point === id);
      expect(rolled(1).every((i) => i.box === Container.Small)).toBe(true);
      expect(rolled(2).every((i) => i.box === Container.Large)).toBe(true);
      // Guns bring an ammo stack along, so a crate can hold more than its roll count.
      expect(rolled(1).length).toBeGreaterThanOrEqual(LOOT.smallCrateItems);
      expect(rolled(2).length).toBeGreaterThanOrEqual(LOOT.largeCrateItems);
      expect(rolled(3).length).toBe(LOOT.ammoBoxItems);
      expect(rolled(3).every((i) => i.kind === Item.RifleAmmo || i.kind === Item.PistolAmmo)).toBe(true);
      expect(rolled(4).every((i) => i.box === Container.None)).toBe(true);
    }
  });

  it('backpacks turn up in the loot', () => {
    const many: LootPoint[] = Array.from({ length: 600 }, (_, i) => ({ id: i, kind: 'ground', x: i, y: 1, z: 0, tier: 1 + (i % 4), zone: 0, container: Container.None }));
    const kinds = new Set(rollLoot(many, 11).map((i) => i.kind));
    expect(kinds.has(Item.Backpack1)).toBe(true);
    expect(kinds.has(Item.Backpack2)).toBe(true);
    expect(kinds.has(Item.Backpack3)).toBe(true);
  });
});
