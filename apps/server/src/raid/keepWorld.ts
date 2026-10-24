/**
 * Pond Keep's live state on the server (Hunt Season v2): the QoreChain core,
 * the main gate (health, its look, repairs), the drawbridge (the lever, its
 * travel, the cooldown, coming down by itself), the four bread cannons (who
 * mans them, heat, fire rate) and the loaves in flight. Every number is a
 * server setting (rules.ts). Network free: the raid (raid.ts) wires it to
 * the ducks and the hunters, the room mirrors it into the schema.
 *
 * What reaches the duck sim (raid/man.ts): the KEEP_CLOSED bit while the
 * bridge is not down, the KEEP_GATE_OPEN bit while the gate is broken, and
 * each duck's "cannons taken by others" bits. The
 * manning itself is decided by the sim (Use and Jump presses); here the
 * server only reads it, settles two ducks on one cannon, and fires loaves
 * when a manning duck holds Fire.
 */
import {
  BridgeState,
  cannonAim,
  DT,
  emptyAim,
  exMan,
  ExplosiveKind,
  GATE_CLOSE_SHARE,
  gateStateOf,
  gateInReach,
  KEEP_TOGGLE,
  onDeck,
  KEEP,
  setGateOpen,
  setKeepClosed,
  setMan,
  setOcc,
  setToggle,
  stepBread,
  breadHit,
  TICK_RATE,
  type CannonAim,
  type Flight,
  type HitTarget,
  type KeepGeometry,
  type SimWorld,
} from '@qwakk/shared';
import { LeverDenied } from '@qwakk/shared/net';
import type { Seat } from '../arena.ts';
import type { RaidRules } from './rules.ts';

export interface CannonState {
  /** The manning duck's seat id, or null. */
  seatId: string | null;
  pid: number;
  yaw: number;
  pitch: number;
  /** 0 to 100 (overheats at 100). */
  heat: number;
  /** Overheated: no firing until it cooled below the vent line. */
  hot: boolean;
  /** Tick it may fire again. */
  ready: number;
}

export interface Loaf {
  id: number;
  owner: string;
  cannon: number;
  flight: Flight;
}

export interface KeepEvents {
  coreHit(hp: number): void;
  gateHit(hp: number, state: number): void;
  gateBroken(): void;
  gateFixed(by: Seat | null): void;
  /** The drawbridge starts to rise or come down (by a duck, or by itself). */
  bridgeMoving(state: number, by: Seat | null): void;
  /** A pulled raise did not start: a duck was on the deck when the tick ended. */
  raiseRefused(by: Seat | null): void;
  overheat(seat: Seat, cannon: number): void;
  loafLaunched(l: Loaf): void;
  /** A loaf landed: the raid splashes the hunters around (x, y, z). */
  loafBoom(l: Loaf, x: number, y: number, z: number, hitId: string): void;
}

/** A broken gate pauses a duck's repair this long after the duck is hit (ticks). */
const REPAIR_PAUSE = Math.round(1.5 * TICK_RATE);
/** Holding Use this long starts the repair (no repair on a tap meant for something else). */
const REPAIR_WINDUP = 8;

export class KeepWorld {
  readonly g: KeepGeometry;
  coreHp: number;
  readonly coreMax: number;
  gateHp: number;
  readonly gateMax: number;
  /** Broken: hunters pass until it is repaired past GATE_CLOSE_SHARE. */
  gateBroken = false;
  bridge: number = BridgeState.Down;
  /** Ticks: the current move started and ends; the lever is ready again; a raised bridge comes down by itself. */
  bridgeStart = 0;
  bridgeEnd = 0;
  leverReady = 0;
  autoDown = 0;
  readonly cannons: CannonState[];
  readonly loaves = new Map<number, Loaf>();
  /** Ducks holding Use at the gate: ticks held, and a hit pauses it until then. */
  private readonly repairs = new Map<string, { held: number; pausedUntil: number }>();
  private readonly aim: CannonAim = emptyAim();
  private serial = 0;
  private tick = 0;
  private readonly sim: SimWorld;
  private readonly rules: RaidRules;
  private readonly ev: KeepEvents;

  constructor(sim: SimWorld, g: KeepGeometry, rules: RaidRules, events: KeepEvents) {
    this.sim = sim;
    this.g = g;
    this.rules = rules;
    this.ev = events;
    this.coreMax = rules.coreHp;
    this.coreHp = rules.coreHp;
    this.gateMax = rules.gateHp;
    this.gateHp = rules.gateHp;
    this.cannons = g.cannons.map((c) => ({ seatId: null, pid: 0, yaw: c.yaw, pitch: 0, heat: 0, hot: false, ready: 0 }));
    setToggle(sim, KEEP_TOGGLE.gate, true);
    setToggle(sim, KEEP_TOGGLE.bridgeUp, false);
  }

  get gateState(): number {
    return gateStateOf(this.gateHp / Math.max(1, this.gateMax), this.gateBroken);
  }

  /** The bridge is walkable (hunters and ducks may cross, hunters may reach the gate). */
  get bridgeDown(): boolean {
    return this.bridge === BridgeState.Down;
  }

  // ---- the core and the gate ------------------------------------------------------

  damageCore(amount: number): void {
    const was = this.coreHp;
    this.coreHp = Math.max(0, this.coreHp - amount);
    if (Math.floor(was / 25) !== Math.floor(this.coreHp / 25) || this.coreHp <= 0) this.ev.coreHit(Math.ceil(this.coreHp));
  }

  repairCore(amount: number): void {
    this.coreHp = Math.min(this.coreMax, this.coreHp + amount);
  }

  /** Hunters at the gate (only while the bridge is down: a raised bridge covers it). */
  damageGate(amount: number): void {
    if (this.gateBroken || !this.bridgeDown || amount <= 0) return;
    const was = this.gateHp;
    const look = this.gateState;
    this.gateHp = Math.max(0, this.gateHp - amount);
    if (this.gateHp <= 0) {
      this.gateBroken = true;
      setToggle(this.sim, KEEP_TOGGLE.gate, false);
      this.ev.gateBroken();
      return;
    }
    if (Math.floor(was / 25) !== Math.floor(this.gateHp / 25) || this.gateState !== look) this.ev.gateHit(Math.ceil(this.gateHp), this.gateState);
  }

  /** A hit on a duck pauses its gate repair. */
  duckHurt(seatId: string): void {
    const r = this.repairs.get(seatId);
    if (r) {
      r.pausedUntil = this.tick + REPAIR_PAUSE;
      r.held = 0;
    }
  }

  /**
   * One tick of a duck holding Use (or not) at the gate. Returns true while
   * it repairs. A broken gate that gets back past GATE_CLOSE_SHARE holds
   * hunters again.
   */
  stepRepair(seat: Seat, holding: boolean): boolean {
    const s = seat.sim;
    if (!holding || s.alive !== 1 || s.down === 1 || exMan(s) > 0 || !gateInReach(this.g, s.x, s.y, s.z) || this.gateHp >= this.gateMax) {
      this.repairs.delete(seat.id);
      return false;
    }
    let r = this.repairs.get(seat.id);
    if (!r) {
      r = { held: 0, pausedUntil: 0 };
      this.repairs.set(seat.id, r);
    }
    if (this.tick < r.pausedUntil) return false;
    if (++r.held < REPAIR_WINDUP) return false;
    // (The look follows in the state; GateHit is for hunters at the gate only.)
    this.gateHp = Math.min(this.gateMax, this.gateHp + this.rules.gateRepairPerSecond / TICK_RATE);
    if (this.gateBroken && this.gateHp >= this.gateMax * GATE_CLOSE_SHARE) {
      this.gateBroken = false;
      setToggle(this.sim, KEEP_TOGGLE.gate, true);
      this.ev.gateFixed(seat);
    }
    return true;
  }

  /** Is this duck repairing the gate right now (tests, the HUD note)? */
  repairing(seatId: string): boolean {
    const r = this.repairs.get(seatId);
    return !!r && r.held >= REPAIR_WINDUP && this.tick >= r.pausedUntil;
  }

  // ---- the drawbridge ---------------------------------------------------------------

  /**
   * A duck pulls the lever: raise a lowered bridge or lower a raised one.
   * Returns 0 when the pull is taken, else why not (LeverDenied). `deckBusy`:
   * a duck stands on the deck now (the bridge never rises under a duck).
   * A raise only starts at the end of the tick, once every duck has stepped
   * (`step`): a duck that reached the deck later in the same tick refuses it
   * there, and from the next tick on the KEEP_CLOSED bit keeps every duck
   * off the deck before it steps.
   */
  pullLever(by: Seat | null, tick: number, deckBusy: boolean): number {
    if (this.bridge === BridgeState.Raising || this.bridge === BridgeState.Lowering || this.raisePending) return LeverDenied.Moving;
    if (tick < this.leverReady) return LeverDenied.Cooldown;
    if (this.bridge === BridgeState.Down) {
      if (deckBusy) return LeverDenied.DuckOnBridge;
      this.raisePending = { by };
      return 0;
    }
    this.move(BridgeState.Lowering, by, tick);
    this.leverReady = tick + Math.round(this.rules.bridgeCooldownSeconds * TICK_RATE);
    return 0;
  }

  /** A raise pulled this tick, started at the tick's end if the deck is clear. */
  private raisePending: { by: Seat | null } | null = null;

  /** Seconds until the lever moves again (0: ready). */
  leverSeconds(tick: number): number {
    return Math.max(0, Math.ceil((this.leverReady - tick) / TICK_RATE));
  }

  private move(state: number, by: Seat | null, tick: number): void {
    this.bridge = state;
    this.bridgeStart = tick;
    this.bridgeEnd = tick + Math.max(1, Math.round(this.rules.bridgeMoveSeconds * TICK_RATE));
    if (state === BridgeState.Raising) setToggle(this.sim, KEEP_TOGGLE.bridgeUp, true);
    this.ev.bridgeMoving(state, by);
  }

  /** Is any living duck on the deck (or about to step on it)? */
  deckBusy(seats: Iterable<Seat>): boolean {
    for (const s of seats) if (s.sim.alive === 1 && onDeck(this.g, s.sim.x, s.sim.z, KEEP.bridgeMargin + 0.15)) return true;
    return false;
  }

  /** Test hooks and tests: the bridge straight to a state (no lever, no cooldown). */
  forceBridge(state: number, tick: number): void {
    if (state === BridgeState.Down || state === BridgeState.Up) {
      this.bridge = state;
      this.bridgeStart = tick;
      this.bridgeEnd = tick;
      this.autoDown = state === BridgeState.Up ? tick + Math.round(this.rules.bridgeUpMaxSeconds * TICK_RATE) : 0;
      setToggle(this.sim, KEEP_TOGGLE.bridgeUp, state === BridgeState.Up);
    }
  }

  // ---- the tick -----------------------------------------------------------------------

  /** A pulled raise (deck clear at the tick's end), the bridge's travel and auto-lowering, the cannons' cooling, the keep's bits on every duck. */
  step(tick: number, seats: readonly Seat[]): void {
    this.tick = tick;
    const pending = this.raisePending;
    this.raisePending = null;
    if (pending && this.bridge === BridgeState.Down) {
      if (this.deckBusy(seats)) this.ev.raiseRefused(pending.by);
      else {
        this.move(BridgeState.Raising, pending.by, tick);
        this.leverReady = tick + Math.round(this.rules.bridgeCooldownSeconds * TICK_RATE);
      }
    }
    if (this.bridge === BridgeState.Raising && tick >= this.bridgeEnd) {
      this.bridge = BridgeState.Up;
      this.autoDown = tick + Math.round(this.rules.bridgeUpMaxSeconds * TICK_RATE);
    } else if (this.bridge === BridgeState.Up && tick >= this.autoDown) {
      this.move(BridgeState.Lowering, null, tick);
      this.leverReady = Math.max(this.leverReady, tick + Math.round(this.rules.bridgeCooldownSeconds * TICK_RATE));
    } else if (this.bridge === BridgeState.Lowering && tick >= this.bridgeEnd) {
      this.bridge = BridgeState.Down;
      this.autoDown = 0;
      setToggle(this.sim, KEEP_TOGGLE.bridgeUp, false);
    }
    const closed = this.bridge !== BridgeState.Down;
    for (const s of seats) {
      setKeepClosed(s.sim, closed);
      setGateOpen(s.sim, this.gateBroken);
    }
    const cool = this.rules.cannon.coolPerSecond / TICK_RATE;
    for (const c of this.cannons) {
      c.heat = Math.max(0, c.heat - cool);
      if (c.hot && c.heat < this.rules.cannon.ventBelow) c.hot = false;
    }
  }

  /**
   * Who mans which cannon, from the ducks' sim bits (the sim mans and leaves
   * on its own): two ducks on one cannon keep the one that was there first;
   * then every duck learns which cannons the others hold. The barrels turn
   * toward where their duck aims (the same aim the loaf takes).
   */
  syncManning(seats: readonly Seat[]): void {
    const claim: (Seat | null)[] = this.cannons.map(() => null);
    for (const s of seats) {
      const m = exMan(s.sim);
      if (m === 0) continue;
      // Knocked or out: off the cannon at once (the sim does the same on the duck's next step).
      if (s.sim.alive !== 1 || s.sim.down === 1) {
        setMan(s.sim, 0);
        continue;
      }
      const i = m - 1;
      if (i >= this.cannons.length) {
        setMan(s.sim, 0);
        continue;
      }
      const cur = claim[i];
      if (!cur) claim[i] = s;
      else if (this.cannons[i]!.seatId === s.id) {
        setMan(cur.sim, 0);
        claim[i] = s;
      } else setMan(s.sim, 0);
    }
    let all = 0;
    for (let i = 0; i < this.cannons.length; i++) {
      const c = this.cannons[i]!;
      const s = claim[i] ?? null;
      c.seatId = s?.id ?? null;
      c.pid = s?.pid ?? 0;
      if (s) {
        all |= 1 << i;
        const a = cannonAim(this.sim, this.g, i, s.sim, 1, this.aim);
        c.yaw = a.yaw;
        c.pitch = a.pitch;
      } else {
        const base = this.g.cannons[i]!.yaw;
        const d = wrap(base - c.yaw);
        c.yaw = wrap(c.yaw + Math.max(-0.05, Math.min(0.05, d)));
        c.pitch += (0 - c.pitch) * 0.1;
      }
    }
    for (const s of seats) {
      const mine = exMan(s.sim);
      setOcc(s.sim, all & ~(mine > 0 ? 1 << (mine - 1) : 0));
    }
  }

  /** A manning duck holds Fire: a loaf if the cannon is ready and not overheated. Returns the loaf or null. */
  fire(seat: Seat, side: number, tick: number): Loaf | null {
    const m = exMan(seat.sim);
    if (m === 0) return null;
    const i = m - 1;
    const c = this.cannons[i];
    if (!c || c.seatId !== seat.id || c.hot || tick < c.ready) return null;
    const r = this.rules.cannon;
    const a = cannonAim(this.sim, this.g, i, seat.sim, side, this.aim);
    c.yaw = a.yaw;
    c.pitch = a.pitch;
    c.ready = tick + Math.max(1, Math.round(r.reloadSeconds * TICK_RATE));
    c.heat += r.heatPerShot;
    if (c.heat >= 100) {
      c.heat = 100;
      c.hot = true;
      this.ev.overheat(seat, i);
    }
    const flight: Flight = { kind: ExplosiveKind.Bread, x: a.x, y: a.y, z: a.z, vx: a.vx, vy: a.vy, vz: a.vz, age: 0, rest: 0 };
    const loaf: Loaf = { id: ++this.serial, owner: seat.id, cannon: i, flight };
    this.loaves.set(loaf.id, loaf);
    this.ev.loafLaunched(loaf);
    return loaf;
  }

  /** Loaves fly a step; one that hits the world or a hunter (`targets`, current positions) bursts. */
  stepLoaves(targets: readonly HitTarget[]): void {
    for (const l of [...this.loaves.values()]) {
      if (!stepBread(this.sim, l.flight, DT, targets)) continue;
      this.loaves.delete(l.id);
      this.ev.loafBoom(l, breadHit.x, breadHit.y, breadHit.z, breadHit.kind === 2 ? breadHit.id : '');
    }
  }

  /** A duck left the run: its cannon is free (its sim is gone with it). */
  duckLeft(seatId: string): void {
    for (const c of this.cannons) if (c.seatId === seatId) {
      c.seatId = null;
      c.pid = 0;
    }
    this.repairs.delete(seatId);
  }

  /** A break between waves: the castle crew patches the gate a little (`raid.gateBreakRepairPercent`). */
  breakRepair(): void {
    if (this.rules.gateBreakRepair <= 0 || this.gateHp >= this.gateMax) return;
    this.setGate(this.gateHp + this.gateMax * this.rules.gateBreakRepair);
  }

  /** Test hooks: set the gate's health (0 breaks it). */
  setGate(hp: number): void {
    this.gateHp = Math.max(0, Math.min(this.gateMax, hp));
    const broken = this.gateHp <= 0 || (this.gateBroken && this.gateHp < this.gateMax * GATE_CLOSE_SHARE);
    if (broken !== this.gateBroken) {
      this.gateBroken = broken;
      setToggle(this.sim, KEEP_TOGGLE.gate, !broken);
      if (broken) this.ev.gateBroken();
      else this.ev.gateFixed(null);
    }
  }
}

function wrap(a: number): number {
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

