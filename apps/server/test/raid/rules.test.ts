/**
 * Hunt Season rules, headless on Pond Keep with its navmesh: the stages (v3:
 * the push's objectives in order, the break, the win), the fail rule, a lone
 * duck's second wind, the upgrades (server only numbers, no sim change), the
 * trap root and the hunters' sight (never through walls). The katana's hits
 * are in blade.test.ts, the keep's moving parts in keep.test.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Button, COMBAT, createPlayerSim, emptyInput, exRoot, Goal, groundHeightAt, hasHeadroom, HunterKind, isBladeDuck, RAID, RaidEndReason, RaidStage, SIGHT_QUERY_GROUPS, stepPlayer, TICK_RATE, Upgrade, WeaponId } from '@qwakk/shared';
import type { BotLike, Seat } from '../../src/arena.ts';
import { headlessRaid, keepNav, type HeadlessRaid } from '../../bench/raidHeadless.ts';
import { KIND } from '../../src/raid/hunter.ts';
import { sees } from '../../src/raid/sight.ts';

/** A duck that stands still and does nothing (a bot seat with an empty frame). */
const still = (): BotLike => {
  const f = emptyInput();
  return { think: () => f, respawned: () => undefined, damagedFrom: () => undefined };
};

/** A run with `ducks` still bot ducks; the push sends no packs (quiet) unless `packs`. */
async function raidOf(ducks: number, rules = {}, packs = false): Promise<HeadlessRaid> {
  const h = await headlessRaid({ ducks: 0, rules });
  for (let i = 0; i < ducks; i++) h.raid.addBotDuck(still());
  h.raid.push.quiet = !packs;
  h.raid.beginTick(0, 0);
  return h;
}

beforeAll(async () => {
  await keepNav();
}, 180_000);

describe('stages', () => {
  it('counts the lobby down from the first duck, more ducks add a little, then objective 1 starts', async () => {
    const h = await raidOf(0, { lobbySeconds: 10 });
    expect(h.raid.stage).toBe(RaidStage.Lobby);
    expect(h.raid.stageTicks).toBe(-1);
    h.raid.addBotDuck(still());
    expect(h.raid.stageTicks).toBe(10 * TICK_RATE);
    h.raid.addBotDuck(still());
    expect(h.raid.stageTicks).toBe(10 * TICK_RATE + RAID.joinExtraSeconds * TICK_RATE);
    h.raid.addBotDuck(still());
    h.raid.addBotDuck(still());
    expect(h.raid.stageTicks).toBe(RAID.fullLobbySeconds * TICK_RATE);
    expect(h.raid.addBotDuck(still())).toBeNull(); // four is the most
    h.run(RAID.fullLobbySeconds + 0.1);
    expect(h.raid.stage).toBe(RaidStage.Fight);
    expect(h.raid.wave).toBe(1);
    expect(h.raid.push.goal).toBe(Goal.Trench);
    expect(h.raid.locked).toBe(true);
  });

  it('every duck carries the katana (in hand) and the pistol, never the rifle or grenades', async () => {
    const h = await raidOf(2);
    h.raid.skipTo(1);
    for (const s of h.raid.seats.values()) {
      expect(isBladeDuck(s.sim)).toBe(true);
      expect(s.sim.weapon).toBe(WeaponId.Katana);
      expect(s.sim.arms & (1 << WeaponId.Rifle)).toBe(0);
      expect(s.sim.arms & (1 << WeaponId.Pistol)).not.toBe(0);
      expect(s.sim.ex & 0x7ffff).toBe(0);
    }
  });

  it('the objectives go in order, each by its own rule: the trench (kills on its ground), the crates, the towers (their snipers), the camp (the Big Hunter)', async () => {
    const h = await raidOf(1, { breakSeconds: 1 });
    const raid = h.raid;
    const seat = [...raid.seats.values()][0]!;
    raid.skipTo(1);
    const p = raid.push;
    expect(p.need).toBe(raid.rules.push.trenchKills);
    // Kills away from the trench do not count; on its ground they do.
    const far = raid.hunts.spawnForTest(HunterKind.Beater, -80, -60);
    raid.hunts.hurt(far.id, 999, seat.id, false, 0, 0);
    expect(p.done).toBe(0);
    for (let i = 0; i < p.need; i++) {
      const m = raid.hunts.spawnForTest(HunterKind.Recruit, p.rally.x + (i % 5), p.rally.z + Math.floor(i / 5));
      raid.hunts.hurt(m.id, 999, seat.id, false, 0, 0);
    }
    h.run(0.1);
    expect(raid.stage).toBe(RaidStage.Break);
    h.run(1.2);
    expect(raid.wave).toBe(2);
    expect(p.goal).toBe(Goal.Crates);
    const crates = [...p.targets.values()];
    expect(crates).toHaveLength(raid.rules.push.crates);
    for (const c of crates) expect(p.hitCrate(c.id, 99999)).toBe(true);
    h.run(0.1);
    h.run(1.2);
    expect(p.goal).toBe(Goal.Towers);
    const snipers = [...raid.hunts.hunters.values()].filter((x) => x.kind === HunterKind.Sniper);
    expect(snipers).toHaveLength(2 * raid.rules.push.snipersPerTower);
    for (const s of snipers) expect(s.perchFixed).toBe(true);
    // Riflemen at the towers do not count; the snipers do.
    for (const r of [...raid.hunts.hunters.values()].filter((x) => x.kind === HunterKind.Rifleman)) raid.hunts.hurt(r.id, 9999, seat.id, false, 0, 0);
    expect(p.done).toBe(0);
    for (const s of snipers) raid.hunts.hurt(s.id, 9999, seat.id, false, 0, 0);
    h.run(0.1);
    h.run(1.2);
    expect(p.goal).toBe(Goal.Camp);
    const boss = raid.hunts.boss!;
    expect(boss).toBeTruthy();
    expect(Math.hypot(boss.x - p.rally.x, boss.z - p.rally.z)).toBeLessThan(4);
    raid.hunts.hurt(boss.id, 99999, seat.id, false, 0, 0);
    h.run(0.1);
    expect(raid.stage).toBe(RaidStage.Won);
    expect(raid.endReason).toBe(RaidEndReason.Won);
    const d = raid.ducks.get(seat.id)!;
    expect(d.wavesCleared).toBe(RAID.objectives);
    expect(d.bossKills).toBe(1);
  });

  it('packs of 6 to 12 minions come with ringed elites; a taken objective scatters the rest (no kills, no drops)', async () => {
    const h = await raidOf(1, {}, true);
    h.raid.skipTo(1);
    h.run(2);
    const minions = [...h.raid.hunts.hunters.values()].filter((x) => x.kind === HunterKind.Beater || x.kind === HunterKind.Recruit);
    expect(minions.length).toBeGreaterThanOrEqual(6);
    expect(minions.length).toBeLessThanOrEqual(12);
    for (const m of minions) expect(m.elite).toBe(false);
    for (const e of [...h.raid.hunts.hunters.values()].filter((x) => !minions.includes(x))) expect(e.elite).toBe(true);
    const kills = h.raid.teamKills;
    h.raid.defeatWave();
    h.run(0.1);
    expect(h.raid.hunts.alive).toBe(0);
    expect(h.raid.teamKills).toBe(kills);
    expect(h.raid.hunts.drops.size).toBe(0);
  });

  it('never has more hunters alive than the cap for the ducks in the run (solo about half of raid.maxLive)', async () => {
    const h = await raidOf(1, { maxLive: 40 }, true);
    h.raid.skipTo(1);
    let most = 0;
    h.run(60, (r) => ((most = Math.max(most, r.hunts.alive)), false));
    expect(h.raid.hunts.liveCap).toBe(22);
    expect(most).toBeLessThanOrEqual(22);
    expect(most).toBeGreaterThan(12);
  });

  it('a small raid.maxLive or a big raid.waveScale shrinks an oversize pack instead of stopping the packs (the trench still falls)', async () => {
    for (const [ducks, rules] of [[4, { maxLive: 11 }], [1, { maxLive: 5, waveScale: 1.5 }]] as const) {
      const h = await raidOf(ducks, rules, true);
      h.raid.skipTo(1);
      const cap = h.raid.hunts.liveCap;
      let most = 0;
      let rounds = 0;
      // Packs come, run to the trench and are bagged there, until the trench is taken.
      while (h.raid.push.index === 1 && rounds < 80) {
        h.run(5, (r) => ((most = Math.max(most, r.hunts.alive)), false));
        h.raid.hunts.defeatAll(null);
        rounds++;
      }
      expect(most, JSON.stringify(rules)).toBeGreaterThan(0);
      expect(most, JSON.stringify(rules)).toBeLessThanOrEqual(cap);
      expect(h.raid.push.index, JSON.stringify(rules)).not.toBe(1);
    }
  }, 120_000);

  it('the default break is 8 s', () => {
    expect(RAID.breakSeconds).toBe(8);
  });
});

describe('losing', () => {
  it('the core no longer ends a run; all ducks down at once does; a knocked duck can be revived by holding Use', async () => {
    const h = await raidOf(2);
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    h.raid.keep.damageCore(99999);
    h.run(0.1);
    expect(h.raid.over).toBe(false);
    const [a, b] = [...h.raid.seats.values()];
    // B is knocked: the run goes on while A stands.
    h.raid.hurtDuck(b!.id, 500, 0, 0, HunterKind.Rifleman, false);
    expect(b!.sim.down).toBe(1);
    expect(h.raid.over).toBe(false);
    // A walks over and holds Use: B is back up after the revive time.
    Object.assign(a!.sim, { x: b!.sim.x + 1, y: b!.sim.y, z: b!.sim.z });
    const hold = { ...emptyInput(), buttons: Button.Use };
    let up = false;
    for (let i = 0; i < 6 * TICK_RATE && !up; i++) {
      h.raid.beginTick(1000 + i, (1000 + i) * 33);
      h.raid.applyInput(a!, { ...hold, yaw: a!.sim.yaw }, 0);
      up = b!.sim.down === 0;
    }
    expect(up).toBe(true);
    expect(h.raid.ducks.get(a!.id)!.revives).toBe(1);
    h.raid.hurtDuck(a!.id, 500, 0, 0, HunterKind.Dog, false);
    h.raid.hurtDuck(b!.id, 500, 0, 0, HunterKind.Dog, false);
    expect(h.raid.stage).toBe(RaidStage.Lost);
    expect(h.raid.endReason).toBe(RaidEndReason.AllDown);
  });

  it('a duck out at a break comes back beside a friend still standing', async () => {
    const h = await raidOf(2, { breakSeconds: 2 });
    h.raid.skipTo(1);
    const [a, b] = [...h.raid.seats.values()];
    Object.assign(a!.sim, { x: 40, z: 60, y: 3 });
    h.raid.hurtDuck(b!.id, 500, 0, 0, HunterKind.Dog, false);
    h.raid.hurtDuck(b!.id, 500, 0, 0, HunterKind.Dog, false);
    expect(b!.sim.alive).toBe(0);
    h.raid.defeatWave();
    h.run(0.1);
    expect(b!.sim.alive).toBe(1);
    expect(Math.hypot(b!.sim.x - a!.sim.x, b!.sim.z - a!.sim.z)).toBeLessThan(4);
    expect(b!.sim.weapon).toBe(WeaponId.Katana);
  });

  it('the spot beside a friend is never in a wall, off a parapet or across one (checked around the whole castle)', async () => {
    const h = await raidOf(1);
    const sim = h.sim;
    let tried = 0;
    let placed = 0;
    for (let x = -21; x <= 21; x += 1.5) {
      for (let z = -21; z <= 21; z += 1.5) {
        const y0 = groundHeightAt(sim, x, 14, z);
        if (!(y0 > -5) || !hasHeadroom(sim, x, y0, z)) continue;
        // Where a friend can stand: it settles there and stays.
        const f = createPlayerSim(x, y0, z);
        for (let i = 0; i < 30; i++) stepPlayer(sim, f, emptyInput());
        if (Math.hypot(f.x - x, f.z - z) > 0.2 || Math.abs(f.y - y0) > 0.3 || !f.grounded) continue;
        const y = f.y;
        for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          for (const pid of [1, 2, 3, 4]) {
            tried++;
            const spot = h.raid.besideFriend({ pid } as Seat, { x, y, z, yaw });
            if (!spot) continue;
            placed++;
            expect(hasHeadroom(sim, spot.x, spot.y, spot.z), `${x},${y},${z}`).toBe(true);
            expect(Math.abs(spot.y - y), `${x},${y},${z}`).toBeLessThan(0.8);
            // Standing there for a second it neither drops nor gets pushed out of geometry.
            const d = createPlayerSim(spot.x, spot.y, spot.z, yaw);
            for (let i = 0; i < 30; i++) stepPlayer(sim, d, emptyInput());
            expect(Math.hypot(d.x - spot.x, d.z - spot.z), `${x},${y},${z}`).toBeLessThan(0.3);
            expect(Math.abs(d.y - spot.y), `${x},${y},${z}`).toBeLessThan(0.6);
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(1000);
    expect(placed / tried).toBeGreaterThan(0.9);
  }, 120_000);
});

describe('a lone duck', () => {
  it('gets a second wind once an objective: knocked alone is not lost, holding Use gets it up; the next knock is', async () => {
    const h = await raidOf(1);
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    const seat = [...h.raid.seats.values()][0]!;
    h.raid.hurtDuck(seat.id, 500, 0, 0, HunterKind.Dog, false);
    expect(seat.sim.down).toBe(1);
    expect(h.raid.over).toBe(false);
    const { SELF_REVIVE_TICKS } = await import('../../src/raid/raid.ts');
    for (let i = 0; i <= SELF_REVIVE_TICKS && seat.sim.down; i++) {
      h.raid.beginTick(2000 + i, (2000 + i) * 33);
      h.raid.applyInput(seat, { ...emptyInput(), buttons: Button.Use, yaw: seat.sim.yaw }, 0);
    }
    expect(seat.sim.down).toBe(0);
    h.raid.hurtDuck(seat.id, 500, 0, 0, HunterKind.Dog, false);
    expect(h.raid.stage).toBe(RaidStage.Lost);
  });
});

describe('upgrades (server only)', () => {
  it('a pick is checked against the offer, applies once, and changes only server numbers', async () => {
    const h = await raidOf(1, { breakSeconds: 5 });
    const raid = h.raid;
    const seat = [...raid.seats.values()][0]!;
    expect(raid.pick(seat.id, 0)).toBe(false); // no break yet
    raid.skipTo(1);
    raid.defeatWave();
    h.run(0.1);
    const d = raid.ducks.get(seat.id)!;
    d.offer = { cards: [Upgrade.MaxHealth, Upgrade.Armor, Upgrade.Damage], picked: false };
    for (const bad of [-1, 3, 1.5, '0', null]) expect(raid.pick(seat.id, bad)).toBe(false);
    expect(raid.pick(seat.id, 0)).toBe(true);
    expect(raid.pick(seat.id, 1)).toBe(false); // one per break
    expect(d.stats.maxHp).toBe(COMBAT.maxHp + raid.rules.upgrade.maxHealth);
    // Armor: less damage from hunters.
    d.upgrades.add(Upgrade.Armor);
    d.upgrades.add(Upgrade.Armor);
    const { duckStats } = await import('../../src/raid/upgrades.ts');
    d.stats = duckStats(d.upgrades, raid.rules.upgrade);
    raid.endBreakNow();
    h.run(0.1);
    raid.hunts.clear();
    seat.sim.hp = 100;
    raid.hurtDuck(seat.id, 50, 0, 0, HunterKind.Rifleman, false);
    expect(seat.sim.hp).toBe(100 - Math.round(50 * (1 - 2 * raid.rules.upgrade.armorPercent / 100)));
  });

  it('an unpicked offer is picked at random when the break ends', async () => {
    const h = await raidOf(1, { breakSeconds: 2 });
    h.raid.skipTo(1);
    h.raid.defeatWave();
    h.run(2.5);
    const d = [...h.raid.ducks.values()][0]!;
    expect(d.upgrades.list()).toHaveLength(1);
  });

  it('the damage card makes pistol bullets hit hunters harder', async () => {
    const h = await raidOf(1);
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    const seat = [...h.raid.seats.values()][0]!;
    const d = h.raid.ducks.get(seat.id)!;
    const shoot = (): number => {
      const x = h.raid.hunts.spawnForTest(HunterKind.Trapper, seat.sim.x, seat.sim.z - 6);
      x.yaw = 0;
      const before = x.hp;
      const hitOther = (h.raid as unknown as { hitOther: (s: unknown, r: unknown, w: number) => void }).hitOther.bind(h.raid);
      hitOther(seat, { outcome: 2, targetId: x.id, distance: 6 }, 0);
      h.raid.hunts.clear();
      return before - x.hp;
    };
    const base = shoot();
    d.upgrades.add(Upgrade.Damage);
    const { duckStats } = await import('../../src/raid/upgrades.ts');
    d.stats = duckStats(d.upgrades, h.raid.rules.upgrade);
    expect(shoot()).toBeCloseTo(base * (1 + h.raid.rules.upgrade.damagePercent / 100), 5);
  });
});

/**
 * A spot pair on the map with a solid wall between: `a` on open ground, the
 * wall 2 to 6 m along +x at every height from the knees up, and `b` on the
 * ground just past the wall (about as high as `a`), hidden from `a`.
 */
function wallPair(sim: import('@qwakk/shared').SimWorld): { a: { x: number; z: number }; b: { x: number; z: number }; gy: (x: number, z: number) => number } {
  const gy = (x: number, z: number) => {
    const hit = sim.world.castRay(new sim.rapier.Ray({ x, y: 40, z }, { x: 0, y: -1, z: 0 }), 80, true);
    return 40 - (hit?.timeOfImpact ?? 40);
  };
  for (let x = -60; x <= 60; x += 3) {
    for (let z = -60; z <= 60; z += 3) {
      const y = gy(x, z);
      const hits = [0.4, 0.9, 1.4, 1.9, 2.4].map((dy) => sim.world.castRay(new sim.rapier.Ray({ x, y: y + dy, z }, { x: 1, y: 0, z: 0 }), 12, true, undefined, SIGHT_QUERY_GROUPS));
      if (hits.some((r) => !r)) continue;
      const t = Math.max(...hits.map((r) => r!.timeOfImpact));
      if (!(t > 2 && t < 6 && hits.every((r) => Math.abs(r!.timeOfImpact - t) < 0.4))) continue;
      for (let off = t + 0.8; off < t + 7; off += 0.5) {
        const bx = x + off;
        const by = gy(bx, z);
        if (Math.abs(by - y) > 0.6) continue;
        const back = sim.world.castRay(new sim.rapier.Ray({ x: bx, y: by + 1.2, z }, { x: -1, y: 0, z: 0 }), off, true, undefined, SIGHT_QUERY_GROUPS);
        if (back) return { a: { x, z }, b: { x: bx, z }, gy };
      }
    }
  }
  throw new Error('no wall pair on the map');
}

describe('traps and sight', () => {
  it('an armed trap roots the duck that steps in (the root is sim state, counted down by the sim)', async () => {
    const h = await raidOf(1);
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    const seat = [...h.raid.seats.values()][0]!;
    const hunts = h.raid.hunts as unknown as { placeTrap: (o: unknown, x: number, y: number, z: number, t: number) => void };
    const owner = h.raid.hunts.spawnForTest(HunterKind.Trapper, seat.sim.x + 3, seat.sim.z);
    hunts.placeTrap(owner, seat.sim.x, seat.sim.y, seat.sim.z, h.raid.currentTick);
    owner.hp = -1;
    h.raid.hunts.hunters.delete(owner.id);
    h.run(1.2);
    expect(exRoot(seat.sim)).toBeGreaterThan(0);
    expect([...h.raid.hunts.traps.values()][0]?.state).toBe(2);
  });

  it('a hunter never sees (or shoots) a duck through a wall', async () => {
    const h = await raidOf(1);
    const sim = h.raid.world;
    const pair = wallPair(sim);
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    const seat = [...h.raid.seats.values()][0]!;
    const hunter = h.raid.hunts.spawnForTest(HunterKind.Rifleman, pair.a.x, pair.a.z);
    hunter.yaw = -Math.PI / 2; // facing +x, toward the duck
    const place = () => Object.assign(seat.sim, { x: pair.b.x, y: pair.gy(pair.b.x, pair.b.z), z: pair.b.z, vx: 0, vy: 0, vz: 0 });
    place();
    const duck = { id: seat.id, pid: seat.pid, x: seat.sim.x, y: seat.sim.y, z: seat.sim.z, vx: 0, vz: 0, crouch: 0, standing: true };
    const visible = sees(sim, hunter, KIND[HunterKind.Rifleman]!, duck);
    // Whatever the hunter does for 8 s, the duck behind the wall is never hurt while it cannot be seen.
    const hp = seat.sim.hp;
    let hurt = false;
    for (let i = 0; i < 8 * TICK_RATE; i++) {
      place();
      h.run(1 / TICK_RATE);
      if (seat.sim.hp < hp) hurt = true;
      hunter.x = pair.a.x;
      hunter.z = pair.a.z;
    }
    expect(visible).toBe(false);
    expect(hurt).toBe(false);
    expect(hunter.targetId).toBeNull();
  });
});

describe('hunters and hidden ducks', () => {
  it('a duck that goes behind a wall is chased to where it was last seen, never to where it is', async () => {
    const h = await raidOf(1);
    const sim = h.raid.world;
    const { a, b, gy } = wallPair(sim);
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    const seat = [...h.raid.seats.values()][0]!;
    // In the open first: on the hunter's side of the wall, 10 to 14 m off, somewhere it can see.
    const hunter = h.raid.hunts.spawnForTest(HunterKind.Trapper, a.x, a.z);
    const k = KIND[HunterKind.Trapper]!;
    let seen: { x: number; z: number } | null = null;
    for (const [dx, dz] of [[-12, 0], [0, 12], [0, -12], [-9, 9], [-9, -9], [-14, 0]] as const) {
      const p = { x: a.x + dx, z: a.z + dz };
      const duck = { id: seat.id, pid: seat.pid, x: p.x, y: gy(p.x, p.z), z: p.z, vx: 0, vz: 0, crouch: 0, standing: true };
      hunter.yaw = Math.atan2(-(p.x - hunter.x), -(p.z - hunter.z));
      if (sees(sim, hunter, k, duck)) {
        seen = p;
        break;
      }
    }
    expect(seen).not.toBeNull();
    const put = (p: { x: number; z: number }) => Object.assign(seat.sim, { x: p.x, y: gy(p.x, p.z), z: p.z, vx: 0, vy: 0, vz: 0 });
    for (let i = 0; i < 12; i++) {
      put(seen!);
      h.run(1 / TICK_RATE);
    }
    expect(hunter.targetId).toBe(seat.id);
    const last = { ...hunter.lastSeen! };
    // Now behind the wall: the hunter's goal stays at the last seen point.
    let closest = Infinity;
    for (let i = 0; i < 60; i++) {
      put(b);
      h.run(1 / TICK_RATE);
      const g = hunter.mover.target;
      if (g) closest = Math.min(closest, Math.hypot(g.x - b.x, g.z - b.z));
      if (hunter.lostTicks > 0 && g) expect(Math.hypot(g.x - last.x, g.z - last.z)).toBeLessThan(0.01);
    }
    expect(closest).toBeGreaterThan(3);
    expect(seat.sim.hp).toBe(100);
  });

  it("the Big Hunter's second barrel checks the line again", async () => {
    const shots: number[] = [];
    const h = await headlessRaid({ ducks: 0, events: { hunterShot: () => void shots.push(1) } });
    h.raid.addBotDuck(still());
    h.raid.push.quiet = true;
    h.raid.beginTick(0, 0);
    const sim = h.raid.world;
    const { a, b, gy } = wallPair(sim);
    h.raid.skipTo(1);
    h.raid.hunts.clear();
    const seat = [...h.raid.seats.values()][0]!;
    const boss = h.raid.hunts.spawnForTest(HunterKind.Boss, a.x, a.z);
    Object.assign(seat.sim, { x: b.x, y: gy(b.x, b.z), z: b.z });
    // Mid double barrel, the duck now behind the wall: the second blast does not come.
    Object.assign(boss, { phase: 'fire', phaseTicks: 1, targetId: seat.id, lostTicks: 0, lastSeen: { x: b.x, y: seat.sim.y, z: b.z }, whistleCd: 999 });
    h.run(1 / TICK_RATE);
    expect(shots).toHaveLength(0);
    expect(seat.sim.hp).toBe(100);
  });
});

describe('the Big Hunter', () => {
  it('its whistle respects the hunters-at-once cap and its helpers give no XP or drops', async () => {
    let whistles = 0;
    const h = await headlessRaid({ ducks: 0, rules: { maxLive: 9 }, events: { whistle: () => void whistles++ } });
    h.raid.addBotDuck(still());
    h.raid.push.quiet = true;
    h.raid.beginTick(0, 0);
    h.raid.skipTo(4);
    h.raid.hunts.clear();
    const seat = [...h.raid.seats.values()][0]!;
    // The duck far off in a corner of the mainland; the boss and two riflemen out on the other side.
    Object.assign(seat.sim, { x: -100, y: 30, z: -100 });
    const boss = h.raid.hunts.spawnForTest(HunterKind.Boss, 0, 60);
    h.raid.hunts.spawnForTest(HunterKind.Rifleman, 3, 60);
    h.raid.hunts.spawnForTest(HunterKind.Rifleman, -3, 60);
    boss.whistleCd = 0;
    h.run(3, () => whistles > 0);
    expect(whistles).toBe(1);
    h.run(0.2);
    // Solo, the cap is about half of raid.maxLive (at least 6): the helpers never pass it.
    expect(h.raid.hunts.liveCap).toBe(6);
    expect(h.raid.hunts.alive).toBeLessThanOrEqual(6);
    // A helper bagged by the duck: no kill XP, no drop.
    const dog = h.raid.hunts.spawnForTest(HunterKind.Dog, 10, 60);
    dog.helper = true;
    const d = h.raid.ducks.get(seat.id)!;
    const kills = d.kills;
    const drops = h.raid.hunts.drops.size;
    h.raid.hunts.hurt(dog.id, 9999, seat.id, false, 0, 0);
    expect(d.kills).toBe(kills);
    expect(h.raid.hunts.drops.size).toBe(drops);
  });
});

describe('the lobby clock', () => {
  it('never runs past the cap from its first start, however a duck leaves and joins again', async () => {
    const h = await raidOf(0, { lobbySeconds: 15 });
    h.raid.addBotDuck(still());
    const start = h.raid.currentTick;
    const cap = Math.max(15, RAID.lobbyMaxSeconds) * TICK_RATE;
    for (let i = 0; i < 40 && h.raid.stage === RaidStage.Lobby; i++) {
      const extra = h.raid.addBotDuck(still());
      expect(h.raid.currentTick + h.raid.stageTicks).toBeLessThanOrEqual(start + cap + 1);
      h.run(0.5);
      if (extra) h.raid.remove(extra.id);
    }
    h.run(RAID.lobbyMaxSeconds + 1);
    expect(h.raid.stage).toBe(RaidStage.Fight);
    expect(h.raid.startTick - start).toBeLessThanOrEqual(cap + 1);
  });
});
