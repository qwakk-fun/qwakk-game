/**
 * The caped hero (deathmatch), server authoritative. Five seconds into a
 * round, and then every `dm.heroEverySeconds` while nobody holds the cape, a
 * random living duck (human or bot) becomes the hero: the hero bit in its sim
 * (it flies, heroFlight.ts), full flight energy and `dm.heroHealth` health.
 * Whoever takes the hero down takes the cape (and a bonus, see Deathmatch).
 * The hero earns `dm.heroHoldPoints` every DM_HERO.holdEverySeconds.
 *
 * The hero ping is the one deliberate exception to the anti-wallhack rule
 * (CLAUDE.md): every DM_HERO.pingEverySeconds everyone but the hero gets the
 * hero's position rounded to a DM_HERO.pingGrid meter grid, a public mode
 * objective like the pickups. Never a pose, never finer than the grid.
 */
import { DM_HERO, HERO_FLIGHT, isHero, setHero, TICK_RATE } from '@qwakk/shared';
import { DmHeroEvent as HeroEvent } from '@qwakk/shared/net';
import type { Seat } from './arena.ts';
import { dmHeroRules } from './settings/index.ts';

export { HeroEvent };

export interface HeroEvents {
  /** Chosen (other null), took the cape from `other`, or lost (`hero`: the old hero; nobody holds it now). */
  hero(event: number, hero: Seat, other: Seat | null): void;
  /** The coarse ping (grid meters) for everyone but the hero. */
  ping(hero: Seat, x: number, z: number): void;
  /** Points for holding the cape. */
  award(hero: Seat, points: number): void;
}

/** The hero ping position: rounded to the ping grid, nothing finer. */
export function coarseHeroPos(x: number, z: number, grid: number = DM_HERO.pingGrid): { x: number; z: number } {
  return { x: Math.round(x / grid) * grid, z: Math.round(z / grid) * grid };
}

export class DmHero {
  /** Seat id of the hero, or null. */
  heroId: string | null = null;
  /** Health a fresh hero gets (the setting when the last hero was made). */
  health: number = DM_HERO.health;
  private nextPick = 0;
  private nextHold = 0;
  private nextPing = 0;
  private readonly ev: HeroEvents;
  /** Picks a random seat from the candidates (tests pass their own). */
  private readonly pickRandom: <T>(list: readonly T[]) => T | undefined;

  constructor(events: HeroEvents, pick: <T>(list: readonly T[]) => T | undefined = (list) => list[Math.floor(Math.random() * list.length)]) {
    this.ev = events;
    this.pickRandom = pick;
  }

  /** A new round: no hero; the first pick comes DM_HERO.firstDelaySeconds in. */
  reset(tick: number, seats: Iterable<Seat>): void {
    for (const s of seats) setHero(s.sim, false);
    this.heroId = null;
    this.health = dmHeroRules().health;
    this.nextPick = tick + DM_HERO.firstDelaySeconds * TICK_RATE;
  }

  /** The round ended: the cape comes off, no pings until the next round. */
  clear(seats: Iterable<Seat>): void {
    for (const s of seats) {
      setHero(s.sim, false);
      s.sim.dmEnergy = 0;
    }
    this.heroId = null;
  }

  /** Make this seat the hero (from a pick, or from taking the cape). */
  crown(tick: number, seat: Seat, from: Seat | null): void {
    const rules = dmHeroRules();
    this.health = rules.health;
    setHero(seat.sim, true);
    seat.sim.hp = rules.health;
    seat.sim.dmEnergy = HERO_FLIGHT.energyTicks;
    this.heroId = seat.id;
    this.nextHold = tick + DM_HERO.holdEverySeconds * TICK_RATE;
    // A new hero keeps the ping cadence: never more often than every pingEverySeconds.
    this.nextPing = Math.max(this.nextPing, tick);
    this.ev.hero(from ? HeroEvent.Took : HeroEvent.Chosen, seat, from);
  }

  /**
   * A duck died. The hero's cape goes to its killer (a living enemy duck), or
   * is free until the next pick. Returns true when the victim was the hero.
   */
  killed(tick: number, killer: Seat | null, victim: Seat, enemies: boolean): boolean {
    if (victim.id !== this.heroId) return false;
    setHero(victim.sim, false);
    victim.sim.dmEnergy = 0;
    this.heroId = null;
    if (killer && killer !== victim && enemies && killer.sim.alive === 1 && killer.respawnAt < 0) this.crown(tick, killer, victim);
    else this.vacate(victim);
    return true;
  }

  /** The hero left the room. */
  forget(seat: Seat): void {
    if (seat.id === this.heroId) this.vacate(seat);
  }

  /** Nobody holds the cape: the next regular check picks a new hero. */
  private vacate(old: Seat): void {
    this.heroId = null;
    this.ev.hero(HeroEvent.Lost, old, null);
  }

  /** Once per playing tick: the pick, the hold points and the ping. */
  step(tick: number, seats: ReadonlyMap<string, Seat>): void {
    let hero = this.heroId ? seats.get(this.heroId) : undefined;
    // Lost without a kill (a fall off the map respawns the duck with a fresh sim).
    if (this.heroId && (!hero || hero.sim.alive !== 1 || !isHero(hero.sim))) {
      if (hero) {
        setHero(hero.sim, false);
        this.vacate(hero);
      } else this.heroId = null;
      hero = undefined;
    }
    // Checks on a fixed schedule from the round start: a free cape waits for the next one.
    if (tick >= this.nextPick) {
      const rules = dmHeroRules();
      this.nextPick = tick + rules.everySeconds * TICK_RATE;
      if (!hero && rules.on) {
        const living = [...seats.values()].filter((s) => s.sim.alive === 1 && s.respawnAt < 0);
        const pick = this.pickRandom(living);
        if (pick) {
          this.crown(tick, pick, null);
          hero = pick;
        }
      }
    }
    if (!hero) return;
    if (tick >= this.nextHold) {
      this.nextHold = tick + DM_HERO.holdEverySeconds * TICK_RATE;
      const points = dmHeroRules().holdPoints;
      if (points > 0) this.ev.award(hero, points);
    }
    if (tick >= this.nextPing) {
      this.nextPing = tick + DM_HERO.pingEverySeconds * TICK_RATE;
      const p = coarseHeroPos(hero.sim.x, hero.sim.z);
      this.ev.ping(hero, p.x, p.z);
    }
  }
}
