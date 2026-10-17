/**
 * Deathmatch spawn protection (server rule): a fresh duck takes no damage and
 * shots pass through it; it deals none either, because the first input with
 * the fire button ends the protection before that shot is judged (the shot
 * then counts); moving, reloading and switching keep it; the timer runs out
 * after SPAWN_PROTECTION.ticks. Bots do not pick protected ducks as targets,
 * and a duck back from a respawn is a new target with a fresh reaction time.
 * Respawns keep away from enemies on the deathmatch map.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  aimOrigin,
  Button,
  createPlayerSim,
  createSimWorld,
  generateMap,
  initPhysics,
  MATCH,
  SPAWN_PROTECTION,
  TICK_RATE,
  type InputFrame,
  type MapDef,
} from '@qwakk/shared';
import { Deathmatch, DEFAULT_DM, type BotTarget, type DeathmatchEvents, type Seat } from '../src/deathmatch.ts';
import { BotBrain, SKILL } from '../src/bots.ts';
import { loadMapV1 } from '../src/maps.ts';

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
  const log = { shots: 0, hits: [] as { shooter: string; victim: string; damage: number }[] };
  const ev: DeathmatchEvents = {
    shot: () => void log.shots++,
    hit: (s, v, damage) => void log.hits.push({ shooter: s.id, victim: v.id, damage }),
    damaged: () => undefined,
    kill: () => undefined,
    roundEnd: () => undefined,
    roundStart: () => undefined,
  };
  return { log, ev };
}

function place(seat: Seat, x: number, z: number, protect = 0): void {
  Object.assign(seat.sim, { x, y: 0.02, z, vx: 0, vy: 0, vz: 0, grounded: 1, yaw: 0, pitch: 0 });
  seat.protect = protect;
}

/** Shooter at the origin, targets straight down -z; one tick recorded so the hit history has them. */
function arena() {
  const { log, ev } = recorder();
  const dm = new Deathmatch(flatWorld(), { ...DEFAULT_DM, bots: false, secret: 7 }, ev);
  const shooter = dm.addHuman('shooter', 'S');
  const near = dm.addHuman('near', 'N');
  const far = dm.addHuman('far', 'F');
  place(shooter, 0, 0);
  place(near, 0, -10);
  place(far, 0, -20);
  dm.beginTick(0, 0);
  dm.endTick();
  return { dm, log, shooter, near, far };
}

/** An input aimed at the chest of a duck straight ahead (yaw 0) at this distance. */
function aimAhead(dm: Deathmatch, shooter: Seat, dist: number, buttons: number): InputFrame {
  const o = aimOrigin(dm.world, shooter.sim, 1, { x: 0, y: 0, z: 0 });
  const dx = 0 - o.x;
  const dy = 1.0 - o.y;
  const dz = -dist - o.z;
  return { seq: 0, tick: 1, mx: 0, mz: 0, buttons, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

function fire(dm: Deathmatch, shooter: Seat, dist: number, buttons = Button.Fire): void {
  dm.beginTick(1, STEP_MS);
  dm.applyInput(shooter, aimAhead(dm, shooter, dist, buttons), STEP_MS);
}

describe('spawn protection', () => {
  it('lasts SPAWN_PROTECTION.ticks after a spawn (2 s), then ends on its own', () => {
    const { ev } = recorder();
    const dm = new Deathmatch(flatWorld(), { ...DEFAULT_DM, bots: false }, ev);
    const s = dm.addHuman('h', 'H');
    expect(SPAWN_PROTECTION.ticks).toBe(2 * TICK_RATE);
    expect(s.protect).toBe(SPAWN_PROTECTION.ticks);
    for (let t = 0; t < SPAWN_PROTECTION.ticks - 1; t++) {
      dm.beginTick(t, t * STEP_MS);
      dm.endTick();
    }
    expect(s.protect).toBeGreaterThan(0);
    dm.beginTick(SPAWN_PROTECTION.ticks, SPAWN_PROTECTION.ticks * STEP_MS);
    dm.endTick();
    expect(s.protect).toBe(0);
  });

  it('a protected duck takes no damage and the shot passes through it to the duck behind', () => {
    const { dm, log, shooter, near, far } = arena();
    near.protect = SPAWN_PROTECTION.ticks;
    // Aimed at the far duck's chest: the line crosses the near duck's upper body on the way.
    fire(dm, shooter, 20);
    expect(log.shots).toBe(1);
    expect(near.sim.hp).toBe(100);
    expect(log.hits.map((h) => h.victim)).toEqual(['far']);
    expect(far.sim.hp).toBeLessThan(100);
  });

  it('without protection the same shot hits the near duck (control)', () => {
    const { dm, log, shooter, near } = arena();
    fire(dm, shooter, 20);
    expect(log.hits.map((h) => h.victim)).toEqual(['near']);
    expect(near.sim.hp).toBeLessThan(100);
  });

  it('a protected duck deals no damage: firing ends its protection first, and that shot counts', () => {
    const { dm, log, shooter, near } = arena();
    shooter.protect = SPAWN_PROTECTION.ticks;
    fire(dm, shooter, 10);
    expect(shooter.protect).toBe(0);
    expect(log.hits.map((h) => h.shooter)).toEqual(['shooter']);
    expect(near.sim.hp).toBeLessThan(100);
  });

  it('the fire button ends it even when no shot comes out (empty gun); moving, reloading and switching do not', () => {
    const { dm, shooter } = arena();
    shooter.protect = SPAWN_PROTECTION.ticks;
    const f = aimAhead(dm, shooter, 10, 0);
    for (const buttons of [0, Button.Reload, Button.Slot2, Button.Slot1, Button.Aim, Button.Sprint | Button.Jump, Button.Crouch]) {
      dm.beginTick(1, STEP_MS);
      dm.applyInput(shooter, { ...f, mz: 1, mx: 0.5, buttons }, STEP_MS);
    }
    expect(shooter.protect).toBe(SPAWN_PROTECTION.ticks);
    shooter.sim.mag0 = 0;
    shooter.sim.res0 = 0;
    shooter.sim.mag1 = 0;
    shooter.sim.res1 = 0;
    dm.beginTick(2, 2 * STEP_MS);
    dm.applyInput(shooter, { ...f, buttons: Button.Fire }, 2 * STEP_MS);
    expect(shooter.protect).toBe(0);
  });
});

describe('bots and spawn protection', () => {
  const target = (o: Partial<BotTarget>): BotTarget => ({ id: 'x', x: 0, y: 0.02, z: -15, alive: true, team: 0, protect: false, life: 1, ...o });

  /** Run a bot facing the target for some ticks; returns the ticks it held fire on and whether it picked the target. */
  function run(bot: BotBrain, self: ReturnType<typeof createPlayerSim>, t: BotTarget, from: number, ticks: number) {
    const fired: number[] = [];
    let engaged = false;
    for (let i = 0; i < ticks; i++) {
      // Between fights the bot would turn to roam; keep it looking at the target so it is in plain sight.
      if (!bot.busy) bot.lookAt(0, 0);
      const f = bot.think(self, [t], from + i);
      if (f.buttons & Button.Fire) fired.push(i);
      if (bot.targetIdNow === t.id) engaged = true;
    }
    return { fired, engaged };
  }

  it('ignore a protected duck in plain sight, then fight it once protection is off, after a reaction time', () => {
    const sim = flatWorld();
    const self = createPlayerSim(0, 0.02, 0, 0);
    const bot = new BotBrain(sim, SKILL);
    bot.respawned(self);
    const protectedNow = run(bot, self, target({ protect: true }), 0, 90);
    expect(protectedNow.engaged).toBe(false);
    expect(protectedNow.fired).toEqual([]);
    const open = run(bot, self, target({ protect: false }), 90, 120);
    expect(open.engaged).toBe(true);
    expect(open.fired.length).toBeGreaterThan(0);
    // No shot before the shortest reaction time (perception runs every 3rd tick).
    expect(open.fired[0]).toBeGreaterThanOrEqual(SKILL.reactionTicks[0]);
  });

  it('drop a target that respawned (new life, protected) at once, and react afresh when its protection ends', () => {
    const sim = flatWorld();
    const self = createPlayerSim(0, 0.02, 0, 0);
    const bot = new BotBrain(sim, SKILL);
    bot.respawned(self);
    expect(run(bot, self, target({ life: 1 }), 0, 90).fired.length).toBeGreaterThan(0);
    // Same duck, next life, right in front again (spawn protected): no target, no shot.
    const back = run(bot, self, target({ life: 2, protect: true }), 90, 30);
    expect(back.engaged).toBe(false);
    expect(back.fired).toEqual([]);
    // Protection over: a fresh reaction time before the first shot.
    const again = run(bot, self, target({ life: 2 }), 120, 90);
    expect(again.fired.length).toBeGreaterThan(0);
    expect(again.fired[0]).toBeGreaterThanOrEqual(SKILL.reactionTicks[0]);
  });

  it('a full room of bots on the greybox: a bot never holds a protected duck as its target', () => {
    const { log, ev } = recorder();
    const dm = new Deathmatch(createSimWorld(generateMap(1337)), { ...DEFAULT_DM, bots: true }, ev);
    dm.allowBotsAlone = true;
    dm.fillBots();
    let protectedTicks = 0;
    let bad = 0;
    const shielded = new Set<string>();
    for (let t = 0; t < 30 * TICK_RATE; t++) {
      // Ducks protected while the bots think this tick (a duck can respawn later in the same tick).
      shielded.clear();
      for (const s of dm.seats.values()) if (s.protect > 0) shielded.add(s.id);
      protectedTicks += shielded.size;
      dm.beginTick(t, t * STEP_MS);
      dm.endTick();
      for (const s of dm.seats.values()) {
        const id = (s.bot as BotBrain).targetIdNow;
        if (id && shielded.has(id)) bad++;
      }
    }
    expect(protectedTicks).toBeGreaterThan(0);
    expect(log.hits.length).toBeGreaterThan(10);
    expect(bad).toBe(0);
  }, 60_000);
});

describe('deathmatch respawn points', () => {
  it('keep at least spawnMinEnemyDistance from every living enemy on the deathmatch map', () => {
    const def = loadMapV1(MATCH.mapId).def;
    const { ev } = recorder();
    const dm = new Deathmatch(createSimWorld(def), { ...DEFAULT_DM, bots: false }, ev);
    const pts = def.arenaSpawns;
    // Three enemies standing on spawn points spread over the map.
    const enemies = [0, Math.floor(pts.length / 3), Math.floor((2 * pts.length) / 3)].map((i, k) => {
      const s = dm.addHuman(`e${k}`, `E${k}`);
      const p = pts[i]!;
      Object.assign(s.sim, { x: p[0], y: p[1], z: p[2] });
      return s;
    });
    const me = dm.addHuman('me', 'Me');
    for (let n = 0; n < 30; n++) {
      dm.beginTick(n * 200, n * 200 * STEP_MS);
      dm.spawn(me);
      const d = Math.min(...enemies.map((e) => Math.hypot(e.sim.x - me.sim.x, e.sim.z - me.sim.z)));
      expect(d).toBeGreaterThanOrEqual(MATCH.spawnMinEnemyDistance);
      expect(me.protect).toBe(SPAWN_PROTECTION.ticks);
    }
  });
});
