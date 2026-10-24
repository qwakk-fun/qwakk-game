/**
 * Hunt Season rules, headless on Pond Keep with its navmesh: the stages, the
 * core and the fail and win rules, the boss schedule, the upgrades (server
 * only numbers, no sim change), the trap root and the hunters' sight (never
 * through walls). The keep's moving parts are in keep.test.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Button, COMBAT, emptyInput, exRoot, HunterKind, RAID, RaidEndReason, RaidStage, SIGHT_QUERY_GROUPS, TICK_RATE, Upgrade } from '@qwakk/shared';
import type { BotLike } from '../../src/arena.ts';
import { headlessRaid, keepNav, type HeadlessRaid } from '../../bench/raidHeadless.ts';
import { KIND } from '../../src/raid/hunter.ts';
import { sees } from '../../src/raid/sight.ts';

/** A duck that stands still and does nothing (a bot seat with an empty frame). */
const still = (): BotLike => {
  const f = emptyInput();
  return { think: () => f, respawned: () => undefined, damagedFrom: () => undefined };
};

async function raidOf(ducks: number, rules = {}): Promise<HeadlessRaid> {
  const h = await headlessRaid({ ducks: 0, rules });
  for (let i = 0; i < ducks; i++) h.raid.addBotDuck(still());
  h.raid.beginTick(0, 0);
  return h;
}

beforeAll(async () => {
  await keepNav();
}, 180_000);

describe('stages', () => {
  it('counts the lobby down from the first duck, more ducks add a little, then wave 1 starts', async () => {
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
    expect(h.raid.stage).toBe(RaidStage.Wave);
    expect(h.raid.wave).toBe(1);
    expect(h.raid.locked).toBe(true);
  });

  it('sends the Big Hunter on waves 3, 6 and 10 only', async () => {
    const h = await raidOf(1);
    for (const w of [2, 3, 5, 6, 10]) {
      h.raid.skipTo(w);
      h.run(8);
      const boss = [...h.raid.hunts.hunters.values()].some((x) => x.kind === HunterKind.Boss);
      expect(boss, `wave ${w}`).toBe(w === 3 || w === 6 || w === 10);
    }
  });

  it('a cleared wave gives a short break with cards, then the next wave; wave 10 cleared is a win', async () => {
    const h = await raidOf(2, { breakSeconds: 3 });
    const offers: number[][] = [];
    h.raid.skipTo(9);
    (h.raid as unknown as { rev: { offer: (s: unknown, c: [number, number][] | null) => void } }).rev.offer = (_s, c) => void (c && offers.push(c.map((x) => x[0])));
    h.raid.defeatWave();
    h.run(0.2);
    expect(h.raid.stage).toBe(RaidStage.Break);
    expect(offers).toHaveLength(2);
    for (const o of offers) expect(new Set(o).size).toBe(3);
    h.run(3.5);
    expect(h.raid.stage).toBe(RaidStage.Wave);
    expect(h.raid.wave).toBe(10);
    h.raid.defeatWave();
    h.run(0.2);
    expect(h.raid.stage).toBe(RaidStage.Won);
    expect(h.raid.endReason).toBe(RaidEndReason.Won);
    const d = [...h.raid.ducks.values()][0]!;
    expect(d.wavesCleared).toBe(2);
  });

  it('the default break is 10 s', () => {
    expect(RAID.breakSeconds).toBe(10);
  });
});

describe('the core and losing', () => {
  it('hunters inside the walls hammer the QoreChain core; at 0 the run is lost', async () => {
    const h = await raidOf(1, { coreHp: 100 });
    h.raid.skipTo(1);
    // The one duck stands far away on the mainland, out of every hunter's sight: they go for the core.
    const duck = [...h.raid.seats.values()][0]!;
    Object.assign(duck.sim, { x: -90, z: -10, y: 30 });
    const c = h.raid.geometry.core;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      h.raid.hunts.spawnForTest(HunterKind.Rifleman, c.x + Math.cos(a) * (c.r + 1.2), c.z + Math.sin(a) * (c.r + 1.2));
    }
    const before = h.raid.coreHp;
    h.run(2);
    expect(h.raid.coreHp).toBeLessThan(before);
    h.run(60, (r) => r.over);
    expect(h.raid.stage).toBe(RaidStage.Lost);
    expect(h.raid.endReason).toBe(RaidEndReason.CoreFell);
  });

  it('all ducks down at once loses the run; a knocked duck can be revived by holding Use', async () => {
    const h = await raidOf(2);
    h.raid.skipTo(1);
    h.raid.hunts.clear();
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
});

describe('a lone duck', () => {
  it('gets a second wind once a wave: knocked alone is not lost, holding Use gets it up; the next knock is', async () => {
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

  it('damage and headshot upgrades hit hunters harder', async () => {
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
  it('its whistle respects the hunters-at-once cap, stops late in the wave, and its helpers give no XP or drops', async () => {
    let whistles = 0;
    const h = await headlessRaid({ ducks: 0, rules: { maxLive: 5 }, events: { whistle: () => void whistles++ } });
    h.raid.addBotDuck(still());
    h.raid.beginTick(0, 0);
    h.raid.skipTo(6);
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
    // 3 alive + 3 dogs would be 6 > 5: no dogs came.
    expect(h.raid.hunts.alive).toBeLessThanOrEqual(5);
    // Late in the wave: no more whistles.
    (h.raid.hunts as unknown as { waveStartTick: number }).waveStartTick = h.raid.currentTick - 151 * TICK_RATE;
    boss.whistleCd = 0;
    boss.phase = 'advance';
    h.run(3);
    expect(whistles).toBe(1);
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
    expect(h.raid.stage).toBe(RaidStage.Wave);
    expect(h.raid.startTick - start).toBeLessThanOrEqual(cap + 1);
  });
});
