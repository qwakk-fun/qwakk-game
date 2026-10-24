/**
 * Hunt Season shared code: the wave math, the boss schedule, XP and levels,
 * the upgrade offer, the trap root in the sim (and that it stays
 * deterministic), and the hunters' own hitboxes.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createPlayerSim,
  createSimWorld,
  exRoot,
  generateMap,
  HUNTER_HP,
  hunterHpScale,
  HunterAct,
  HunterKind,
  hunterShape,
  initPhysics,
  isBossWave,
  LEVEL_CAP,
  levelOfXp,
  MAX_SNIPERS,
  levelProgress,
  packEx,
  PLAYER_SIM_FIELDS,
  RAID,
  RAID_XP,
  raidXp,
  rayHitbox,
  rollOffer,
  setNades,
  setRoot,
  spawnGapSeconds,
  stepPlayer,
  tickRoot,
  unpackEx,
  Upgrade,
  waveComposition,
  waveTotal,
  xpForLevel,
  xpToNext,
  type InputFrame,
} from '../src/index.ts';

beforeAll(async () => {
  await initPhysics();
});

describe('waves', () => {
  it('opens with riflemen and brings the kinds in one by one', () => {
    expect(waveComposition(1, 1)).toEqual({ rifleman: 4, trapper: 0, decoy: 0, dog: 0, sniper: 0, boss: 0 });
    expect(waveComposition(2, 1).dog).toBe(3);
    expect(waveComposition(2, 1).sniper).toBe(1);
    expect(waveComposition(2, 1).trapper).toBe(0);
    expect(waveComposition(3, 1).trapper).toBeGreaterThan(0);
    expect(waveComposition(3, 1).decoy).toBe(0);
    expect(waveComposition(4, 1).decoy).toBeGreaterThan(0);
    for (let w = 1; w <= RAID.waves; w++) for (let d = 1; d <= 4; d++) {
      expect(waveComposition(w, d).dog % 3).toBe(0);
      expect(waveComposition(w, d).sniper).toBeLessThanOrEqual(MAX_SNIPERS);
    }
  });

  it('is 10 waves with the Big Hunter on waves 3, 6 and 10 only', () => {
    expect(RAID.waves).toBe(10);
    const boss = [];
    for (let w = 1; w <= RAID.waves; w++) {
      expect(waveComposition(w, 2).boss).toBe(isBossWave(w) ? 1 : 0);
      if (isBossWave(w)) boss.push(w);
    }
    expect(boss).toEqual([3, 6, 10]);
    expect(isBossWave(0)).toBe(false);
    expect(isBossWave(5)).toBe(false);
  });

  it('grows with the wave and with the ducks: more hunters than v1, lighter ones', () => {
    for (let d = 1; d <= 4; d++) {
      let last = 0;
      for (let w = 1; w <= RAID.waves; w++) {
        if (isBossWave(w)) continue;
        const n = waveTotal(waveComposition(w, d));
        expect(n).toBeGreaterThanOrEqual(last);
        last = n;
      }
    }
    for (let w = 1; w <= RAID.waves; w++) {
      expect(waveTotal(waveComposition(w, 4))).toBeGreaterThan(waveTotal(waveComposition(w, 1)));
      expect(waveTotal(waveComposition(w, 2))).toBeGreaterThanOrEqual(waveTotal(waveComposition(w, 1)));
    }
    // A solo run is about 150 hunters over 10 waves (v1: about 150 over 15); four ducks stay under 70 a wave.
    let solo = 0;
    for (let w = 1; w <= RAID.waves; w++) solo += waveTotal(waveComposition(w, 1));
    expect(solo).toBeGreaterThan(130);
    expect(solo).toBeLessThan(180);
    expect(waveTotal(waveComposition(10, 4))).toBeLessThan(70);
    expect(HUNTER_HP[HunterKind.Rifleman]).toBeLessThan(90);
    expect(hunterHpScale(10, 1, HunterKind.Rifleman)).toBeGreaterThan(hunterHpScale(1, 1, HunterKind.Rifleman));
    expect(hunterHpScale(6, 4, HunterKind.Boss)).toBeGreaterThan(hunterHpScale(6, 1, HunterKind.Boss));
  });

  it('spawns faster in later waves', () => {
    expect(spawnGapSeconds(10)).toBeLessThan(spawnGapSeconds(1));
    expect(spawnGapSeconds(10)).toBeGreaterThanOrEqual(0.6);
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

  it('grants XP for waves, kills, bosses, revives and the win, within the cap', () => {
    expect(raidXp({ wavesCleared: 0, kills: 0, bossKills: 0, revives: 0, won: false })).toBe(0);
    expect(raidXp({ wavesCleared: 1, kills: 0, bossKills: 0, revives: 0, won: false })).toBe(RAID_XP.perWave);
    expect(raidXp({ wavesCleared: 2, kills: 3, bossKills: 0, revives: 1, won: false })).toBe(RAID_XP.perWave * 2 + RAID_XP.perWaveStep + 3 * RAID_XP.perKill + RAID_XP.perRevive);
    const win = raidXp({ wavesCleared: 10, kills: 120, bossKills: 3, revives: 4, won: true });
    expect(win).toBeGreaterThan(raidXp({ wavesCleared: 10, kills: 120, bossKills: 3, revives: 4, won: false }));
    expect(win).toBeLessThanOrEqual(RAID_XP.maxPerRun);
    expect(raidXp({ wavesCleared: 10, kills: 99999, bossKills: 3, revives: 999, won: true })).toBe(RAID_XP.maxPerRun);
    // A first win lifts a fresh duck several levels, not to the cap.
    expect(levelOfXp(win)).toBeGreaterThan(3);
    expect(levelOfXp(win)).toBeLessThan(12);
  });
});

describe('XP retune (Pond Keep, 10 waves)', () => {
  it('a full solo win with every hunter bagged is about what a 15 wave v1 win was (about 2,400), so more per minute', () => {
    let hunters = 0;
    for (let w = 1; w <= RAID.waves; w++) {
      const c = waveComposition(w, 1);
      hunters += waveTotal(c) - c.boss;
    }
    const v2 = raidXp({ wavesCleared: RAID.waves, kills: hunters + 3, bossKills: 3, revives: 0, won: true });
    expect(v2).toBeGreaterThan(2300);
    expect(v2).toBeLessThan(2800);
    // v1: 15 waves of 40 + 4 per wave number, about 150 hunters at 4, 3 bosses at 120, the win 400, in 12 to 18 minutes.
    let v1 = 0;
    for (let w = 1; w <= 15; w++) v1 += 40 + 4 * (w - 1);
    v1 += 150 * 4 + 3 * 120 + 400;
    // A v2 run is about 8 to 10 minutes: per minute it gives more than v1 did.
    expect(v2 / 10).toBeGreaterThan(v1 / 12);
  });
});

describe('upgrade offer', () => {
  it('rolls three different cards, never a maxed one, the repair kit only for a hurt core', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const o = rollOffer(rand, { coreHurt: false, maxed: new Set([Upgrade.Damage]) });
      expect(o).toHaveLength(3);
      expect(new Set(o).size).toBe(3);
      expect(o).not.toContain(Upgrade.Repair);
      expect(o).not.toContain(Upgrade.Damage);
    }
    let repair = 0;
    for (let i = 0; i < 300; i++) if (rollOffer(rand, { coreHurt: true }).includes(Upgrade.Repair)) repair++;
    expect(repair).toBeGreaterThan(0);
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
