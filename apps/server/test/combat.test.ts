import { beforeAll, describe, expect, it } from 'vitest';
import {
  aimOrigin,
  Button,
  createSimWorld,
  generateMap,
  initPhysics,
  MATCH,
  NET,
  TICK_RATE,
  weaponStats,
  WeaponId,
  type InputFrame,
  type MapDef,
} from '@qwakk/shared';
import { Deathmatch, DEFAULT_DM, type DeathmatchEvents, type Seat } from '../src/deathmatch.ts';
import { InputPacer } from '../src/inputPacer.ts';
import { LagHistory } from '../src/lagComp.ts';

const STEP_MS = 1000 / TICK_RATE;

beforeAll(async () => {
  await initPhysics();
});

function flatWorld() {
  const cells = 10;
  const map: MapDef = {
    id: 'test',
    seed: 0,
    size: 100,
    seaLevel: -10,
    terrain: { cells, cellSize: 10, heights: new Float32Array((cells + 1) * (cells + 1)) },
    boxes: [],
    rocks: [],
    spawns: [[0, 0.5, 0]],
    arena: { x: 0, z: 0, radius: 50 },
    arenaSpawns: [],
    shapes: [],
    water: null,
    br: null,
  };
  return createSimWorld(map);
}

function recorder() {
  const log = { shots: 0, hits: [] as { victim: string; damage: number; head: boolean; killed: boolean }[], kills: 0 };
  const ev: DeathmatchEvents = {
    shot: () => void log.shots++,
    hit: (_s, v, damage, head, killed) => void log.hits.push({ victim: v.id, damage, head, killed }),
    damaged: () => undefined,
    kill: () => void log.kills++,
    roundEnd: () => undefined,
    roundStart: () => undefined,
  };
  return { log, ev };
}

function place(seat: Seat, x: number, z: number): void {
  Object.assign(seat.sim, { x, y: 0.02, z, vx: 0, vy: 0, vz: 0, grounded: 1 });
  seat.protect = 0;
}

describe('lag compensation history', () => {
  it('returns interpolated past positions and caps at the stored window', () => {
    const h = new LagHistory(12);
    for (let i = 0; i < 20; i++) h.record(i * STEP_MS, [{ id: 'a', x: i, y: 0, z: 0, crouch: 0, alive: 1 }]);
    expect(h.sample(10.5 * STEP_MS)[0]?.x).toBeCloseTo(10.5, 6);
    expect(h.sample(19 * STEP_MS)[0]?.x).toBe(19);
    expect(h.sample(0)[0]?.x).toBe(8); // oldest kept snapshot
  });

  it('does not interpolate across a respawn teleport', () => {
    const h = new LagHistory(12);
    h.record(0, [{ id: 'a', x: 0, y: 0, z: 0, crouch: 0, alive: 1 }]);
    h.record(STEP_MS, [{ id: 'a', x: 50, y: 0, z: 0, crouch: 0, alive: 1 }]);
    const x = h.sample(STEP_MS * 0.4)[0]?.x;
    expect(x === 0 || x === 50).toBe(true);
  });
});

describe('server hit validation', () => {
  /**
   * The target runs sideways at 7 m/s, 20 m in front of the shooter. The
   * shooter aims where it SAW the target 150 ms ago. With rewind to that view
   * time the shot hits; judged against the present position it misses.
   */
  function rewindScenario(viewLagMs: number, aimLagMs = 150, rttMs = -1) {
    const { log, ev } = recorder();
    // A fixed spread secret: the random part of the spread is the same every run.
    const dm = new Deathmatch(flatWorld(), { ...DEFAULT_DM, bots: false, secret: 7 }, ev);
    const shooter = dm.addHuman('shooter', 'S');
    const target = dm.addHuman('target', 'T');
    place(shooter, 0, 0);
    shooter.rttMs = rttMs;
    let tick = 0;
    const speed = 7;
    // Record ~0.3 s of the target's motion.
    for (; tick < 10; tick++) {
      dm.beginTick(tick, tick * STEP_MS);
      place(target, -1 + (speed * tick) / TICK_RATE, -20);
      dm.endTick();
    }
    const now = tick * STEP_MS;
    dm.beginTick(tick, now);
    const seenAt = now - aimLagMs;
    const seenX = -1 + (speed * (seenAt / STEP_MS)) / TICK_RATE;
    // Aim from the shoulder point at the chest the shooter saw.
    shooter.sim.yaw = 0;
    const origin = aimOrigin(flatWorld(), shooter.sim, 1, { x: 0, y: 0, z: 0 });
    const dx = seenX - origin.x;
    const dy = 1.0 - origin.y;
    const dz = -20 - origin.z;
    const f: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: Button.Fire, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    shooter.sim.yaw = f.yaw;
    shooter.sim.pitch = f.pitch;
    dm.applyInput(shooter, f, now - viewLagMs);
    return log;
  }

  it('hits a moving target at the shooter view time (rewind)', () => {
    const log = rewindScenario(150);
    expect(log.shots).toBe(1);
    expect(log.hits.length).toBe(1);
    expect(log.hits[0]?.victim).toBe('target');
  });

  it('the same shot misses without rewind', () => {
    const log = rewindScenario(0);
    expect(log.shots).toBe(1);
    expect(log.hits.length).toBe(0);
  });

  it('a 10 ms client cannot claim a 230 ms old view (rewind bounded by the server-measured round trip)', () => {
    // Aim at where the target was 230 ms ago and claim exactly that view time.
    expect(rewindScenario(230, 230, 10).hits.length).toBe(0);
  });

  it('a 200 ms client may claim it (its measured latency explains the view time)', () => {
    expect(rewindScenario(230, 230, 200).hits.length).toBe(1);
  });

  it('caps the rewind: a view time far in the past is clamped', () => {
    // Aiming where the target was 330 ms ago and claiming that view time: the
    // rewind stops at the cap (230 ms), where the target had already moved on.
    const log = rewindScenario(330, 330);
    expect(log.hits.length).toBe(0);
  });
});

describe('fire rate and ammo against a spamming client', () => {
  it('two fire inputs per tick for 3 s: shots stay within the rate and the magazine', () => {
    const { log, ev } = recorder();
    const dm = new Deathmatch(flatWorld(), { ...DEFAULT_DM, bots: false }, ev);
    const cheater = dm.addHuman('c', 'C');
    place(cheater, 0, 0);
    const pacer = new InputPacer<{ tick: number; f: InputFrame }>({
      stepMs: STEP_MS,
      creditCap: NET.maxInputCredit,
      graceTicks: NET.starveGraceTicks,
      repeatTicks: NET.standInRepeatTicks,
      maxDebt: NET.maxStandInDebt,
      lateMarginMs: NET.lateMarginMs,
    });
    const queue: { tick: number; f: InputFrame }[] = [];
    let consumed = 0;
    const q = {
      get size() {
        return queue.length;
      },
      get consumedCount() {
        return consumed;
      },
      next() {
        const i = queue.shift();
        if (i) consumed++;
        return i;
      },
    };
    const ticks = 90;
    let n = 0;
    for (let t = 0; t < ticks; t++) {
      for (let k = 0; k < 2; k++) {
        // Toggle fire every input and spam reload too.
        const buttons = (n++ % 2 === 0 ? Button.Fire : 0) | (n % 7 === 0 ? Button.Reload : 0);
        queue.push({ tick: t, f: { seq: 0, tick: t, mx: 0, mz: 0, buttons, yaw: 0, pitch: 0 } });
        while (queue.length > NET.maxInputBuffer) {
          queue.shift();
          consumed++;
        }
      }
      dm.beginTick(t, t * STEP_MS);
      pacer.tick(q, t * STEP_MS, (i) => dm.applyInput(cheater, i.f, t * STEP_MS), () => undefined);
      dm.endTick();
    }
    const rifle = weaponStats(WeaponId.Rifle);
    // At most one step per tick (plus the burst credit), one shot per fireTicks steps.
    expect(log.shots).toBeLessThanOrEqual(Math.ceil((ticks + NET.maxInputCredit) / rifle.fireTicks));
    // Ammo is the server's: rounds left plus shots fired equals the rounds issued.
    const s = cheater.sim;
    expect(s.mag0 + s.res0 + log.shots).toBe(rifle.magSize + rifle.reserve);
  });
});

describe('headless deathmatch', () => {
  it('a full room of bots fights on the greybox: kills, deaths and respawns happen', () => {
    const { log, ev } = recorder();
    const dm = new Deathmatch(createSimWorld(generateMap(1337)), { ...DEFAULT_DM, bots: true }, ev);
    dm.allowBotsAlone = true;
    dm.fillBots();
    expect(dm.seats.size).toBe(MATCH.players);
    const ticks = 60 * TICK_RATE; // one minute
    let respawns = 0;
    const wasDead = new Set<string>();
    for (let t = 0; t < ticks; t++) {
      dm.beginTick(t, t * STEP_MS);
      dm.endTick();
      for (const s of dm.seats.values()) {
        if (!s.sim.alive) wasDead.add(s.id);
        else if (wasDead.delete(s.id)) respawns++;
      }
    }
    expect(log.kills).toBeGreaterThan(5);
    expect(respawns).toBeGreaterThan(3);
    const deaths = [...dm.seats.values()].reduce((n, s) => n + s.deaths, 0);
    expect(deaths).toBeGreaterThan(0);
  }, 60_000);
});
