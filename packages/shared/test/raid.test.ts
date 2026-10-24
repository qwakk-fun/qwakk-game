/**
 * Hunt Season shared code: the push's horde math, XP and levels (v3 with
 * minions and the combo bonus), the melee upgrade offer, the trap root in the
 * sim (and that it stays deterministic), and the hunters' own hitboxes.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  comboBonus,
  createPlayerSim,
  createSimWorld,
  crateHpFor,
  duckScale,
  eliteKinds,
  exRoot,
  generateMap,
  GOALS,
  goalAt,
  Goal,
  HUNTER_HP,
  hunterHpScale,
  HunterAct,
  HunterKind,
  hunterShape,
  initPhysics,
  isMinion,
  LEVEL_CAP,
  levelOfXp,
  levelProgress,
  packElites,
  packEx,
  packSize,
  PLAYER_SIM_FIELDS,
  RAID,
  RAID_XP,
  raidXp,
  rayHitbox,
  rollOffer,
  setNades,
  setRoot,
  stepPlayer,
  tickRoot,
  trenchKillsFor,
  unpackEx,
  Upgrade,
  xpForLevel,
  xpToNext,
  type InputFrame,
} from '../src/index.ts';

beforeAll(async () => {
  await initPhysics();
});

describe('the push (objectives and the horde)', () => {
  it('is four objectives in order: the trench, the crates, the towers, the camp', () => {
    expect(RAID.objectives).toBe(4);
    expect(GOALS).toEqual([Goal.Trench, Goal.Crates, Goal.Towers, Goal.Camp]);
    expect(goalAt(1)).toBe(Goal.Trench);
    expect(goalAt(4)).toBe(Goal.Camp);
    expect(goalAt(9)).toBe(Goal.Camp);
  });

  it('sends packs of 6 to 12 minions solo, bigger later and with more ducks', () => {
    for (let g = 1; g <= 4; g++) for (let r = 0; r < 1; r += 0.1) {
      const n = packSize(g, 1, r);
      expect(n).toBeGreaterThanOrEqual(6);
      expect(n).toBeLessThanOrEqual(12);
      expect(packSize(g, 4, r)).toBeGreaterThan(n);
    }
    expect(packSize(4, 1, 0)).toBeGreaterThan(packSize(1, 1, 0));
    expect(packSize(1, 4, 0.999)).toBeLessThanOrEqual(16);
  });

  it('escorts packs with elites of the old hunter kinds, never minions', () => {
    expect(packElites(1, 1, 0.9, 0.9)).toBe(0);
    expect(packElites(1, 1, 0.1, 0.1)).toBe(2);
    expect(packElites(1, 1, 0.6, 0.9)).toBe(0);
    expect(packElites(2, 1, 0.6, 0.9)).toBe(1);
    expect(packElites(1, 4, 0.9, 0.9)).toBe(1);
    for (let g = 1; g <= 4; g++) for (const k of eliteKinds(g)) expect(isMinion(k)).toBe(false);
    expect(isMinion(HunterKind.Beater) && isMinion(HunterKind.Recruit)).toBe(true);
  });

  it('minions fall to one or two light cuts, elites take a few, the boss many', () => {
    expect(HUNTER_HP[HunterKind.Recruit]).toBeLessThanOrEqual(24);
    expect(HUNTER_HP[HunterKind.Beater]).toBeGreaterThan(24);
    expect(HUNTER_HP[HunterKind.Beater]).toBeLessThanOrEqual(48);
    expect(HUNTER_HP[HunterKind.Rifleman]).toBeGreaterThan(80);
    expect(HUNTER_HP[HunterKind.Boss]).toBeGreaterThan(1000);
    expect(hunterHpScale(4, 1, HunterKind.Beater)).toBeGreaterThan(hunterHpScale(1, 1, HunterKind.Beater));
    expect(hunterHpScale(4, 4, HunterKind.Boss)).toBeGreaterThan(hunterHpScale(4, 1, HunterKind.Boss));
    expect(duckScale(1)).toBe(1);
    expect(duckScale(4)).toBe(2.5);
    expect(trenchKillsFor(2)).toBeGreaterThan(trenchKillsFor(1));
    expect(crateHpFor(4)).toBeGreaterThan(crateHpFor(1));
  });
});

describe('XP and levels', () => {
  it('follows 100 * n^1.5 per level, capped at 50', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(4)).toBe(800);
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(100 + Math.round(100 * 2 ** 1.5));
    for (let l = 1; l <= LEVEL_CAP; l++) {
      expect(levelOfXp(xpForLevel(l))).toBe(l);
      if (l > 1) expect(levelOfXp(xpForLevel(l) - 1)).toBe(l - 1);
    }
    expect(levelOfXp(1e12)).toBe(LEVEL_CAP);
    expect(levelOfXp(-5)).toBe(1);
    expect(levelOfXp(Number.NaN)).toBe(1);
    const p = levelProgress(150);
    expect(p).toMatchObject({ level: 2, into: 50, need: xpToNext(2) });
    expect(levelProgress(1e12)).toMatchObject({ level: LEVEL_CAP, share: 1 });
  });

  it('grants XP for objectives, kills, minions, the combo, bosses, revives and the win, within the cap', () => {
    expect(raidXp({ wavesCleared: 0, kills: 0, bossKills: 0, revives: 0, won: false })).toBe(0);
    expect(raidXp({ wavesCleared: 1, kills: 0, bossKills: 0, revives: 0, won: false })).toBe(RAID_XP.perObjective);
    expect(raidXp({ wavesCleared: 2, kills: 3, minionKills: 10, bossKills: 0, revives: 1, won: false })).toBe(RAID_XP.perObjective * 2 + RAID_XP.perObjectiveStep + 3 * RAID_XP.perKill + 10 * RAID_XP.perMinion + RAID_XP.perRevive);
    const win = raidXp({ wavesCleared: 4, kills: 40, minionKills: 200, comboXp: 150, bossKills: 1, revives: 2, won: true });
    expect(win).toBeGreaterThan(raidXp({ wavesCleared: 4, kills: 40, minionKills: 200, comboXp: 150, bossKills: 1, revives: 2, won: false }));
    expect(win).toBeLessThanOrEqual(RAID_XP.maxPerRun);
    expect(raidXp({ wavesCleared: 4, kills: 99999, bossKills: 3, revives: 999, won: true })).toBe(RAID_XP.maxPerRun);
    expect(levelOfXp(win)).toBeGreaterThan(3);
    expect(levelOfXp(win)).toBeLessThan(12);
  });

  it('caps the combo bonus at half the kill XP, however much the server claims', () => {
    expect(comboBonus(10, 0)).toBe(0);
    expect(comboBonus(10, 20)).toBeCloseTo(2);
    expect(comboBonus(10, 400)).toBe(5);
    const base = { wavesCleared: 1, kills: 10, minionKills: 0, bossKills: 0, revives: 0, won: false };
    expect(raidXp({ ...base, comboXp: 1e6 }) - raidXp(base)).toBe(Math.round(10 * RAID_XP.perKill * RAID_XP.comboMax));
  });

  it('a full solo win (four objectives, about 200 minions, 40 elites, the boss) is about 2,400 XP', () => {
    const xp = raidXp({ wavesCleared: 4, kills: 40, minionKills: 200, comboXp: 150, bossKills: 1, revives: 0, won: true });
    expect(xp).toBeGreaterThan(2100);
    expect(xp).toBeLessThan(2800);
  });
});

describe('upgrade offer (melee cards)', () => {
  it('rolls three different cards, never a maxed one, the revive card only with friends', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const o = rollOffer(rand, { team: false, maxed: new Set([Upgrade.Damage]) });
      expect(o).toHaveLength(3);
      expect(new Set(o).size).toBe(3);
      expect(o).not.toContain(Upgrade.Revive);
      expect(o).not.toContain(Upgrade.Damage);
    }
    let revive = 0;
    for (let i = 0; i < 300; i++) if (rollOffer(rand, { team: true }).includes(Upgrade.Revive)) revive++;
    expect(revive).toBeGreaterThan(0);
  });
});

describe('trap root in the sim', () => {
  const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ seq: 0, tick: 0, mx: 0, mz: 1, buttons: 0, yaw: 0, pitch: 0, ...over });

  it('packs next to the explosives and survives their step', () => {
    const s = { ex: 0 };
    setNades(s, 2);
    setRoot(s, 40);
    expect(exRoot(s)).toBe(40);
    expect(unpackEx(s.ex).nades).toBe(2);
    setRoot(s, 10);
    expect(exRoot(s)).toBe(40); // never shortens a running root
    tickRoot(s);
    expect(exRoot(s)).toBe(39);
    expect(unpackEx(packEx(unpackEx(s.ex))).root).toBe(39);
  });

  it('holds a rooted duck in place (it can still turn) and lets go when it runs out', () => {
    const sim = createSimWorld(generateMap(1337));
    const p = createPlayerSim(0, 30, 0);
    for (let i = 0; i < 60; i++) stepPlayer(sim, p, frame({ mz: 0 }));
    setRoot(p, RAID.rootTicks);
    const x = p.x;
    const z = p.z;
    for (let i = 0; i < RAID.rootTicks - 1; i++) stepPlayer(sim, p, frame({ yaw: 1, buttons: i === 3 ? 1 : 0 }));
    expect(Math.hypot(p.x - x, p.z - z)).toBeLessThan(0.05);
    expect(p.yaw).toBeCloseTo(1, 5);
    for (let i = 0; i < 30; i++) stepPlayer(sim, p, frame({ yaw: 1 }));
    expect(exRoot(p)).toBe(0);
    expect(Math.hypot(p.x - x, p.z - z)).toBeGreaterThan(1);
  });

  it('replays bit for bit from the same state (prediction)', () => {
    const sim = createSimWorld(generateMap(1337));
    const a = createPlayerSim(5, 30, 5);
    for (let i = 0; i < 40; i++) stepPlayer(sim, a, frame({ mz: 0 }));
    setRoot(a, 20);
    const b = { ...a };
    for (let i = 0; i < 50; i++) {
      const f = frame({ mx: (i % 7) / 7 - 0.5, yaw: i * 0.03, buttons: i % 11 === 0 ? 1 : 0 });
      stepPlayer(sim, a, f);
      stepPlayer(sim, b, { ...f });
    }
    for (const k of PLAYER_SIM_FIELDS) expect(b[k]).toBe(a[k]);
  });
});

describe('hunter hitboxes', () => {
  it('a hunter is hit in the head and the body by its own table, turned by its yaw', () => {
    const shape = hunterShape(HunterKind.Rifleman, HunterAct.Idle);
    const t = { id: 'h1', x: 0, y: 0, z: -10, crouch: 0, yaw: 0, shape };
    // Straight at the head height (1.55 m), from 10 m away.
    expect(rayHitbox(0, 1.55, 0, 0, 0, -1, t, 50)).toMatchObject({ head: true });
    expect(rayHitbox(0, 0.8, 0, 0, 0, -1, t, 50)).toMatchObject({ head: false });
    // Above the hat: nothing; beside the body: nothing.
    expect(rayHitbox(0, 2.1, 0, 0, 0, -1, t, 50)).toBeNull();
    expect(rayHitbox(0.5, 0.8, 0, 0, 0, -1, t, 50)).toBeNull();
    // A duck's table would miss a hunter's head (taller): the tables are separate.
    expect(rayHitbox(0, 1.68, 0, 0, 0, -1, t, 50)).toMatchObject({ head: true });
    expect(rayHitbox(0, 1.68, 0, 0, 0, -1, { id: 'd', x: 0, y: 0, z: -10, crouch: 0 }, 50)).toBeNull();
  });

  it('the dog lies along its facing, the boss is big', () => {
    const dog = hunterShape(HunterKind.Dog, HunterAct.Run);
    // Facing -z (yaw 0): its head is 0.48 m ahead (toward the shooter at z = 0).
    const t = { id: 'h2', x: 0, y: 0, z: -10, crouch: 0, yaw: 0, shape: dog };
    expect(rayHitbox(0, 0.85, 0, 0, 0, -1, t, 50)).toMatchObject({ head: true });
    // A ray from the side through its body at 0.6 m.
    expect(rayHitbox(-5, 0.6, -10.1, 1, 0, 0, t, 50)).toMatchObject({ head: false });
    // Turned a quarter: the body runs along x now, so the side ray at z = -10.3 still hits it.
    const turned = { ...t, yaw: Math.PI / 2 };
    expect(rayHitbox(-5, 0.6, -10, 1, 0, 0, turned, 50)).not.toBeNull();
    const boss = hunterShape(HunterKind.Boss, HunterAct.Aim);
    expect(rayHitbox(0, 1.92, 0, 0, 0, -1, { id: 'b', x: 0, y: 0, z: -10, crouch: 0, yaw: 0, shape: boss }, 50)).toMatchObject({ head: true });
    expect(rayHitbox(0.33, 1.0, 0, 0, 0, -1, { id: 'b', x: 0, y: 0, z: -10, crouch: 0, yaw: 0, shape: boss }, 50)).not.toBeNull();
  });
});
