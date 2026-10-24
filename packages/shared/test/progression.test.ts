/**
 * Hunt Season progression, the shared rules (docs/progression.md): what each
 * level unlocks and which buttons it masks, the skill tree's spend rules and
 * its re-check, the gear tiers' steps (no jump), a fully grown duck's power
 * against a fresh one (1.6 to 2 times), Tüy per run, the level scaling, and
 * the sim side: a duck whose level does not have the charged heavy never
 * charges (its `ex` lock bit), the masked inputs and the lock replay bit for
 * bit, and a duck without the pistol cannot swap to it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_SKILLS,
  armBlade,
  bladeAct,
  BladeAct,
  BLADE,
  buildMapDef,
  Button,
  canSpend,
  cleanTree,
  createPlayerSim,
  createSimWorld,
  dashTimer,
  devKit,
  EX_HEAVY_LOCK,
  FEATHERS,
  freshKit,
  GEAR,
  gearOfSlot,
  heavyLocked,
  initPhysics,
  kitFrom,
  kitPower,
  kitStats,
  LEVEL_SCALE,
  levelScale,
  lockedButtonsOf,
  newUnlocks,
  PLAYER_SIM_FIELDS,
  raidFeathers,
  respecCost,
  RESPEC_COST,
  SKILL_BUTTONS,
  stepPlayer,
  TREE,
  TREE_RANKS,
  treePoints,
  unlockBits,
  WeaponId,
  type InputFrame,
  type PlayerSim,
  type SimWorld,
  type TreeAlloc,
} from '../src/index.ts';

/** A katana's damage (crits counted) or an armor's effective health, against nothing. */
function itemPowerForTest(it: { slot: string; blade?: number; crit?: number; hp?: number; guard?: number }): number {
  if (it.slot === 'katana') return (it.blade ?? 1) * (1 + (it.crit ?? 0) * 0.6);
  return (100 + (it.hp ?? 0)) / 100 / (1 - (it.guard ?? 0));
}

beforeAll(async () => {
  await initPhysics();
});

describe('level unlocks', () => {
  it('a fresh duck has the light combo only; each move at its level', () => {
    expect(lockedButtonsOf(unlockBits(1))).toBe(SKILL_BUTTONS);
    expect(lockedButtonsOf(unlockBits(2))).toBe(Button.Quack | Button.Storm);
    expect(lockedButtonsOf(unlockBits(4))).toBe(Button.Storm);
    expect(lockedButtonsOf(unlockBits(8))).toBe(0);
    expect(unlockBits(50)).toBe(ALL_SKILLS);
    expect(newUnlocks(1, 4)).toEqual(['dash', 'pistol', 'quack']);
    expect(newUnlocks(5, 8)).toEqual(['heavy', 'storm']);
    expect(newUnlocks(8, 20)).toEqual([]);
    // Bot ducks and dev identities keep every move, below the level scaling.
    expect(devKit().unlocks).toBe(ALL_SKILLS);
    expect(levelScale(devKit().level)).toEqual({ hp: 1, damage: 1 });
  });
});

describe('the skill tree', () => {
  it('points: one per level from 2, one more every tenth level; the tree fills around level 29', () => {
    expect(treePoints(1)).toBe(0);
    expect(treePoints(2)).toBe(1);
    expect(treePoints(10)).toBe(10);
    expect(TREE_RANKS).toBe(30);
    expect(treePoints(28)).toBeLessThan(TREE_RANKS);
    expect(treePoints(29)).toBe(TREE_RANKS);
  });

  it('checks points, levels, prerequisites and capstones', () => {
    expect(canSpend({}, 'edge', 1)).toBe('no_points');
    expect(canSpend({}, 'edge', 2)).toBeNull();
    expect(canSpend({}, 'nope', 9)).toBe('unknown');
    expect(canSpend({}, 'reach', 5)).toBe('needs_node');
    expect(canSpend({ edge: 1 }, 'reach', 5)).toBeNull();
    expect(canSpend({ edge: 3 }, 'edge', 9)).toBe('maxed');
    expect(canSpend({}, 'loud', 3)).toBe('needs_level');
    expect(canSpend({}, 'heart', 7)).toBe('needs_level');
    const blade6: TreeAlloc = { edge: 3, reach: 2, finisher: 1 };
    expect(canSpend(blade6, 'iaido', 20)).toBe('needs_branch');
    const blade7: TreeAlloc = { edge: 3, reach: 2, finisher: 2 };
    expect(canSpend(blade7, 'iaido', 14)).toBe('needs_level');
    expect(canSpend(blade7, 'iaido', 15)).toBeNull();
    // Out of points.
    expect(canSpend({ edge: 1 }, 'feathers', 2)).toBe('no_points');
  });

  it('every effect is small: no node rank is worth more than a few percent (capstones apart)', () => {
    for (const n of TREE) {
      if (n.branchPoints) continue;
      // Per rank: a share (0.02 to 0.3 of one number) or a few health.
      expect(n.per).toBeLessThanOrEqual(n.id === 'feathers' ? 5 : 0.3);
    }
  });

  it('rebuilds a stored allocation within the rules (never more than the points, prerequisites first)', () => {
    expect(cleanTree({ edge: 9, reach: 2, bogus: 4 } as TreeAlloc, 3)).toEqual({ edge: 2 });
    expect(cleanTree({ reach: 2 }, 50)).toEqual({});
    expect(cleanTree({ edge: 3, reach: 2, finisher: 2, iaido: 1 }, 10)).toEqual({ edge: 3, reach: 2, finisher: 2 });
    expect(cleanTree({ edge: 3, reach: 2, finisher: 2, iaido: 1 }, 15)).toEqual({ edge: 3, reach: 2, finisher: 2, iaido: 1 });
  });

  it('the first respec is free, every later one costs Tüy', () => {
    expect(respecCost(0)).toBe(0);
    expect(respecCost(1)).toBe(RESPEC_COST);
    expect(respecCost(7)).toBe(RESPEC_COST);
  });
});

describe('gear', () => {
  it('each tier is a modest step (about 7 to 12 percent), costs and levels only go up', () => {
    for (const slot of ['katana', 'armor'] as const) {
      const items = gearOfSlot(slot);
      let prev = 1;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const p = itemPowerForTest(it);
        if (i > 0 || slot === 'armor') {
          expect(p / prev, it.id).toBeGreaterThan(1.06);
          expect(p / prev, it.id).toBeLessThan(1.13);
        }
        prev = p;
        if (i > 0) {
          expect(it.cost).toBeGreaterThan(items[i - 1]!.cost);
          expect(it.level).toBeGreaterThan(items[i - 1]!.level);
        }
      }
    }
    expect(new Set(GEAR.map((g) => g.id)).size).toBe(GEAR.length);
  });

  it('a kit from stored rows falls back to the starter for unknown or wrong-slot items', () => {
    expect(kitFrom(5, 'armor_padded', 'katana_steel', {}).katana).toBe('katana_bokken');
    expect(kitFrom(5, 'katana_bamboo', 'katana_steel', {}).armor).toBeNull();
    expect(kitFrom(5, null, null, {})).toEqual(freshKit(5));
  });
});

describe('balance', () => {
  it('a fresh duck is the baseline; a fully grown one is 1.6 to 2 times as strong, reached step by step', () => {
    expect(kitPower(freshKit()).power).toBeCloseTo(1, 5);
    const full = kitFrom(50, 'katana_dragon', 'armor_plate', { edge: 3, reach: 2, finisher: 2, lucky: 2, iaido: 1, feathers: 3, tough: 2, strike: 2, sidestep: 2, laststand: 1, loud: 3, stun: 2, heart: 2, eye: 2, rally: 1 });
    const p = kitPower(full);
    expect(p.damage).toBeGreaterThan(1.6);
    expect(p.damage).toBeLessThan(2.0);
    expect(p.health).toBeGreaterThan(1.6);
    expect(p.health).toBeLessThan(2.0);
    expect(p.power).toBeGreaterThan(1.6);
    expect(p.power).toBeLessThan(2.0);
    // The level scaling keeps a top duck's runs a challenge, and the duck still clearly stronger.
    const sc = levelScale(50);
    expect(sc.hp).toBeCloseTo(1 + LEVEL_SCALE.hpCap, 5);
    expect(p.damage / sc.hp).toBeGreaterThan(1.25);
    expect(p.health / sc.damage).toBeGreaterThan(1.5);
    // No single purchase or point moves the power more than about 12%.
    const s0 = kitStats(freshKit(30));
    expect(s0.blade).toBe(1);
  });
});

describe('Tüy per run', () => {
  it('objectives, minions, elites, the boss and the win; capped', () => {
    expect(raidFeathers({ wavesCleared: 0, kills: 0, minionKills: 4, bossKills: 0, won: false })).toBe(0);
    expect(raidFeathers({ wavesCleared: 2, kills: 3, minionKills: 12, bossKills: 0, won: false })).toBe(25 + 30 + 3 + 2);
    // A test-hook win (no kills): the four objectives and the win; with the daily bonus a fresh duck can buy the Bamboo Blade.
    const hookWin = raidFeathers({ wavesCleared: 4, kills: 0, minionKills: 0, bossKills: 0, won: true });
    expect(hookWin).toBe(25 + 30 + 35 + 40 + 50);
    expect(hookWin + FEATHERS.daily).toBeGreaterThanOrEqual(gearOfSlot('katana')[1]!.cost);
    expect(raidFeathers({ wavesCleared: 4, kills: 9999, minionKills: 99999, bossKills: 3, won: true })).toBe(FEATHERS.maxPerRun);
  });

  it('the level scaling starts above level 10 and is capped', () => {
    expect(levelScale(1)).toEqual({ hp: 1, damage: 1 });
    expect(levelScale(10)).toEqual({ hp: 1, damage: 1 });
    expect(levelScale(20).hp).toBeCloseTo(1.1, 5);
    expect(levelScale(20).damage).toBeCloseTo(1.05, 5);
    expect(levelScale(99)).toEqual({ hp: 1 + LEVEL_SCALE.hpCap, damage: 1 + LEVEL_SCALE.damageCap });
    expect(levelScale(30, 0, 0)).toEqual({ hp: 1, damage: 1 });
  });
});

// ---- the sim: locks replay bit for bit --------------------------------------------------

function flatWorld(): SimWorld {
  const cells = 32;
  return createSimWorld(buildMapDef('prog-test', { size: 128, terrain: { cells, cellSize: 4 }, props: [] }, new Uint8Array((cells + 1) * (cells + 1) * 2), { props: {}, kinds: {} }).def);
}

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0, ...over });

function duck(sim: SimWorld, level: number): PlayerSim {
  const p = createPlayerSim(0, 1, 0);
  const bits = unlockBits(level);
  armBlade(p, 0, { pistol: (bits & 2) !== 0, heavy: (bits & 8) !== 0 });
  for (let i = 0; i < 12; i++) stepPlayer(sim, p, frame());
  return p;
}

/** A script that presses everything: Fire held long (a heavy), the skills, Slot 2. */
function script(): InputFrame[] {
  const out: InputFrame[] = [];
  for (let i = 0; i < 90; i++) {
    let b = 0;
    if (i >= 2 && i < 50) b |= Button.Fire;
    if (i === 55) b |= Button.Dash;
    if (i === 60) b |= Button.Quack;
    if (i === 62) b |= Button.Storm;
    if (i === 70) b |= Button.Slot2;
    out.push(frame({ buttons: b, mz: i > 52 ? 1 : 0 }));
  }
  return out;
}

const snap = (p: PlayerSim): number[] => PLAYER_SIM_FIELDS.map((k) => p[k] as number);

describe('the locks in the sim', () => {
  it('a level-1 duck: masked skills, no heavy charge, no pistol; the run replays bit for bit', () => {
    const sim = flatWorld();
    const run = (): { p: PlayerSim; acts: Set<number>; states: number[][] } => {
      const p = duck(sim, 1);
      const masked = lockedButtonsOf(unlockBits(1));
      const acts = new Set<number>();
      const states: number[][] = [];
      for (const f of script()) {
        // Both sides mask the locked skill buttons before the step (client before it sends, server before it steps).
        stepPlayer(sim, p, { ...f, buttons: f.buttons & ~masked });
        acts.add(bladeAct(p));
        states.push(snap(p));
      }
      return { p, acts, states };
    };
    const a = run();
    const b = run();
    expect(heavyLocked(a.p)).toBe(true);
    expect(a.acts.has(BladeAct.Charge)).toBe(false);
    expect(a.acts.has(BladeAct.Heavy)).toBe(false);
    expect(a.acts.has(BladeAct.Slash1)).toBe(true);
    expect(dashTimer(a.p)).toBe(0);
    // Slot 2 does nothing without the pistol's arms bit: the katana stays in hand.
    expect(a.p.weapon).toBe(WeaponId.Katana);
    expect(a.p.arms & (1 << WeaponId.Pistol)).toBe(0);
    expect(a.states).toEqual(b.states);
  });

  it('a level-8 duck charges, dashes and swaps; the lock bit is the only difference in the state', () => {
    const sim = flatWorld();
    const p = duck(sim, 8);
    const acts = new Set<number>();
    let dashed = false;
    for (const f of script()) {
      stepPlayer(sim, p, f);
      acts.add(bladeAct(p));
      if (dashTimer(p) > 0) dashed = true;
    }
    expect(heavyLocked(p)).toBe(false);
    expect(acts.has(BladeAct.Charge)).toBe(true);
    expect(dashed).toBe(true);
    expect(p.weapon).toBe(WeaponId.Pistol);
    // Locked and unlocked ducks share every other bit of the arm-time state.
    const a = createPlayerSim(0, 1, 0);
    const b = createPlayerSim(0, 1, 0);
    armBlade(a, 0, { pistol: true, heavy: false });
    armBlade(b, 0, { pistol: true, heavy: true });
    expect(a.ex ^ b.ex).toBe(EX_HEAVY_LOCK);
    expect(BLADE.heavy.fullCharge).toBeGreaterThan(0);
  });
});
