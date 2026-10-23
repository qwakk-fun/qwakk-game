/**
 * Deathmatch explosives, server side: grenades and rockets in flight, fuses,
 * explosions (falloff damage through the line-of-sight rule, knockback, no
 * team damage, reduced self damage) and the rare rocket launcher pickup.
 *
 * The throw and the launch themselves are shared sim (explosives.ts): the
 * room's input path steps them, and `afterStep` turns what the step fired
 * (`lastExplosive`) into a flight from the duck's post-step state. Everything
 * after that is decided here; clients only draw what the room tells them
 * (dmExplosivesNet.ts picks who hears what).
 *
 * Knockback choice: an explosion adds to the duck's sim velocity (vx, vy, vz,
 * rounded to float32 like every sim step) and lifts it off the ground, and
 * the shared movement step carries it from there (air drag, wall clipping,
 * landing friction). So it lives in the shared sim: the owner's client
 * adopts that state on its next reconcile and replays its pending inputs on
 * top of it exactly as the server steps them, with no position nudges from
 * the server afterwards. The one correction the blast itself causes is the
 * unpredictable event (nobody can predict a server-owned fuse); after it the
 * prediction matches again. A server-side position push (like player
 * separation) would instead fight the prediction on every tick it acts.
 *
 * No lag compensation for projectiles: they are visible and fly through the
 * present (current positions); only hitscan shots rewind.
 */
import {
  blastFalloff,
  blastReach,
  BULLET_QUERY_GROUPS,
  DT,
  emptyFlight,
  EXPLOSIVE,
  exRockets,
  ExplosiveKind,
  grenadeLaunch,
  groundHeightAt,
  lastExplosive,
  Mode,
  OPAQUE_QUERY_GROUPS,
  rayHitbox,
  rocketLaunch,
  setNades,
  setRockets,
  stepGrenade,
  TICK_RATE,
  type Flight,
  type HitTarget,
  type SimWorld,
} from '@qwakk/shared';
import { KillWeapon } from '@qwakk/shared/net';
import type { BotLike, Seat } from './arena.ts';
import { explosiveRules, grenadesPerLife, rocketPickupRules, type BlastRules } from './settings/explosives.ts';
import { attachBotExplosives } from './dmBotExplosives.ts';

/** A grenade or rocket in flight, with who threw it. */
export interface LiveFlight {
  id: number;
  flight: Flight;
  ownerId: string;
  ownerPid: number;
  /** The thrower's team at the throw (teammates are never hurt, even after the thrower left). */
  team: number;
  /** Grenade: ticks left on the fuse. */
  fuse: number;
}

export interface BlastInfo {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
}

/** The launcher pickup on the map (public objective, like the boosts). */
export interface RocketPickup {
  id: string;
  x: number;
  y: number;
  z: number;
  expires: number;
}

/** What the room turns into messages (dmExplosivesNet.ts) and HUD feedback. */
export interface ExplosiveEvents {
  launched?(f: LiveFlight, owner: Seat): void;
  rested?(f: LiveFlight): void;
  boom?(b: BlastInfo): void;
  rocketPicked?(seat: Seat, rockets: number): void;
  /** Explosive damage dealt by `attacker` (its hit marker). */
  blastHit?(attacker: Seat, victim: Seat, damage: number, killed: boolean): void;
  /** Explosive damage taken, with the blast's position for the direction arc (never the thrower's). */
  blastDamaged?(victim: Seat, damage: number, x: number, z: number): void;
}

/** What the deathmatch (or Hunt Season) lends the explosives. */
export interface ExplosiveHost {
  readonly seats: Map<string, Seat>;
  /** Apply explosive damage through the mode's rules (armor, kills, points). */
  explosionDamage(attacker: Seat | null, victim: Seat, amount: number, weapon: number, x: number, z: number): void;
  /**
   * Hunt Season: targets besides the ducks a rocket can hit on its way (hunters, current
   * positions), and a blast's damage to them (`directId`: the one a rocket hit). Absent in the deathmatch.
   */
  rocketTargets?(): HitTarget[];
  blastOthers?(attacker: Seat | null, x: number, y: number, z: number, r: BlastRules, kind: number, directId: string | null): void;
}

const f32 = Math.fround;
/** The blast is tested from a little above a grenade lying on the floor, so its rays clear the ground. */
const GRENADE_LIFT = 0.25;
/** A rocket blast sits this far back from what it hit. */
const ROCKET_BACKOFF = 0.2;

export class DmExplosives {
  readonly flights = new Map<number, LiveFlight>();
  rocket: RocketPickup | null = null;
  private nextRocketAt = 0;
  private serial = 0;
  private readonly sim: SimWorld;
  private readonly host: ExplosiveHost;
  /** Set by the room (messages); the deathmatch works without it (tests, the benchmark). */
  events: ExplosiveEvents = {};
  /** The timed launcher pickup (deathmatch). Hunt Season turns it off and places one on boss waves (placeRocket). */
  timedPickups = true;

  constructor(sim: SimWorld, host: ExplosiveHost) {
    this.sim = sim;
    this.host = host;
  }

  /** Round start or end, an idle room: nothing in flight, the next launcher pickup scheduled. */
  reset(tick: number): void {
    this.flights.clear();
    this.rocket = null;
    this.schedule(tick);
  }

  private schedule(tick: number): void {
    const r = rocketPickupRules();
    this.nextRocketAt = tick + Math.round(r.minTicks + Math.random() * (r.maxTicks - r.minTicks));
  }

  /** A fresh life: the grenades of a life, no launcher (createPlayerSim already zeroed the rest). */
  onSpawn(seat: Seat): void {
    setNades(seat.sim, grenadesPerLife());
  }

  /** Bots throw now and then and fetch launchers they see (dmBotExplosives.ts). */
  wrapBot(bot: BotLike): BotLike {
    return attachBotExplosives(this.sim, bot, () => this.rocket);
  }

  /** Right after a duck's sim step: turn a throw or launch of that step into a flight (not between rounds: it fizzles). */
  afterStep(seat: Seat, live = true): void {
    const kind = lastExplosive.kind;
    if (kind === ExplosiveKind.None) return;
    lastExplosive.kind = ExplosiveKind.None;
    if (!live) return;
    // Throwing ends spawn protection like firing does (a protected duck deals no damage).
    seat.protect = 0;
    const flight = kind === ExplosiveKind.Grenade ? grenadeLaunch(this.sim, seat.sim, emptyFlight()) : rocketLaunch(this.sim, seat.sim, seat.side, emptyFlight(), this.aimTargets(seat));
    const lf: LiveFlight = { id: ++this.serial, flight, ownerId: seat.id, ownerPid: seat.pid, team: seat.team, fuse: explosiveRules().grenade.fuseTicks };
    this.flights.set(lf.id, lf);
    this.events.launched?.(lf, seat);
  }

  /** Ducks the crosshair may rest on for a rocket's aim point (current positions; teammates and protected ducks are passed through). */
  private aimTargets(seat: Seat): HitTarget[] {
    const out: HitTarget[] = [];
    for (const s of this.host.seats.values()) {
      if (s === seat || !s.sim.alive || s.sim.mode !== Mode.Ground || s.protect > 0 || (seat.team > 0 && s.team === seat.team)) continue;
      out.push({ id: s.id, x: s.sim.x, y: s.sim.y, z: s.sim.z, crouch: s.sim.crouch });
    }
    const others = this.host.rocketTargets?.();
    return others ? out.concat(others) : out;
  }

  /** One tick: flights, fuses and blasts, then the launcher pickup. Only while a round runs. */
  step(tick: number): void {
    for (const live of [...this.flights.values()]) {
      if (!this.flights.has(live.id)) continue; // an earlier blast this tick ended the round (reset)
      const f = live.flight;
      if (f.kind === ExplosiveKind.Grenade) {
        const wasResting = f.rest;
        stepGrenade(this.sim, f, DT);
        if (!wasResting && f.rest) this.events.rested?.(live);
        if (--live.fuse <= 0 || f.y < -40) this.explode(live, f.x, f.y + GRENADE_LIFT, f.z, null);
      } else this.stepRocket(live);
    }
    this.stepPickup(tick);
  }

  private stepRocket(live: LiveFlight): void {
    const f = live.flight;
    f.age += 1;
    const sp = Math.sqrt(f.vx * f.vx + f.vy * f.vy + f.vz * f.vz);
    const move = sp * DT;
    const dx = f.vx / sp;
    const dy = f.vy / sp;
    const dz = f.vz / sp;
    const hit = this.sim.world.castRay(new this.sim.rapier.Ray({ x: f.x, y: f.y, z: f.z }, { x: dx, y: dy, z: dz }), move, true, undefined, BULLET_QUERY_GROUPS);
    let t = hit ? hit.timeOfImpact : move;
    // Ducks along the way (current positions): teammates and spawn-protected ducks let it pass, like a shot.
    let direct: Seat | null = null;
    for (const s of this.host.seats.values()) {
      if (s.id === live.ownerId || !s.sim.alive || s.sim.mode !== Mode.Ground || s.protect > 0 || (live.team > 0 && s.team === live.team)) continue;
      if (Math.abs(s.sim.x - f.x) > move + 2 || Math.abs(s.sim.z - f.z) > move + 2) continue;
      const h = rayHitbox(f.x, f.y, f.z, dx, dy, dz, { id: s.id, x: s.sim.x, y: s.sim.y, z: s.sim.z, crouch: s.sim.crouch }, t + EXPLOSIVE.rocket.radius);
      if (h && h.t <= t + EXPLOSIVE.rocket.radius) {
        t = Math.min(t, h.t);
        direct = s;
      }
    }
    // Hunt Season: hunters along the way (current positions).
    let directOther: string | null = null;
    const others = this.host.rocketTargets?.();
    if (others) {
      for (const o of others) {
        if (Math.abs(o.x - f.x) > move + 2.5 || Math.abs(o.z - f.z) > move + 2.5) continue;
        const h = rayHitbox(f.x, f.y, f.z, dx, dy, dz, o, t + EXPLOSIVE.rocket.radius);
        if (h && h.t <= t + EXPLOSIVE.rocket.radius && h.t < t) {
          t = h.t;
          direct = null;
          directOther = o.id;
        }
      }
    }
    if (direct || hit || directOther) {
      const back = Math.max(0, t - ROCKET_BACKOFF);
      this.explode(live, f.x + dx * back, f.y + dy * back, f.z + dz * back, direct, directOther);
      return;
    }
    f.x += f.vx * DT;
    f.y += f.vy * DT;
    f.z += f.vz * DT;
    if (f.age >= EXPLOSIVE.rocket.maxTicks || f.y < -40) this.explode(live, f.x, f.y, f.z, null);
  }

  /**
   * An explosion at (x, y, z): every living duck the blast reaches through the
   * world (blastReach: walls that stop bullets protect) takes falloff damage
   * and knockback; teammates of the thrower take neither; the thrower takes
   * the self share. `direct`: the duck a rocket hit (full splash plus the bonus).
   */
  private explode(live: LiveFlight, x: number, y: number, z: number, direct: Seat | null, directOther: string | null = null): void {
    this.flights.delete(live.id);
    const kind = live.flight.kind;
    this.events.boom?.({ id: live.id, kind, x, y, z });
    const all = explosiveRules();
    const r: BlastRules = kind === ExplosiveKind.Grenade ? all.grenade : all.rocket;
    const attacker = this.host.seats.get(live.ownerId) ?? null;
    const weapon = kind === ExplosiveKind.Grenade ? KillWeapon.Grenade : KillWeapon.Rocket;
    for (const seat of [...this.host.seats.values()]) {
      const s = seat.sim;
      if (!s.alive || s.mode !== Mode.Ground || seat.protect > 0) continue;
      const self = seat.id === live.ownerId;
      if (!self && live.team > 0 && seat.team === live.team) continue;
      const d = seat === direct ? 0 : blastReach(this.sim, x, y, z, s.x, s.y, s.z, s.crouch, r.blastRadius);
      if (d < 0) continue;
      const scale = blastFalloff(d, r.innerRadius, r.blastRadius, r.edgeScale);
      if (scale <= 0) continue;
      let amount = r.damage * scale + (seat === direct ? all.rocket.directDamage : 0);
      if (self) amount *= all.selfDamageScale;
      this.knockback(seat, x, z, r, scale);
      const dmg = Math.round(amount);
      if (dmg > 0) this.host.explosionDamage(attacker, seat, dmg, weapon, x, z);
    }
    this.host.blastOthers?.(attacker, x, y, z, r, kind, directOther);
  }

  /** Add the blast's push to the duck's sim velocity (see the file comment for why it lives in the sim). */
  private knockback(seat: Seat, x: number, z: number, r: BlastRules, scale: number): void {
    const s = seat.sim;
    let dx = s.x - x;
    let dz = s.z - z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.05) {
      dx = 0;
      dz = 0;
    } else {
      dx /= len;
      dz /= len;
    }
    const push = r.knockback * scale;
    const lift = r.lift * scale;
    if (push <= 0 && lift <= 0) return;
    s.vx = f32(s.vx + dx * push);
    s.vz = f32(s.vz + dz * push);
    if (lift > 0) {
      s.vy = f32(Math.max(s.vy, 0) + lift);
      s.grounded = 0;
      s.jumpBuf = 0;
    }
  }

  /** The launcher pickup: at most one, on validated spawn ground away from everyone, collected on contact in sight. */
  private stepPickup(tick: number): void {
    const p = this.rocket;
    if (p && tick >= p.expires) {
      this.rocket = null;
      this.schedule(tick);
    }
    if (this.timedPickups && !this.rocket && tick >= this.nextRocketAt) {
      if (rocketPickupRules().rockets > 0) this.spawnPickup(tick);
      else this.schedule(tick);
    }
    const pick = this.rocket;
    if (!pick) return;
    let best: Seat | null = null;
    let bestD = Infinity;
    for (const s of this.host.seats.values()) {
      if (!s.sim.alive || s.respawnAt >= 0 || s.protect > 0 || s.sim.mode !== Mode.Ground) continue;
      const d = Math.hypot(s.sim.x - pick.x, s.sim.y + 0.8 - pick.y, s.sim.z - pick.z);
      if (d > EXPLOSIVE.rocket.pickupRadius || d > bestD || (d === bestD && best && best.pid < s.pid)) continue;
      if (!this.reaches(s, pick)) continue;
      best = s;
      bestD = d;
    }
    if (!best) return;
    const rockets = rocketPickupRules().rockets;
    setRockets(best.sim, Math.max(exRockets(best.sim), rockets));
    this.rocket = null;
    this.schedule(tick);
    this.events.rocketPicked?.(best, rockets);
  }

  /** Put the launcher pickup here now (Hunt Season boss waves), for `seconds`. */
  placeRocket(x: number, y: number, z: number, tick: number, seconds: number): void {
    this.rocket = { id: `r${++this.serial}`, x, y, z, expires: tick + Math.round(seconds * TICK_RATE) };
  }

  private reaches(s: Seat, p: RocketPickup): boolean {
    const from = { x: s.sim.x, y: s.sim.y + 0.8, z: s.sim.z };
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const dz = p.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const hit = this.sim.world.castRay(new this.sim.rapier.Ray(from, { x: dx / d, y: dy / d, z: dz / d }), d, true, undefined, OPAQUE_QUERY_GROUPS);
    return !hit || hit.timeOfImpact >= d;
  }

  private spawnPickup(tick: number): void {
    const map = this.sim.map;
    const points = map.arenaSpawns.length ? map.arenaSpawns : map.spawns;
    const living = [...this.host.seats.values()].filter((s) => s.sim.alive);
    const far = points.filter(([x, , z]) => living.every((s) => Math.hypot(s.sim.x - x, s.sim.z - z) >= 12));
    const pool = far.length > 0 ? far : points;
    const at = pool[Math.floor(Math.random() * pool.length)];
    if (!at) {
      this.schedule(tick);
      return;
    }
    const [x, y, z] = at;
    const ground = groundHeightAt(this.sim, x, y + (map.id === 'greybox' ? 3 : 0.3), z);
    this.rocket = { id: `r${++this.serial}`, x, y: ground + 0.8, z, expires: tick + EXPLOSIVE.rocket.pickupLifetimeSeconds * TICK_RATE };
  }
}
