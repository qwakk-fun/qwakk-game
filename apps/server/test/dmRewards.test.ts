import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Button, COMBAT, createSimWorld, DM, DmPower, emptyInput, initPhysics, TICK_RATE, weaponStats, type DmReward, type MapDef, type SimWorld } from '@qwakk/shared';
import { Deathmatch, DEFAULT_DM, type DeathmatchEvents, type DeathmatchOptions, type Seat } from '../src/deathmatch.ts';

beforeAll(initPhysics);
const worlds: SimWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });
const noop = () => {};

class TestMatch extends Deathmatch {
  frag(killer: Seat | null, victim: Seat, head = false): void { this.kill(killer, victim, 0, head); }
  hit(shooter: Seat, victim: Seat, head: boolean, killed = false): void { this.onHit(shooter, victim, head, killed); }
  damage(victim: Seat, raw: number): number { return this.adjustDamage(victim, raw, false); }
}

function make(options: Partial<DeathmatchOptions> = {}, walls: MapDef['boxes'] = []) {
  const map: MapDef = {
    id: 'test', seed: 1, size: 100, seaLevel: -10,
    terrain: { cells: 10, cellSize: 10, heights: new Float32Array(121) },
    boxes: walls, rocks: [], shapes: [], water: null, br: null,
    spawns: [[-20, 0.5, 0], [20, 0.5, 0], [0, 0.5, 20]],
    arenaSpawns: [], arena: { x: 0, z: 0, radius: 45 },
  };
  const world = createSimWorld(map); worlds.push(world);
  const rewards: DmReward[] = [];
  const ev: DeathmatchEvents = { shot: noop, hit: noop, damaged: noop, kill: noop, roundStart: noop, roundEnd: noop, reward: (_s, r) => rewards.push(r) };
  const dm = new TestMatch(world, { ...DEFAULT_DM, bots: false, ...options }, ev);
  const a = dm.addHuman('a', 'Alpha'), b = dm.addHuman('b', 'Beta');
  let tick = 0;
  const advance = (n: number) => { for (let i = 0; i < n; i++) { tick++; dm.beginTick(tick, tick * 1000 / TICK_RATE); dm.endTick(); } };
  return { dm, a, b, rewards, advance };
}

describe('deathmatch rewards', () => {
  it('awards 3/5/10 milestones once each per life without changing damage or health', () => {
    const { dm, a, b, rewards } = make();
    a.sim.hp = 37;
    for (let i = 0; i < 11; i++) { dm.spawn(b); dm.frag(a, b); }
    expect(rewards.filter((r) => r.milestone).map((r) => r.milestone)).toEqual([3, 5, 10]);
    expect(dm.stats.get(a.id)).toMatchObject({ points: 1450, streak: 11, bestStreak: 11 });
    expect(a.sim.hp).toBe(37);
    expect(dm.damage(a, 40)).toBe(40);
    dm.spawn(b); dm.frag(b, a);
    expect(dm.stats.get(a.id)).toMatchObject({ streak: 0, bestStreak: 11 });
  });

  it('headshot hit/kill bonuses and revenge stack, but revenge is consumed once', () => {
    const { dm, a, b, rewards } = make();
    dm.frag(b, a); dm.spawn(a);
    dm.hit(a, b, true);
    expect(rewards.at(-1)).toMatchObject({ points: 10, head: true, kill: false });
    dm.frag(a, b, true);
    expect(rewards.at(-1)).toMatchObject({ points: 200, head: true, revenge: true, kill: true });
    dm.spawn(b); dm.frag(a, b);
    expect(rewards.at(-1)).toMatchObject({ points: 100, revenge: false });
    dm.frag(null, a);
    expect(dm.stats.get(a.id)?.lastKiller).toBeNull();
  });

  it('counts actual fired shots, not held trigger inputs, and freezes statistics during intermission', () => {
    const { dm, a, b, advance } = make({ scoreLimit: 1 });
    const fire = { ...emptyInput(), buttons: Button.Fire };
    dm.applyInput(a, fire, 0); dm.applyInput(a, fire, 0);
    expect(dm.stats.get(a.id)?.shots).toBe(1);
    dm.hit(a, b, false, true); dm.frag(a, b);
    expect(dm.results.find((r) => r.pid === a.pid)).toMatchObject({ shots: 1, hits: 1, kills: 1, points: 100 });
    a.sim.cooldown = 0; dm.applyInput(a, fire, 0);
    expect(dm.stats.get(a.id)?.shots).toBe(1);
    dm.remove(b.id);
    expect(dm.results).toHaveLength(2);
    advance(DEFAULT_DM.intermissionSeconds * TICK_RATE);
    expect(dm.results).toEqual([]);
    expect(dm.stats.get(a.id)).toMatchObject({ points: 0, streak: 0, shots: 0, hits: 0, lastKiller: null });
    expect(a.kills).toBe(0);
  });

  it('removes departed stats and revenge references, and keeps the existing kill limit', () => {
    const { dm, a, b } = make({ scoreLimit: 3 });
    dm.frag(b, a); dm.spawn(a); dm.frag(a, b, true);
    expect(dm.phase).toBe('playing'); // 200 points still means one kill.
    dm.remove(a.id);
    expect(dm.stats.has(a.id)).toBe(false);
    expect(dm.stats.get(b.id)?.lastKiller).toBeNull();
  });
});

describe('powerups and rotations', () => {
  it('spawns bounded, expiring pickups away from players and clears them between rounds', () => {
    const { dm, a, b, advance } = make({ roundSeconds: 1000 });
    Object.assign(a.sim, { x: 0, y: 0, z: 0 }); Object.assign(b.sim, { x: 1, y: 0, z: 0 });
    advance(DM.powerEverySeconds * TICK_RATE - 1);
    expect(dm.powerups.pickups.size).toBe(0);
    advance(1);
    const first = [...dm.powerups.pickups.values()][0]!;
    expect(first).toBeDefined();
    expect(Math.hypot(first.x - a.sim.x, first.z - a.sim.z)).toBeGreaterThanOrEqual(8);
    advance((DM.powerLifetimeSeconds + 1) * TICK_RATE);
    expect(dm.powerups.pickups.has(first.id)).toBe(false);
    expect(dm.powerups.pickups.size).toBeLessThanOrEqual(DM.powerMax);
    dm.remove(a.id); dm.remove(b.id);
    expect(dm.powerups.pickups.size).toBe(0);
  });

  it('collects once by proximity, respects spawn protection, replaces boosts, and clears on death', () => {
    const { dm, a, b, advance } = make();
    Object.assign(a.sim, { x: 0, y: 0, z: 0 }); Object.assign(b.sim, { x: 10, y: 0, z: 0 });
    const put = (kind: number) => dm.powerups.pickups.set('p', { id: 'p', kind, x: 0, y: 0.8, z: 0, expires: 10000 });
    a.protect = 10;
    put(DmPower.Speed); advance(1);
    expect(a.sim.dmPower).toBe(0);
    a.protect = 0; advance(1);
    expect(a.sim.dmPower).toBe(DmPower.Speed);
    expect(dm.powerups.pickups.size).toBe(0);
    put(DmPower.Armor); advance(1);
    expect(a.sim.dmPower).toBe(DmPower.Armor);
    expect(a.sim.dmShield).toBe(25);
    expect(dm.damage(a, 40)).toBe(30);
    expect(a.sim.dmShield).toBe(15);
    expect(dm.damage(a, 100)).toBe(85);
    expect(a.sim.dmPowerTicks).toBe(0);
    put(DmPower.Jump); advance(1);
    dm.frag(b, a);
    expect(a.sim.dmPower).toBe(0);
    expect(a.sim.dmPowerTicks).toBe(0);
    expect(a.respawnAt).toBe(dm.currentTick + COMBAT.respawnTicks);
  });

  it('cannot collect through a wall or from another floor', () => {
    const { dm, a, b, advance } = make({}, [{ kind: 'wall', c: [0.5, 1, 0], h: [0.1, 1, 3], q: [0, 0, 0, 1] }]);
    Object.assign(a.sim, { x: 0, y: 0, z: 0 }); Object.assign(b.sim, { x: 20, y: 0, z: 0 });
    a.protect = 0;
    dm.powerups.pickups.set('wall', { id: 'wall', kind: 1, x: 1, y: 0.8, z: 0, expires: 999 });
    dm.powerups.pickups.set('floor', { id: 'floor', kind: 2, x: 0, y: 3.8, z: 0, expires: 999 });
    advance(1);
    expect(a.sim.dmPower).toBe(0);
    expect(dm.powerups.pickups.size).toBe(2);
  });

  it('rotates everyone together, refills ammo, prevents switching back, and gives late joins the same weapon', () => {
    const { dm, a, b, advance } = make({ roundSeconds: 1000 });
    a.sim.mag0 = 0; a.sim.reload = 10;
    advance(DM.rotationSeconds * TICK_RATE - 1);
    expect(dm.rotationWeapon).toBe(0);
    dm.beginTick(DM.rotationSeconds * TICK_RATE, DM.rotationSeconds * 1000);
    expect(a.sim.weapon).toBe(1); // already rotated before human input and endTick/bots.
    advance(1);
    expect(dm.rotationWeapon).toBe(1);
    for (const s of [a, b, dm.addHuman('c', 'Late')]) {
      expect(s.sim.weapon).toBe(1); expect(s.sim.arms).toBe(2);
      expect(s.sim.mag1).toBe(weaponStats(1).magSize);
      expect(s.sim.reload).toBe(0);
      dm.applyInput(s, { ...emptyInput(), buttons: Button.Slot1 }, dm.nowMs);
      expect(s.sim.weapon).toBe(1);
    }
    dm.spawn(a); expect(a.sim.weapon).toBe(1);
    advance(DM.rotationSeconds * TICK_RATE);
    expect(dm.rotationWeapon).toBe(0);
  });
});

describe('server killcam history', () => {
  it('bounds history, sends only the killer/victim pair, and records the killing frame', () => {
    const { dm, a, b, advance } = make();
    dm.addHuman('unrelated', 'Unrelated');
    advance(10 * TICK_RATE);
    expect(dm.replay.forDeath(dm.currentTick, a, b)).toBeNull(); // no living-viewer replay
    dm.frag(a, b);
    const replay = dm.replay.forDeath(dm.currentTick, a, b)!;
    expect(replay.killerId).toBe(a.id);
    expect(replay.victimId).toBe(b.id);
    expect(replay.victimLife).toBe(b.life);
    expect(replay.frames.length).toBeGreaterThanOrEqual(29);
    expect(replay.frames.length).toBeLessThanOrEqual(32);
    expect(replay.frames.at(-1)!.at - replay.frames[0]!.at).toBeLessThanOrEqual(2500);
    expect(replay.frames.at(-1)!.victim.alive).toBe(false);
    expect(JSON.stringify(replay)).not.toContain('unrelated');
    const recordedX = replay.frames.at(-1)!.killer.x;
    a.sim.x += 20;
    expect(replay.frames.at(-1)!.killer.x).toBe(recordedX);
    expect(dm.replay.forDeath(dm.currentTick, null, b)).toBeNull();
    expect(dm.replay.forDeath(dm.currentTick, b, b)).toBeNull();
  });

  it('never replays previous lives or previous rounds', () => {
    const { dm, a, b, advance } = make();
    advance(2 * TICK_RATE);
    dm.spawn(a);
    a.sim.x = 42;
    dm.frag(a, b);
    const replay = dm.replay.forDeath(dm.currentTick, a, b)!;
    expect(replay.frames).toHaveLength(2); // immediate kill: brief current attacker view
    expect(replay.frames.every(f => f.killer.x === 42)).toBe(true);
    dm.spawn(b);
    expect(dm.replay.forDeath(dm.currentTick, a, b)).toBeNull();
    advance(TICK_RATE);
    dm.ticksLeft = 1; advance(1);
    advance(DEFAULT_DM.intermissionSeconds * TICK_RATE);
    a.sim.x = 77;
    dm.frag(a, b);
    expect(dm.replay.forDeath(dm.currentTick, a, b)!.frames.every(f => f.killer.x === 77)).toBe(true);
  });
});
