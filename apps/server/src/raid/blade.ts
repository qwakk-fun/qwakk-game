/**
 * The katana's hits, server side (Hunt Season v3). The duck's swings, dash,
 * quack and storm are part of the shared sim (shared raid/blade.ts): the
 * sim says when one lands (`lastBlade`), and right after that duck's step
 * this decides what it cut. Never from a client message:
 *
 *   - the swing's shape (shared raid/arc.ts) is swept against the hunters as
 *     the duck saw them: the lag compensated history (hunterHistory.ts) at
 *     the step's view time, bounded by the round trip the server measured
 *     and the rewind cap, exactly like a shot;
 *   - a wall between the duck and a hunter stops the cut (BULLET groups);
 *   - every hunter inside the shape is hit once per swing (a swing cuts
 *     several), the damage and the rest are server numbers (`raid.blade.*`
 *     and the duck's cards): crits on back-stabs and fully charged heavy
 *     spins, stagger and toony knockback (minions are knocked off their feet
 *     by the finisher, the heavy and the quack), bleeding, the heavy's chain;
 *   - the combo counter (3 s without a hit resets it), the Blade Storm meter
 *     (hits and kills fill it; written into the sim), kill streaks, and the
 *     combo's XP bonus (counted here, granted with the rest at the run's end).
 *
 * The duck's client predicts the swing's feel (the trail, the sound, the
 * hit-stop on hunters it draws inside the arc) and learns what really
 * happened from `Msg.RaidHits` (damage numbers) and the state.
 */
import {
  BladeEvent,
  BLADE_SHAPES,
  BULLET_QUERY_GROUPS,
  bladeArcHits,
  comboBonus,
  dashPathHits,
  heavyShape,
  HunterAct,
  HunterKind,
  isMinion,
  RAID_XP,
  setStormMeter,
  stormLeft,
  TICK_RATE,
  type BladeShape,
  type HitTarget,
  type SimWorld,
} from '@qwakk/shared';
import { RaidHitFlags, RaidKillHow } from '@qwakk/shared/net';
import type { Seat } from '../arena.ts';
import type { HunterAgent } from './hunter.ts';
import type { HuntWorld } from './hunts.ts';
import type { RaidRules } from './rules.ts';
import type { DuckStats } from './upgrades.ts';

/** What the blade needs of a duck's run (raid.ts RaidDuck). */
export interface BladeDuck {
  stats: DuckStats;
  kills: number;
  minionKills: number;
  comboXp: number;
  /** The Blade Storm meter as the server counts it (the sim holds its whole part). */
  meter: number;
  /** The duck's level does not allow the storm yet: its meter stays empty. */
  noStorm?: boolean;
}

export interface BladeHost {
  readonly sim: SimWorld;
  readonly rules: RaidRules;
  readonly hunts: HuntWorld;
  duck(seatId: string): BladeDuck | undefined;
  /** Objective targets a cut can hit besides hunters (the supply crates), where they stand now. */
  crates(): HitTarget[];
  /** A cut or a bullet hit a crate: true when it broke. */
  hitCrate(id: string, damage: number, by: Seat): boolean;
  /** Is damage on (an objective in play)? */
  live(): boolean;
  /** Most health the duck may have (its cards). */
  maxHp(seat: Seat): number;
  /** A streak call-out for this duck (kills in quick succession). */
  streak(seat: Seat, kills: number): void;
}

/** Ticks a combo, a streak window and a bleed last. */
const STREAK_TICKS = 60;
const BLEED_TICKS = 90;
const CHAIN_RANGE = 6;
const CHAIN_TARGETS = 3;
const STREAK_CALLS = [3, 5, 8, 12, 16, 20, 25, 30];

interface DuckBlade {
  combo: number;
  lastHit: number;
  killTicks: number[];
  called: number;
  /** Hunters this dash already cut (once per dash). */
  dashCut: Set<string>;
  /** Hits to report this tick: [damage, flags, x, y, z] flattened. */
  hits: number[];
}

/** What a cut does to the hunter it lands on (besides damage): how long it reels, how hard it is pushed, whether it is knocked off its feet. */
interface Impact {
  stagger: number;
  knock: number;
  launch: boolean;
}

export class BladeWorld {
  private readonly host: BladeHost;
  private readonly state = new Map<string, DuckBlade>();
  private tick = 0;
  /** The crit chance roll (tests replace it). */
  rand: () => number = Math.random;

  constructor(host: BladeHost) {
    this.host = host;
  }

  private of(seat: Seat): DuckBlade {
    let s = this.state.get(seat.id);
    if (!s) {
      s = { combo: 0, lastHit: -9999, killTicks: [], called: 0, dashCut: new Set(), hits: [] };
      this.state.set(seat.id, s);
    }
    return s;
  }

  /** The duck's combo right now (0 after the window ran out). */
  combo(seatId: string): number {
    const s = this.state.get(seatId);
    if (!s) return 0;
    return this.tick - s.lastHit <= Math.round(this.host.rules.blade.comboSeconds * TICK_RATE) ? s.combo : 0;
  }

  beginTick(tick: number): void {
    this.tick = tick;
  }

  forget(seatId: string): void {
    this.state.delete(seatId);
  }

  /**
   * Right after a duck's step: what its blade did this tick (`lastBlade`,
   * set by that step). `viewTime` is the step's lag compensated time,
   * (x0, z0) where the duck stood before the step (the dash's path).
   */
  afterStep(seat: Seat, viewTime: number, x0: number, z0: number, kind: number, evStep: number, charge: number): void {
    if (kind === BladeEvent.None || !this.host.live()) return;
    const s = seat.sim;
    const d = this.host.duck(seat.id);
    if (!d) return;
    const r = this.host.rules.blade;
    const st = d.stats;
    // The crit multiplier: the rules' (raid.blade.crit) plus the kit's (Iaido), times the cards'.
    const crit = (r.crit + st.critBonus) * st.crit;
    // Katana cuts carry the kit's katana (gear tier, the tree's Sharp Edge); skills their own numbers.
    if (kind === BladeEvent.Slash) {
      const step = Math.max(1, Math.min(3, evStep));
      const shape = step === 1 ? BLADE_SHAPES.slash1 : step === 2 ? BLADE_SHAPES.slash2 : BLADE_SHAPES.slash3;
      const base = (r.slash[step - 1] ?? 24) * st.damage * st.blade * (step === 3 ? st.finisher : 1);
      const hit: Impact = step === 3 ? { stagger: r.staggerSeconds * 1.6, knock: 6, launch: true } : { stagger: r.staggerSeconds, knock: 1.6, launch: false };
      this.cut(seat, d, viewTime, shape, base, crit, false, hit, RaidKillHow.Blade, true, st.reach);
    } else if (kind === BladeEvent.Heavy) {
      const base = (r.heavy + r.heavyCharge * charge) * st.damage * st.blade * st.heavy;
      const full = charge >= 0.99;
      const hits = this.cut(seat, d, viewTime, heavyShape(charge), base, crit, full, { stagger: r.staggerSeconds * 1.5, knock: 7 + 4 * charge, launch: true }, RaidKillHow.Blade, true, st.reach);
      if (st.chain > 0 && hits.length > 0) this.chain(seat, d, hits, base * st.chain);
    } else if (kind === BladeEvent.Storm) {
      this.cut(seat, d, viewTime, BLADE_SHAPES.storm, r.storm * st.damage * st.blade * st.stormDamage, 1, false, { stagger: 0.2, knock: 2.5, launch: false }, RaidKillHow.Skill, false, 1);
    } else if (kind === BladeEvent.Quack) {
      this.cut(seat, d, viewTime, BLADE_SHAPES.quack, r.quack * st.damage * st.quackDamage, 1, false, { stagger: 1.2 * st.quackStagger, knock: 15, launch: true }, RaidKillHow.Skill, false, st.quackReach);
    } else if (kind === BladeEvent.Dash) {
      const b = this.of(seat);
      if (evStep === 1) b.dashCut.clear();
      const targets = this.host.hunts.targets(viewTime).filter((t) => !t.id.startsWith('t') && !b.dashCut.has(t.id));
      for (const id of dashPathHits(x0, s.y, z0, s.x, s.z, targets)) {
        b.dashCut.add(id);
        const h = this.host.hunts.hunters.get(id);
        if (!h || h.downTicks > 0) continue;
        if (!this.clear(s.x, s.y, s.z, h.x, h.z)) continue;
        this.land(seat, d, h, r.dash * st.damage * st.blade * st.dash, false, { stagger: 0.4, knock: 3, launch: false }, RaidKillHow.Skill, false, RaidHitFlags.Skill, s.x, s.z);
      }
    }
  }

  /** Sweep a shape (its reach times `reach`) and land every hit. Returns the hunters hit. */
  private cut(seat: Seat, d: BladeDuck, viewTime: number, shape: BladeShape, base: number, crit: number, alwaysCrit: boolean, impact: Impact, how: number, blade: boolean, reach: number): HunterAgent[] {
    const s = seat.sim;
    const targets = this.host.hunts.targets(viewTime).concat(this.host.crates());
    const hits = bladeArcHits(s.x, s.y, s.z, s.yaw, shape, targets, reach);
    const out: HunterAgent[] = [];
    for (const a of hits) {
      if (!this.clear(s.x, s.y, s.z, a.x, a.z)) continue;
      if (a.id.startsWith('t')) {
        this.host.hunts.hurtTrap(a.id, base);
        continue;
      }
      if (a.id.startsWith('c')) {
        const broke = this.host.hitCrate(a.id, base, seat);
        this.report(seat, base, RaidHitFlags.Crate | (broke ? RaidHitFlags.Killed : 0), a.x, s.y + 0.8, a.z);
        this.onHit(seat, d, 1);
        continue;
      }
      const h = this.host.hunts.hunters.get(a.id);
      if (!h || h.downTicks > 0) continue;
      // A crit: a fully charged heavy, a back-stab, or the kit's crit chance (the katana's tier, Lucky Edge) on a cut.
      const isCrit = alwaysCrit || (blade && (a.back || (d.stats.critChance > 0 && this.rand() < d.stats.critChance)));
      const flags = (isCrit ? RaidHitFlags.Crit : 0) | (a.back ? RaidHitFlags.Back : 0) | (blade ? 0 : RaidHitFlags.Skill);
      this.land(seat, d, h, base * (isCrit ? crit : 1), blade, impact, how, true, flags, s.x, s.z);
      out.push(h);
    }
    return out;
  }

  /** One hit on one hunter: damage, its reaction, the duck's combo, meter, lifesteal, bleed, the report. */
  private land(seat: Seat, d: BladeDuck, h: HunterAgent, damage: number, blade: boolean, impact: Impact, how: number, bleed: boolean, flags: number, fromX: number, fromZ: number): boolean {
    const before = h.hp;
    const killed = this.host.hunts.hurt(h.id, damage, seat.id, false, fromX, fromZ, how);
    const dealt = Math.max(0, Math.round(before - Math.max(0, h.hp)));
    seat.dealt += dealt;
    if (!killed) this.react(h, impact, fromX, fromZ);
    if (bleed && blade && d.stats.bleedDps > 0 && !killed) {
      h.bleedTicks = BLEED_TICKS;
      h.bleedDps = d.stats.bleedDps;
      h.bleedBy = seat.id;
    }
    if (blade && d.stats.lifesteal > 0 && seat.sim.alive === 1 && seat.sim.down === 0) seat.sim.hp = Math.min(this.host.maxHp(seat), seat.sim.hp + d.stats.lifesteal);
    this.onHit(seat, d, 1);
    this.report(seat, dealt, flags | (killed ? RaidHitFlags.Killed : 0) | (h.elite ? RaidHitFlags.Elite : 0), h.x, h.y + 1.2, h.z);
    return killed;
  }

  /** The hunter reels, is pushed away from the cut and, for a minion, maybe knocked off its feet. The Big Hunter barely moves. */
  private react(h: HunterAgent, impact: Impact, fromX: number, fromZ: number): void {
    const r = this.host.rules.blade;
    const boss = h.kind === HunterKind.Boss;
    const minion = isMinion(h.kind);
    const share = boss ? 0.25 : minion || h.kind === HunterKind.Dog ? 1 : 0.5;
    const ticks = Math.round(impact.stagger * share * TICK_RATE);
    if (ticks > h.stun) {
      h.stun = ticks;
      h.stunAct = impact.launch && minion ? HunterAct.Launched : HunterAct.Stagger;
      // The launch clip (1.1 s) then most of getting up.
      if (h.stunAct === HunterAct.Launched) h.stun = Math.max(h.stun, 45);
    }
    const dx = h.x - fromX;
    const dz = h.z - fromZ;
    const dl = Math.hypot(dx, dz) || 1;
    const push = impact.knock * r.knockScale * (boss ? 0.1 : minion || h.kind === HunterKind.Dog ? 1 : 0.45);
    h.kx += (dx / dl) * push;
    h.kz += (dz / dl) * push;
  }

  /** The heavy's chain lightning: up to three more hunters near the ones it hit, for a share of its damage. */
  private chain(seat: Seat, d: BladeDuck, hit: HunterAgent[], damage: number): void {
    const done = new Set(hit.map((h) => h.id));
    let n = 0;
    for (const from of hit) {
      for (const h of this.host.hunts.hunters.values()) {
        if (n >= CHAIN_TARGETS) return;
        if (h.downTicks > 0 || done.has(h.id) || Math.hypot(h.x - from.x, h.z - from.z) > CHAIN_RANGE) continue;
        done.add(h.id);
        n++;
        this.land(seat, d, h, damage, false, { stagger: 0.3, knock: 0, launch: false }, RaidKillHow.Skill, false, RaidHitFlags.Skill, from.x, from.z);
      }
    }
  }

  /** A clear line from the duck's chest to the hunter (no cutting through walls). */
  private clear(x: number, y: number, z: number, tx: number, tz: number): boolean {
    const sim = this.host.sim;
    const dx = tx - x;
    const dz = tz - z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) return true;
    const hit = sim.world.castRay(new sim.rapier.Ray({ x, y: y + 1.0, z }, { x: dx / dist, y: 0, z: dz / dist }), dist, true, undefined, BULLET_QUERY_GROUPS);
    return !hit || hit.timeOfImpact > dist - 0.35;
  }

  private onHit(seat: Seat, d: BladeDuck, n: number): void {
    const b = this.of(seat);
    const window = Math.round(this.host.rules.blade.comboSeconds * TICK_RATE);
    b.combo = this.tick - b.lastHit <= window ? b.combo + n : n;
    b.lastHit = this.tick;
    this.addMeter(seat, d, this.host.rules.blade.meterPerHit * n);
  }

  private addMeter(seat: Seat, d: BladeDuck, v: number): void {
    if (stormLeft(seat.sim) > 0 || d.noStorm) return;
    d.meter = Math.min(100, d.meter + v * d.stats.storm);
    setStormMeter(seat.sim, d.meter);
  }

  /** A storm started (the sim emptied the meter): the server's count starts over too. */
  stormStarted(seatId: string, d: BladeDuck): void {
    d.meter = 0;
    void seatId;
  }

  /**
   * A hunter this duck bagged (any way: the katana, the pistol, a loaf):
   * the kill counts for the XP (minions apart), the combo bonus rides on it,
   * the meter fills, and quick kills make a streak call-out.
   */
  onKill(seat: Seat, d: BladeDuck, h: HunterAgent): void {
    const minion = isMinion(h.kind);
    if (!h.helper) {
      if (minion) d.minionKills++;
      else if (h.kind !== HunterKind.Boss) d.kills++;
      d.comboXp += comboBonus(minion ? RAID_XP.perMinion : RAID_XP.perKill, this.combo(seat.id));
    }
    this.addMeter(seat, d, this.host.rules.blade.meterPerKill);
    const b = this.of(seat);
    b.killTicks.push(this.tick);
    while (b.killTicks.length > 0 && this.tick - b.killTicks[0]! > STREAK_TICKS) b.killTicks.shift();
    if (b.killTicks.length === 1) b.called = 0;
    const n = b.killTicks.length;
    if (n > b.called && STREAK_CALLS.includes(n)) {
      b.called = n;
      this.host.streak(seat, n);
    }
  }

  private report(seat: Seat, damage: number, flags: number, x: number, y: number, z: number): void {
    const b = this.of(seat);
    if (b.hits.length >= 5 * 40) return;
    b.hits.push(Math.round(damage), flags, Math.round(x * 100), Math.round(y * 100), Math.round(z * 100));
  }

  /** A pistol bullet's hit, reported the same way (damage numbers and the combo). */
  bulletHit(seat: Seat, d: BladeDuck, damage: number, killed: boolean, elite: boolean, x: number, y: number, z: number, crate = false): void {
    this.onHit(seat, d, 1);
    this.report(seat, damage, (killed ? RaidHitFlags.Killed : 0) | (elite ? RaidHitFlags.Elite : 0) | (crate ? RaidHitFlags.Crate : 0), x, y, z);
  }

  /** End of a tick: each duck's hits of this tick, with its combo and meter ([combo, meter, n, ...hits]); cleared. */
  flush(send: (seatId: string, data: number[]) => void, meterOf: (seatId: string) => number): void {
    for (const [id, b] of this.state) {
      if (b.hits.length === 0) continue;
      send(id, [this.combo(id), Math.round(meterOf(id)), b.hits.length / 5, ...b.hits]);
      b.hits.length = 0;
    }
  }
}
