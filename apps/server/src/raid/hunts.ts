/**
 * The hunters' side of a run: the wave director (spawns from the shared wave
 * math), every hunter's tick (brain.ts), their health and defeat, the
 * trapper's traps, the decoys in flight and the drops they leave. Network
 * free; the raid (raid.ts) owns the ducks and tells the room what happened
 * through the host. Server only.
 */
import {
  blastFalloff,
  blastReach,
  DT,
  emptyFlight,
  ExplosiveKind,
  groundHeightAt,
  HUNTER_HP,
  HunterAct,
  HunterKind,
  hunterHpScale,
  hunterShape,
  isBossWave,
  MOVE_QUERY_GROUPS,
  RAID,
  spawnGapSeconds,
  stepGrenade,
  TRAP_SHAPE,
  TICK_RATE,
  waveComposition,
  type Flight,
  type HitTarget,
  type SimWorld,
} from '@qwakk/shared';
import { RaidDrop } from '@qwakk/shared/net';
import type { BotNav, P3 } from '../nav/botNav.ts';
import { thinkHunter, towerCenter, hunterHurtFrom, type HuntContext } from './brain.ts';
import { fireHunterGun, type ShotTrace } from './gun.ts';
import { BITE, DECOY, KIND, newHunter, TRAP, WHISTLE, type GunNumbers, type HunterAgent } from './hunter.ts';
import { HunterHistory } from './hunterHistory.ts';
import type { RaidRules } from './rules.ts';
import type { DuckTarget } from './sight.ts';
import { towerDistance, towerSpot, type TowerInfo } from './spawns.ts';

export interface TrapState {
  id: string;
  x: number;
  y: number;
  z: number;
  /** 0 setting, 1 armed, 2 sprung (holds a duck, then breaks). */
  state: number;
  armAt: number;
  until: number;
  hp: number;
  owner: string;
}

export interface DecoyState {
  id: number;
  flight: Flight;
  fuse: number;
}

export interface DropState {
  id: string;
  kind: number;
  x: number;
  y: number;
  z: number;
  until: number;
}

/** What the hunts need from the raid. */
export interface HuntHost {
  readonly sim: SimWorld;
  nav(): BotNav | null;
  readonly rules: RaidRules;
  /** Every duck in the world (alive or not; `standing` says who can be hunted). */
  ducks(): readonly DuckTarget[];
  hurtDuck(duckId: string, amount: number, fromX: number, fromZ: number, kind: number, head: boolean): void;
  rootDuck(duckId: string): void;
  damageTower(amount: number, h: HunterAgent): void;
  shotFx(h: HunterAgent, traces: readonly ShotTrace[], weapon: number): void;
  hunterDown(h: HunterAgent, killerId: string | null, head: boolean): void;
  whistle(h: HunterAgent): void;
  decoyLaunched(d: DecoyState): void;
  decoyBoom(d: DecoyState, x: number, y: number, z: number): void;
}

type Unit = { kind: number; count: number };

export class HuntWorld {
  readonly hunters = new Map<string, HunterAgent>();
  readonly traps = new Map<string, TrapState>();
  readonly decoys = new Map<number, DecoyState>();
  readonly drops = new Map<string, DropState>();
  readonly history = new HunterHistory();
  /** Hunters a boss whistled up (still standing ones count against its next whistle). */
  private readonly helperIds = new Set<string>();
  private queue: Unit[] = [];
  private nextSpawn = 0;
  private serial = 0;
  private wave = 0;
  private ducksInRun = 1;
  private tick = 0;
  /** Seconds since the wave began, past which stragglers walk straight to the tower. */
  private waveStartTick = 0;
  private readonly host: HuntHost;
  private readonly tower: TowerInfo;
  private readonly spawns: P3[];
  private readonly towerY: number;

  constructor(host: HuntHost, tower: TowerInfo, spawns: P3[]) {
    this.host = host;
    this.tower = tower;
    this.spawns = spawns;
    towerCenter.x = tower.x;
    towerCenter.z = tower.z;
    this.towerY = groundHeightAt(host.sim, tower.x + tower.half + 2, 40, tower.z);
  }

  /** Hunters still to beat this wave: standing and still to come. */
  get left(): number {
    let n = 0;
    for (const h of this.hunters.values()) if (h.downTicks === 0) n++;
    for (const u of this.queue) n += u.count;
    return n;
  }

  get alive(): number {
    let n = 0;
    for (const h of this.hunters.values()) if (h.downTicks === 0) n++;
    return n;
  }

  get boss(): HunterAgent | null {
    for (const h of this.hunters.values()) if (h.kind === HunterKind.Boss && h.downTicks === 0) return h;
    return null;
  }

  /** Every hunter of this wave is spawned and beaten. */
  get cleared(): boolean {
    return this.queue.length === 0 && this.alive === 0;
  }

  /** A new wave's spawn queue (shuffled, the boss early). */
  startWave(wave: number, ducks: number, tick: number): void {
    this.wave = wave;
    this.ducksInRun = ducks;
    this.waveStartTick = tick;
    const c = waveComposition(wave, ducks);
    const units: Unit[] = [];
    for (let i = 0; i < c.rifleman; i++) units.push({ kind: HunterKind.Rifleman, count: 1 });
    for (let i = 0; i < c.trapper; i++) units.push({ kind: HunterKind.Trapper, count: 1 });
    for (let i = 0; i < c.decoy; i++) units.push({ kind: HunterKind.Decoy, count: 1 });
    for (let i = 0; i < c.dog / 3; i++) units.push({ kind: HunterKind.Dog, count: 3 });
    for (let i = units.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [units[i], units[j]] = [units[j]!, units[i]!];
    }
    // The opening spawn is always a rifleman (readable start), the boss comes third.
    const first = units.findIndex((u) => u.kind === HunterKind.Rifleman);
    if (first > 0) units.unshift(...units.splice(first, 1));
    if (c.boss) units.splice(Math.min(2, units.length), 0, { kind: HunterKind.Boss, count: 1 });
    this.queue = units;
    this.nextSpawn = tick + Math.round(1.5 * TICK_RATE);
    this.helperIds.clear();
  }

  /** Everything gone (the run ended or a test reset). */
  clear(): void {
    this.hunters.clear();
    this.traps.clear();
    this.decoys.clear();
    this.drops.clear();
    this.queue = [];
    this.history.clear();
    this.helperIds.clear();
  }

  /** Tests and the e2e (test hooks): beat every hunter of this wave now. */
  defeatAll(killerId: string | null): void {
    this.queue = [];
    for (const h of this.hunters.values()) if (h.downTicks === 0) this.defeat(h, killerId, false);
  }

  private spawnAt(kind: number, count: number, near?: P3): void {
    const ducks = this.host.ducks().filter((d) => d.standing);
    const pts = near ? [near] : this.spawns.filter((p) => ducks.every((d) => Math.hypot(d.x - p.x, d.z - p.z) > 18));
    const at = (pts.length > 0 ? pts : this.spawns)[Math.floor(Math.random() * Math.max(1, (pts.length > 0 ? pts : this.spawns).length))] ?? { x: 0, y: 10, z: 60 };
    const baseHp = HUNTER_HP[kind] ?? 90;
    const hp = Math.round(baseHp * hunterHpScale(this.wave, this.ducksInRun, kind) * this.host.rules.hunterHpScale);
    for (let i = 0; i < count; i++) {
      const id = `h${++this.serial}`;
      const ox = count > 1 ? (i - (count - 1) / 2) * 1.2 : 0;
      const x = at.x + ox;
      const z = at.z + (count > 1 ? (i % 2) * 0.8 : 0);
      const y = groundHeightAt(this.host.sim, x, at.y + 2, z);
      const yaw = Math.atan2(x - this.tower.x, z - this.tower.z);
      const h = newHunter(id, this.serial, kind, x, y, z, yaw, hp, this.tick);
      // Stand on the side of the tower it comes from.
      h.slot = Math.atan2(z - this.tower.z, x - this.tower.x) + (Math.random() - 0.5) * 1.2;
      this.hunters.set(id, h);
      if (near) {
        this.helperIds.add(id);
        h.helper = true;
      }
    }
  }

  private helpers(): number {
    let n = 0;
    for (const id of this.helperIds) {
      const h = this.hunters.get(id);
      if (h && h.downTicks === 0) n++;
      else this.helperIds.delete(id);
    }
    return n;
  }

  /** One tick: spawns, every hunter, traps, decoys, drops, the lag history. */
  step(tick: number, nowMs: number, live: boolean): void {
    this.tick = tick;
    if (live) this.director(tick);
    const ducks = this.host.ducks();
    const avoid: { x: number; z: number }[] = [];
    for (const h of this.hunters.values()) if (h.downTicks === 0) avoid.push(h);
    for (const d of ducks) if (d.standing) avoid.push(d);
    const ctx = this.context(tick, ducks, avoid);
    for (const h of [...this.hunters.values()]) {
      if (h.downTicks > 0) {
        if (--h.downTicks === 0) this.hunters.delete(h.id);
        continue;
      }
      if (!live) {
        h.act = HunterAct.Idle;
        continue;
      }
      thinkHunter(h, ctx);
    }
    this.stepTraps(tick, ducks);
    this.stepDecoys(ducks);
    this.history.record(nowMs, [...this.hunters.values()].map((h) => ({ id: h.id, x: h.x, y: h.y, z: h.z, yaw: h.yaw, kind: h.kind, act: h.act, alive: h.downTicks === 0 })));
  }

  private director(tick: number): void {
    if (this.queue.length === 0 || tick < this.nextSpawn) return;
    const unit = this.queue[0]!;
    if (this.alive + unit.count > this.host.rules.maxLive) return;
    this.queue.shift();
    this.spawnAt(unit.kind, unit.count);
    this.nextSpawn = tick + Math.round(spawnGapSeconds(this.wave) * TICK_RATE * (unit.count > 1 ? 1.6 : 1));
  }

  private context(tick: number, ducks: readonly DuckTarget[], avoid: { x: number; z: number }[]): HuntContext {
    const host = this.host;
    const nav = host.nav();
    return {
      sim: host.sim,
      nav,
      tick,
      rules: host.rules,
      ducks,
      avoid,
      lastWave: this.wave >= RAID.waves,
      // The last few of a wave, or a wave past two minutes: no more sniping from afar.
      push: (this.queue.length === 0 && this.alive <= 3) || tick - this.waveStartTick > 120 * TICK_RATE,
      towerSpot: (h) => towerSpot(this.tower, h.slot, nav, this.towerY),
      atTower: (h) => towerDistance(this.tower, h.x, h.z) <= this.tower.reach,
      fire: (h, g, yaw, pitch) => this.fire(h, g, yaw, pitch, ducks),
      bite: (h, d) => host.hurtDuck(d.id, BITE.damage * host.rules.hunterDamageScale, h.x, h.z, h.kind, false),
      placeTrap: (h, x, y, z) => this.placeTrap(h, x, y, z, tick),
      throwDecoy: (h, x, y, z) => this.throwDecoy(h, x, y, z),
      whistle: (h) => {
        host.whistle(h);
        const near = this.spawns.slice().sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z))[0];
        // The same cap as the wave's own spawns: never more than raid.maxLive alive.
        const max = host.rules.maxLive;
        if (this.alive + 3 <= max) this.spawnAt(HunterKind.Dog, 3, near);
        if (this.wave >= 10 && this.alive + 1 <= max) this.spawnAt(HunterKind.Rifleman, 1, near);
      },
      whistleOpen: tick - this.waveStartTick < WHISTLE.stopAfterTicks,
      hammer: (h) => {
        h.hammerTicks++;
        host.damageTower(((RAID.towerDps[h.kind] ?? 4) * host.rules.towerDamageScale) / TICK_RATE, h);
      },
      helpers: () => this.helpers(),
    };
  }

  private fire(h: HunterAgent, g: GunNumbers, yaw: number, pitch: number, ducks: readonly DuckTarget[]): void {
    const r = fireHunterGun(this.host.sim, h, g, yaw, pitch, this.host.rules.spread, this.host.rules.hunterDamageScale, ducks);
    // One weapon code per sound: the rifle crack (0) for riflemen, the pistol slot (1) stands for a shotgun boom.
    this.host.shotFx(h, r.traces, h.kind === HunterKind.Rifleman ? 0 : 1);
    const sum = new Map<string, { dmg: number; head: boolean }>();
    for (const p of r.hits) {
      const e = sum.get(p.duck.id) ?? { dmg: 0, head: false };
      e.dmg += p.damage;
      e.head ||= p.head;
      sum.set(p.duck.id, e);
    }
    for (const [id, e] of sum) this.host.hurtDuck(id, e.dmg, h.x, h.z, h.kind, e.head);
  }

  // ---- damage to hunters ----------------------------------------------------

  /** A duck's shot or blast hurt a hunter. Returns true when it was defeated. */
  hurt(id: string, amount: number, byId: string | null, head: boolean, fromX: number, fromZ: number): boolean {
    const h = this.hunters.get(id);
    if (!h || h.downTicks > 0 || amount <= 0) return false;
    h.hp -= amount;
    if (byId) {
      h.hurtBy.add(byId);
      h.lastHitBy = byId;
    }
    hunterHurtFrom(h, fromX, fromZ);
    if (h.hp > 0) return false;
    this.defeat(h, byId, head);
    return true;
  }

  private defeat(h: HunterAgent, killerId: string | null, head: boolean): void {
    h.hp = 0;
    h.act = HunterAct.Down;
    h.downTicks = Math.round(1.6 * TICK_RATE);
    this.host.hunterDown(h, killerId, head);
    this.maybeDrop(h);
  }

  private maybeDrop(h: HunterAgent): void {
    if (h.helper) return;
    const r = this.host.rules;
    const roll = Math.random() * 100;
    let kind = 0;
    if (h.kind === HunterKind.Boss) kind = RaidDrop.Heal;
    else if (roll < r.dropHealPercent) kind = RaidDrop.Heal;
    else if (roll < r.dropHealPercent + r.dropAmmoPercent) kind = RaidDrop.Ammo;
    if (!kind) return;
    const add = (k: number, ox: number): void => {
      const id = `d${++this.serial}`;
      this.drops.set(id, { id, kind: k, x: h.x + ox, y: h.y + 0.5, z: h.z, until: this.tick + 25 * TICK_RATE });
    };
    add(kind, 0);
    if (h.kind === HunterKind.Boss) add(RaidDrop.Ammo, 1.2);
  }

  /** Blast damage to hunters and traps (a duck's grenade or rocket): falloff through what stops a bullet. */
  blast(x: number, y: number, z: number, radius: number, inner: number, edge: number, damage: number, byId: string | null, directId: string | null, directBonus: number): number {
    let defeated = 0;
    for (const h of [...this.hunters.values()]) {
      if (h.downTicks > 0) continue;
      if (Math.abs(h.x - x) > radius + 1 || Math.abs(h.z - z) > radius + 1) continue;
      const d = h.id === directId ? 0 : blastReach(this.host.sim, x, y, z, h.x, h.y, h.z, 0, radius);
      if (d < 0) continue;
      const k = blastFalloff(d, inner, radius, edge);
      const amount = damage * k + (h.id === directId ? directBonus : 0);
      if (amount > 0 && this.hurt(h.id, amount, byId, false, x, z)) defeated++;
    }
    for (const t of [...this.traps.values()]) if (Math.hypot(t.x - x, t.z - z) < radius) this.traps.delete(t.id);
    return defeated;
  }

  /** Hunter and trap hitboxes for a shot taken at `viewTime` (hunters lag compensated; traps do not move). */
  targets(viewTime: number): HitTarget[] {
    const out = this.history.sample(viewTime);
    for (const t of this.traps.values()) if (t.state !== 2) out.push({ id: t.id, x: t.x, y: t.y, z: t.z, crouch: 0, yaw: 0, shape: TRAP_SHAPE });
    return out;
  }

  /** Hunters now (rockets fly through the present). */
  current(): HitTarget[] {
    const out: HitTarget[] = [];
    for (const h of this.hunters.values()) {
      if (h.downTicks > 0) continue;
      out.push({ id: h.id, x: h.x, y: h.y, z: h.z, crouch: 0, yaw: h.yaw, shape: hunterShape(h.kind, h.act) });
    }
    return out;
  }

  /** A shot at a trap: it breaks once its health is gone. */
  hurtTrap(id: string, amount: number): boolean {
    const t = this.traps.get(id);
    if (!t) return false;
    t.hp -= amount;
    if (t.hp > 0) return false;
    this.traps.delete(id);
    return true;
  }

  // ---- traps, decoys, drops ---------------------------------------------------

  private placeTrap(h: HunterAgent, x: number, y: number, z: number, tick: number): void {
    let mine = 0;
    for (const t of this.traps.values()) if (t.owner === h.id) mine++;
    if (mine >= TRAP.perTrapper || this.traps.size >= TRAP.max) return;
    // On open ground only: a clear line from the hunter's hands to the spot.
    const from = { x: h.x, y: h.y + 1.0, z: h.z };
    const dx = x - from.x;
    const dz = z - from.z;
    const d = Math.hypot(dx, dz);
    const sim = this.host.sim;
    if (d > 0.2) {
      const hit = sim.world.castRay(new sim.rapier.Ray(from, { x: dx / d, y: 0, z: dz / d }), d, true, undefined, MOVE_QUERY_GROUPS);
      if (hit) {
        x = from.x + (dx / d) * Math.max(0, hit.timeOfImpact - 0.6);
        z = from.z + (dz / d) * Math.max(0, hit.timeOfImpact - 0.6);
      }
    }
    const gy = groundHeightAt(sim, x, Math.max(y, h.y) + 1.5, z);
    const id = `t${++this.serial}`;
    this.traps.set(id, { id, x, y: gy, z, state: 0, armAt: tick + TRAP.arm, until: tick + TRAP.lifeSeconds * TICK_RATE, hp: TRAP.hp, owner: h.id });
  }

  private stepTraps(tick: number, ducks: readonly DuckTarget[]): void {
    for (const t of [...this.traps.values()]) {
      if (tick >= t.until) {
        this.traps.delete(t.id);
        continue;
      }
      if (t.state === 0 && tick >= t.armAt) t.state = 1;
      if (t.state !== 1) continue;
      for (const d of ducks) {
        if (!d.standing || Math.hypot(d.x - t.x, d.z - t.z) > TRAP.radius || Math.abs(d.y - t.y) > 1) continue;
        t.state = 2;
        // Sprung: it holds the duck, then breaks shortly after the root ends.
        t.until = tick + RAID.rootTicks + 15;
        this.host.rootDuck(d.id);
        this.host.hurtDuck(d.id, TRAP.damage * this.host.rules.hunterDamageScale, t.x, t.z, HunterKind.Trapper, false);
        break;
      }
    }
  }

  private throwDecoy(h: HunterAgent, x: number, y: number, z: number): void {
    const f = emptyFlight(ExplosiveKind.Decoy);
    f.x = h.x - Math.sin(h.yaw) * 0.4;
    f.y = h.y + 1.6;
    f.z = h.z - Math.cos(h.yaw) * 0.4;
    // A lob that lands on the spot: flight time from the distance, then the launch velocity under the grenade's gravity (18 m/s²).
    const dx = x - f.x;
    const dz = z - f.z;
    const dist = Math.hypot(dx, dz);
    const T = Math.max(0.6, Math.min(1.4, dist / 13));
    f.vx = dx / T;
    f.vz = dz / T;
    f.vy = (y + 0.2 - f.y + 0.5 * 18 * T * T) / T;
    const d: DecoyState = { id: ++this.serial, flight: f, fuse: DECOY.fuse };
    this.decoys.set(d.id, d);
    this.host.decoyLaunched(d);
  }

  private stepDecoys(ducks: readonly DuckTarget[]): void {
    for (const d of [...this.decoys.values()]) {
      stepGrenade(this.host.sim, d.flight, DT);
      if (--d.fuse > 0 && d.flight.y > -40) continue;
      this.decoys.delete(d.id);
      const f = d.flight;
      this.host.decoyBoom(d, f.x, f.y, f.z);
      for (const duck of ducks) {
        if (!duck.standing) continue;
        const reach = blastReach(this.host.sim, f.x, f.y + 0.25, f.z, duck.x, duck.y, duck.z, duck.crouch, DECOY.radius);
        if (reach < 0) continue;
        const k = blastFalloff(reach, DECOY.inner, DECOY.radius, 0.2);
        if (k > 0) this.host.hurtDuck(duck.id, DECOY.damage * k * this.host.rules.hunterDamageScale, f.x, f.z, HunterKind.Decoy, false);
      }
    }
  }

  /** Drops: expire, and a standing duck that touches one takes it (`take` says whether it could use it). */
  stepDrops(tick: number, take: (duckId: string, kind: number) => boolean): void {
    const ducks = this.host.ducks();
    for (const d of [...this.drops.values()]) {
      if (tick >= d.until) {
        this.drops.delete(d.id);
        continue;
      }
      for (const duck of ducks) {
        if (!duck.standing || Math.hypot(duck.x - d.x, duck.z - d.z) > 1.4 || Math.abs(duck.y + 0.5 - d.y) > 1.6) continue;
        if (take(duck.id, d.kind)) {
          this.drops.delete(d.id);
          break;
        }
      }
    }
  }

  /** Tests: spawn one hunter of a kind at a point. */
  spawnForTest(kind: number, x: number, z: number): HunterAgent {
    const before = new Set(this.hunters.keys());
    this.spawnAt(kind, 1, { x, y: groundHeightAt(this.host.sim, x, 40, z), z });
    const id = [...this.hunters.keys()].find((k) => !before.has(k))!;
    this.helperIds.delete(id);
    const h = this.hunters.get(id)!;
    h.helper = false;
    return h;
  }

  /** Is the boss wave's boss out (for the rocket pickup)? */
  get bossWave(): boolean {
    return isBossWave(this.wave);
  }

  /** The kind numbers (tests). */
  static kind(k: number) {
    return KIND[k];
  }
}
