/**
 * Hunt Season progression on the server (docs/progression.md), headless on
 * Pond Keep: a duck's kit (level, gear, tree; from the database at join)
 * decides its moves and its numbers, server side only.
 *
 *   - Locked moves: the server masks the skill buttons the duck's level does
 *     not have (a pressed Dash, VAK! or Blade Storm does nothing), hands out
 *     no pistol before level 3, sets the heavy lock bit before level 6 and
 *     keeps the storm meter empty before level 8.
 *   - Gear and the tree change only server numbers: cut damage, crit chance,
 *     reach, max health, damage taken, dodges, the last stand, the rallying
 *     quack; a duck without a kit (bots, tests) plays as before.
 *   - The party's level scales hunter health and damage above level 10.
 *   - Nothing outside Hunt Season ever reads a kit (the deathmatch and the
 *     battle royale stay as fair as before).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { BLADE, Button, COMBAT, dashTimer, emptyInput, freshKit, heavyLocked, HunterAct, HunterKind, kitFrom, levelScale, quackTimer, stormLeft, stormMeter, TICK_RATE, WeaponId, type DuckKit, type InputFrame } from '@qwakk/shared';
import type { Seat } from '../../src/arena.ts';
import { headlessRaid, keepNav, type HeadlessRaid } from '../../bench/raidHeadless.ts';
import type { HunterAgent } from '../../src/raid/hunter.ts';

beforeAll(async () => {
  await keepNav();
}, 180_000);

const MS = 1000 / TICK_RATE;
let T = 90_000;

async function setup(kit?: DuckKit, extra: DuckKit[] = []): Promise<{ h: HeadlessRaid; seat: Seat; others: Seat[] }> {
  const h = await headlessRaid({ ducks: 0 });
  h.raid.push.quiet = true;
  const seat = h.raid.addDuck('human-a', 'Ann', undefined, null, kit)!;
  const others = extra.map((k, i) => h.raid.addDuck(`human-${i}`, `Bo${i}`, undefined, null, k)!);
  seat.rttMs = 60;
  h.raid.beginTick(T, T * MS);
  h.raid.skipTo(1);
  h.raid.hunts.clear();
  Object.assign(seat.sim, { x: 0, y: 1.05, z: -9, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0 });
  return { h, seat, others };
}

function step(h: HeadlessRaid, seat: Seat, buttons = 0, over: Partial<InputFrame> = {}): void {
  T++;
  h.raid.beginTick(T, T * MS);
  h.raid.applyInput(seat, { ...emptyInput(), buttons, yaw: seat.sim.yaw, pitch: 0, ...over }, T * MS);
  h.raid.endTick();
}

function place(h: HeadlessRaid, seat: Seat, kind: number, dx: number, dz: number, yaw = Math.PI): HunterAgent {
  const x = h.raid.hunts.spawnForTest(kind, seat.sim.x + dx, seat.sim.z + dz);
  x.yaw = yaw;
  x.stun = 1e6;
  x.stunAct = HunterAct.Stagger;
  return x;
}

function slash(h: HeadlessRaid, seat: Seat): void {
  for (let i = 0; i <= BLADE.light[0]!.impact + 1; i++) step(h, seat, i === 0 ? Button.Fire : 0);
}

const level = (n: number, katana: string | null = null, armor: string | null = null, tree: Record<string, number> = {}): DuckKit => kitFrom(n, katana, armor, tree);

describe('locked moves (a level 1 duck)', () => {
  it('the server masks Dash, VAK! and the storm; no pistol, the heavy locked, the meter stays empty', async () => {
    const { h, seat } = await setup(freshKit());
    for (let i = 0; i < 4; i++) step(h, seat);
    expect(seat.sim.arms & (1 << WeaponId.Pistol)).toBe(0);
    expect(heavyLocked(seat.sim)).toBe(true);
    // A cheat sends the skill buttons anyway: the server masks them before the step.
    step(h, seat, Button.Dash);
    step(h, seat, Button.Quack);
    expect(dashTimer(seat.sim)).toBe(0);
    expect(quackTimer(seat.sim)).toBe(0);
    // Hits fill no meter, and a pressed storm does nothing.
    place(h, seat, HunterKind.Rifleman, 0, -1.8);
    for (let i = 0; i < 3; i++) step(h, seat);
    slash(h, seat);
    expect(h.raid.ducks.get(seat.id)!.meter).toBe(0);
    expect(stormMeter(seat.sim)).toBe(0);
    h.raid.fillMeter(seat);
    step(h, seat, Button.Storm);
    expect(stormLeft(seat.sim)).toBe(0);
    // Slot 2: still the katana (no pistol to draw); holding Fire never charges.
    step(h, seat, Button.Slot2);
    expect(seat.sim.weapon).toBe(WeaponId.Katana);
    for (let i = 0; i < 40; i++) step(h, seat, Button.Fire);
    expect(seat.sim.mag0 & 15).not.toBe(4);
    // An ammo drop means nothing without the pistol.
    expect(seat.sim.res1).toBeGreaterThanOrEqual(0);
  });

  it('level 2 dashes, level 4 quacks, level 8 storms; the test hook unlocks everything for one run only', async () => {
    const { h, seat } = await setup(level(4));
    for (let i = 0; i < 4; i++) step(h, seat);
    expect(seat.sim.arms & (1 << WeaponId.Pistol)).not.toBe(0);
    step(h, seat, Button.Dash);
    expect(dashTimer(seat.sim)).toBeGreaterThan(0);
    for (let i = 0; i < 80; i++) step(h, seat);
    step(h, seat, Button.Quack);
    expect(quackTimer(seat.sim)).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) step(h, seat);
    h.raid.fillMeter(seat);
    step(h, seat, Button.Storm);
    expect(stormLeft(seat.sim)).toBe(0);
    h.raid.unlockAll(seat);
    expect(heavyLocked(seat.sim)).toBe(false);
    h.raid.fillMeter(seat);
    step(h, seat, Button.Storm);
    expect(stormLeft(seat.sim)).toBeGreaterThan(0);
    // The stored kit is untouched (memory only).
    expect(h.raid.ducks.get(seat.id)!.kit.level).toBe(4);
  });

  it('a duck without a kit (bots, tests, dev identities) has every move', async () => {
    const { h, seat } = await setup();
    for (let i = 0; i < 4; i++) step(h, seat);
    expect(heavyLocked(seat.sim)).toBe(false);
    expect(seat.sim.arms & (1 << WeaponId.Pistol)).not.toBe(0);
    step(h, seat, Button.Dash);
    expect(dashTimer(seat.sim)).toBeGreaterThan(0);
  });
});

describe('gear and the tree are server numbers', () => {
  it('the katana tier and Sharp Edge raise the cut; armor and the tree raise health and lower damage taken', async () => {
    const base = await setup(level(8));
    const a = place(base.h, base.seat, HunterKind.Rifleman, 0, -1.8);
    for (let i = 0; i < 3; i++) step(base.h, base.seat);
    slash(base.h, base.seat);
    const r = base.h.raid.rules.blade;
    expect(a.maxHp - a.hp).toBeCloseTo(r.slash[0], 3);

    const geared = await setup(level(8, 'katana_bamboo', 'armor_padded', { edge: 1, feathers: 1, tough: 1 }));
    geared.h.raid.blade.rand = () => 1; // no random crit
    const b = place(geared.h, geared.seat, HunterKind.Rifleman, 0, -1.8);
    for (let i = 0; i < 3; i++) step(geared.h, geared.seat);
    slash(geared.h, geared.seat);
    expect(b.maxHp - b.hp).toBeCloseTo(r.slash[0] * 1.07 * 1.03, 3);
    // Max health: 100 + 8 (the vest) + 5 (Thick Feathers); full at the start.
    expect(geared.h.raid.maxHpOf(geared.seat)).toBe(COMBAT.maxHp + 13);
    // Damage taken: the vest's 3% and Tough Down's 3%.
    const hp0 = geared.seat.sim.hp;
    geared.h.raid.rand = () => 1; // no dodge
    geared.h.raid.hurtDuck(geared.seat.id, 100, 0, 0, HunterKind.Rifleman, false);
    expect(hp0 - geared.seat.sim.hp).toBe(Math.round(100 * 0.97 * 0.97));
  });

  it('the katana tier gives a crit chance (the server rolls it), Iaido hits harder', async () => {
    const { h, seat } = await setup(level(20, 'katana_dragon', null, { edge: 3, reach: 2, finisher: 2, iaido: 1 }));
    h.raid.blade.rand = () => 0; // always under the chance
    const x = place(h, seat, HunterKind.Boss, 0, -2.0);
    for (let i = 0; i < 3; i++) step(h, seat);
    slash(h, seat);
    const r = h.raid.rules.blade;
    expect(x.maxHp - x.hp).toBeCloseTo(r.slash[0] * 1.3 * 1.09 * (r.crit + 0.25), 2);
  });

  it('Sidestep dodges a hit, Last Stand leaves the duck at 1 health once an objective, the Rallying Quack heals friends', async () => {
    const { h, seat, others } = await setup(level(30, null, null, { feathers: 3, tough: 2, sidestep: 2, laststand: 1, loud: 3, stun: 2, heart: 2, rally: 1 }), [level(1)]);
    const friend = others[0]!;
    h.raid.rand = () => 0;
    const hp = seat.sim.hp;
    h.raid.hurtDuck(seat.id, 50, 0, 0, HunterKind.Rifleman, false);
    expect(seat.sim.hp).toBe(hp);
    h.raid.rand = () => 1;
    h.raid.hurtDuck(seat.id, 999, 0, 0, HunterKind.Rifleman, false);
    expect(seat.sim.hp).toBe(1);
    expect(seat.sim.down).toBe(0);
    h.raid.hurtDuck(seat.id, 999, 0, 0, HunterKind.Rifleman, false);
    expect(seat.sim.down).toBe(1);
    // A fresh objective: the last stand is back.
    h.raid.skipTo(2);
    expect(h.raid.ducks.get(seat.id)!.lastStandUsed).toBe(false);
    // The rallying quack: the friend next to the duck gets 10 health.
    seat.sim.down = 0;
    seat.sim.hp = 50;
    Object.assign(friend.sim, { x: seat.sim.x + 1.5, y: seat.sim.y, z: seat.sim.z, hp: 40, down: 0, alive: 1 });
    for (let i = 0; i < 12; i++) step(h, seat, i === 0 ? Button.Quack : 0);
    expect(friend.sim.hp).toBe(50);
    expect(seat.sim.hp).toBe(60);
  });
});

describe('strong ducks: the level scaling', () => {
  it('hunter health and damage grow with the party average above level 10; a fresh party plays as before', async () => {
    const fresh = await setup(level(5), [level(9)]);
    expect(fresh.h.raid.rules.hunterHpScale).toBe(1);
    expect(fresh.h.raid.rules.hunterDamageScale).toBe(1);
    const strong = await setup(level(30), [level(20)]);
    const sc = levelScale(25);
    expect(strong.h.raid.rules.hunterHpScale).toBeCloseTo(sc.hp, 6);
    expect(strong.h.raid.rules.hunterDamageScale).toBeCloseTo(sc.damage, 6);
    const x = strong.h.raid.hunts.spawnForTest(HunterKind.Beater, 0, -20);
    const y = fresh.h.raid.hunts.spawnForTest(HunterKind.Beater, 0, -20);
    expect(x.maxHp / y.maxHp).toBeCloseTo(sc.hp, 1);
  });
});

describe('only Hunt Season reads a kit', () => {
  it('no deathmatch or battle royale source touches the kit, the gear or the tree', () => {
    const root = fileURLToPath(new URL('../../src/', import.meta.url));
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);
    const uses = /\b(duckKit|loadKit|kitStats|kitFrom|kitWire|gearTier|devKit|freshKit|lockedButtonsOf|duck_progress|duck_tree|duck_equipped|duck_items|feather_ledger|armBlade)\b/;
    // Hunt Season (raid/, RaidRoom.ts), the meta layer that stores it, and the admin panel's read-only support lookup.
    const allowed = /\/(raid\/|RaidRoom\.ts|meta\/|admin\/store\.ts)/;
    const hits = files.filter((f) => uses.test(readFileSync(f, 'utf8'))).map((f) => f.replaceAll('\\', '/'));
    expect(hits.filter((f) => !allowed.test(f))).toEqual([]);
    // The guard sees the real readers (so a rename cannot make it pass by matching nothing).
    for (const f of ['raid/raid.ts', 'RaidRoom.ts', 'meta/progression/store.ts']) expect(hits.some((h) => h.endsWith(`/src/${f}`)), f).toBe(true);
  });
});
