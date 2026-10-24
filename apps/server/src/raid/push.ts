/**
 * The push director (Hunt Season v3): the run's objectives placed on Pond
 * Keep from the map's markup, their progress, and the packs it sends. The
 * ducks start in the castle and cut their way out; every objective's ground
 * is the packs' rally point, so the fight meets them out there:
 *
 *   1  Trench   the south-east trench line: bag `trenchKills` hunters around it
 *   2  Crates   the hunters' supply crates by the southern dugouts: smash them
 *   3  Towers   the two southern watchtowers: their snipers (placed on the
 *               platforms; the reason to dash and use the pistol) must fall
 *   4  Camp     the Big Hunter's camp at the far end of the hunters' road:
 *               bring him down and the run is won
 *
 * Packs of minions (Beaters and Recruits) come every few seconds from the
 * trench exits and dugout doors near the objective (never within 25 m of a
 * standing duck), escorted by elites (the old hunter kinds, tougher, ringed).
 * Server only (Math.random); every number is a `raid.*` admin setting or
 * the shared push.ts math.
 */
import {
  CRATE_SHAPE,
  crateHpFor,
  eliteKinds,
  Goal,
  goalAt,
  groundHeightAt,
  HunterKind,
  packElites,
  packSize,
  PUSH,
  RAID,
  TargetKind,
  TICK_RATE,
  trenchKillsFor,
  type HitTarget,
  type KeepGeometry,
  type SimWorld,
} from '@qwakk/shared';
import type { BotNav, P3 } from '../nav/botNav.ts';
import type { HunterAgent } from './hunter.ts';
import type { HuntWorld } from './hunts.ts';
import type { RaidRules } from './rules.ts';

export interface PushTarget {
  id: string;
  kind: number;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  done: boolean;
}

export interface PushEvents {
  started(index: number, goal: number): void;
  cleared(index: number): void;
  targetDone(t: PushTarget): void;
}

/** The objectives' places on the map, derived once from the markup (and the navmesh when it is ready). */
export interface PushLayout {
  trench: P3;
  crates: P3[];
  towers: P3[];
  camp: P3;
}

/** Seconds into an objective after which ducks hiding in the castle draw the hunters to its gate. */
const CASTLE_RAID_AFTER = 40;

const mean = (pts: readonly (readonly [number, number])[]): { x: number; z: number } => {
  let x = 0;
  let z = 0;
  for (const [a, b] of pts) {
    x += a / pts.length;
    z += b / pts.length;
  }
  return { x, z };
};

/** Where the objectives are on Pond Keep (or any keep map with trenches, spawns and perches): all south of the gate. */
export function pushLayout(sim: SimWorld, g: KeepGeometry, nav: BotNav | null): PushLayout {
  const on = (x: number, z: number): P3 => {
    const p = nav?.closest({ x, y: 4, z }, { x: 4, y: 8, z: 4 });
    if (p) return p;
    return { x, y: groundHeightAt(sim, x, 40, z), z };
  };
  const out = { x: g.gate.nx, z: g.gate.nz };
  const ahead = (x: number, z: number): number => (x - g.core.x) * out.x + (z - g.core.z) * out.z;
  const side = (x: number, z: number): number => (x - g.core.x) * -out.z + (z - g.core.z) * out.x;
  // The trench: the line in front of the gate on its right-hand side (Pond Keep: the south-east one).
  const trenches = g.mark.trenches.map((t) => mean(t)).filter((c) => ahead(c.x, c.z) > 20);
  trenches.sort((a, b) => side(b.x, b.z) - side(a.x, a.z));
  const t = trenches[0] ?? { x: g.gate.x + out.x * 50, z: g.gate.z + out.z * 50 };
  // Dugout doors: the spawn points farthest out in front of the gate, one on each side; a crate a few meters in front of each, and one between them.
  const far = g.mark.hunterSpawns.filter(([x, , z]) => ahead(x, z) > 40).sort((a, b) => Math.hypot(b[0], b[2]) - Math.hypot(a[0], a[2]));
  const right = far.filter(([x, , z]) => side(x, z) > 10)[0];
  const left = far.filter(([x, , z]) => side(x, z) < -10)[0];
  const crates: P3[] = [];
  const toward = (x: number, z: number, m: number): P3 => {
    const d = Math.hypot(x - g.core.x, z - g.core.z) || 1;
    return on(x - ((x - g.core.x) / d) * m, z - ((z - g.core.z) / d) * m);
  };
  if (right) crates.push(toward(right[0], right[2], 3.5));
  const mid = toward(g.gate.x + out.x * 62, g.gate.z + out.z * 62, 0);
  crates.push(mid);
  if (left) crates.push(toward(left[0], left[2], 3.5));
  // Watchtowers: the two perches in front of the gate that stand highest (the platforms), right then left.
  const perches = g.mark.sniperPerches.filter(([x, , z]) => ahead(x, z) > 20).sort((a, b) => b[1] - a[1]).slice(0, 2);
  perches.sort((a, b) => side(b[0], b[2]) - side(a[0], a[2]));
  const towers = perches.map(([x, y, z]) => ({ x, y: groundHeightAt(sim, x, y + 2, z), z }));
  // The camp: at the far end of the hunters' road, straight out from the gate.
  const camp = on(g.gate.x + out.x * 100, g.gate.z + out.z * 100);
  return { trench: on(t.x, t.z), crates, towers, camp };
}

export class PushDirector {
  /** 1-based objective in play, 0 before the run. */
  index = 0;
  goal: number = Goal.Trench;
  done = 0;
  need = 0;
  readonly targets = new Map<string, PushTarget>();
  /** The objective's ground (the marker, the packs' rally point). */
  rally: P3 = { x: 0, y: 0, z: 0 };
  /** Hunters the towers objective placed (snipers) and the boss of the camp. */
  private readonly tagged = new Set<string>();
  private nextPack = 0;
  private serial = 0;
  private ducks = 1;
  private layout: PushLayout | null = null;
  private readonly sim: SimWorld;
  private readonly g: KeepGeometry;
  private readonly hunts: HuntWorld;
  private readonly rules: RaidRules;
  private readonly nav: () => BotNav | null;
  private readonly ev: PushEvents;
  /** Tests and the benchmark: no packs (only what the objective places). */
  quiet = false;
  /** Seconds into an objective after which ducks hiding in the castle draw the hunters to its gate. */
  castleRaidAfter = CASTLE_RAID_AFTER;

  constructor(sim: SimWorld, g: KeepGeometry, hunts: HuntWorld, rules: RaidRules, nav: () => BotNav | null, events: PushEvents) {
    this.sim = sim;
    this.g = g;
    this.hunts = hunts;
    this.rules = rules;
    this.nav = nav;
    this.ev = events;
  }

  /** The layout, worked out once the navmesh is there (spots snap onto it). */
  places(): PushLayout {
    const nav = this.nav();
    if (!this.layout || (nav && !this.layoutOnNav)) {
      this.layout = pushLayout(this.sim, this.g, nav);
      this.layoutOnNav = !!nav;
    }
    return this.layout;
  }
  private layoutOnNav = false;

  get count(): number {
    return RAID.objectives;
  }

  /** Objective `index` (1-based) starts: its markers, its placed hunters, the first pack soon. */
  start(index: number, ducks: number, tick: number): void {
    this.index = index;
    this.goal = goalAt(index);
    this.ducks = Math.max(1, ducks);
    this.done = 0;
    this.targets.clear();
    this.tagged.clear();
    this.hunts.setStage(index, this.ducks);
    const L = this.places();
    const p = this.rules.push;
    if (this.goal === Goal.Trench) {
      this.rally = L.trench;
      this.need = trenchKillsFor(this.ducks, p.trenchKills);
    } else if (this.goal === Goal.Crates) {
      const hp = crateHpFor(this.ducks, p.crateHp);
      const spots = L.crates.slice(0, Math.max(1, Math.min(L.crates.length, p.crates)));
      // More crates than spots: the extra ones next to the others.
      for (let i = spots.length; i < p.crates; i++) {
        const s = L.crates[i % L.crates.length]!;
        spots.push({ x: s.x + 2.2, y: s.y, z: s.z + 1.4 });
      }
      for (const s of spots) {
        const id = `c${++this.serial}`;
        this.targets.set(id, { id, kind: TargetKind.Crate, x: s.x, y: s.y, z: s.z, hp, maxHp: hp, done: false });
      }
      this.need = spots.length;
      this.rally = spots[0]!;
    } else if (this.goal === Goal.Towers) {
      this.need = 0;
      L.towers.forEach((t, i) => {
        const id = `w${++this.serial}`;
        this.targets.set(id, { id, kind: TargetKind.Tower, x: t.x, y: t.y, z: t.z, hp: 0, maxHp: 0, done: false });
        const snipers = this.hunts.spawnGroup(HunterKind.Sniper, p.snipersPerTower, t, null, 0.9, true);
        for (const h of snipers) {
          h.perchFixed = true;
          h.guard = i;
          this.tagged.add(h.id);
        }
        this.need += snipers.length;
        // A couple of riflemen at the foot of each tower.
        const foot = this.hunts.spawnsNear(t.x, t.z, 60, 0)[0];
        if (foot) for (const h of this.hunts.spawnGroup(HunterKind.Rifleman, 2, foot, t)) h.guard = i;
      });
      this.rally = L.towers[0] ?? L.camp;
    } else {
      const c = L.camp;
      this.targets.set('camp', { id: 'camp', kind: TargetKind.Camp, x: c.x, y: c.y, z: c.z, hp: 0, maxHp: 0, done: false });
      const boss = this.hunts.spawnGroup(HunterKind.Boss, 1, c, c, 0, true)[0];
      if (boss) this.tagged.add(boss.id);
      this.hunts.spawnGroup(HunterKind.Rifleman, 2, { x: c.x + 3, y: c.y, z: c.z + 2 }, c);
      this.hunts.spawnGroup(HunterKind.Beater, 6, { x: c.x - 3, y: c.y, z: c.z - 2 }, c);
      this.need = 1;
      this.rally = c;
    }
    this.hunts.rally = this.rally;
    // Ducks that stay in the castle for long get raided at its gate.
    this.hunts.castleRaidFrom = tick + Math.round(this.castleRaidAfter * TICK_RATE);
    this.nextPack = tick + Math.round(1.5 * TICK_RATE);
    this.ev.started(index, this.goal);
  }

  /** One tick while the objective is in play: a pack when it is due (and there is room). */
  step(tick: number): void {
    if (this.index === 0 || this.quiet || tick < this.nextPack) return;
    const gap = (PUSH.packGap[this.index - 1] ?? 6) * this.rules.push.packGapScale;
    const minions = Math.max(1, Math.round(packSize(this.index, this.ducks, Math.random()) * this.rules.waveScale));
    // A pack waits until it fits under the live cap. One bigger than the cap could ever hold (a small `raid.maxLive`, a big
    // `raid.waveScale`) shrinks to what fits with a little room for its elites, so the packs never stop for good.
    const cap = this.hunts.liveCap;
    const size = Math.min(minions, Math.max(3, cap - 4));
    if (this.hunts.alive + size > cap) {
      this.nextPack = tick + TICK_RATE;
      return;
    }
    this.nextPack = tick + Math.round(gap * TICK_RATE);
    this.sendPack(size);
  }

  /** A pack: minions (Beaters and Recruits) and its elites, out of a spawn near the objective. */
  sendPack(minions: number): HunterAgent[] {
    const r = this.rally;
    const spots = this.hunts.spawnsNear(r.x, r.z, 75);
    const at = spots[Math.floor(Math.random() * Math.min(3, spots.length))] ?? this.hunts.spawnsNear(r.x, r.z, 400)[0];
    if (!at) return [];
    const beaters = Math.round(minions * 0.55);
    const out = [...this.hunts.spawnGroup(HunterKind.Beater, beaters, at, r), ...this.hunts.spawnGroup(HunterKind.Recruit, minions - beaters, { x: at.x + 1.5, y: at.y, z: at.z + 1.5 }, r)];
    const kinds = eliteKinds(this.index);
    const elites = Math.round(packElites(this.index, this.ducks, Math.random(), Math.random()) * Math.min(1.5, this.rules.waveScale));
    for (let i = 0; i < elites; i++) {
      const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
      out.push(...this.hunts.spawnGroup(kind, kind === HunterKind.Dog ? 2 : 1, { x: at.x - 1.5, y: at.y, z: at.z - 1.5 }, r));
    }
    return out;
  }

  /** A hunter was bagged at (x, z): progress for the trench (kills on its ground) and the towers (their snipers); the camp falls with its boss. */
  hunterDown(h: HunterAgent): void {
    if (this.index === 0) return;
    if (this.goal === Goal.Trench) {
      if (!h.helper && Math.hypot(h.x - this.rally.x, h.z - this.rally.z) <= PUSH.zoneRadius) this.done = Math.min(this.need, this.done + 1);
    } else if (this.goal === Goal.Towers) {
      if (!this.tagged.has(h.id)) return;
      this.done++;
      // A tower whose snipers are all down is taken; the packs turn to the next.
      const tower = [...this.targets.values()].filter((t) => t.kind === TargetKind.Tower)[h.guard];
      if (tower && !tower.done && ![...this.hunts.hunters.values()].some((o) => o.id !== h.id && o.downTicks === 0 && this.tagged.has(o.id) && o.guard === h.guard)) {
        tower.done = true;
        this.ev.targetDone(tower);
        const next = [...this.targets.values()].find((t) => !t.done);
        if (next) this.setRally(next);
      }
    } else if (this.goal === Goal.Camp) {
      if (this.tagged.has(h.id)) {
        this.done = 1;
        const camp = this.targets.get('camp');
        if (camp) camp.done = true;
      }
    }
  }

  private setRally(t: { x: number; y: number; z: number }): void {
    this.rally = { x: t.x, y: t.y, z: t.z };
    this.hunts.rally = this.rally;
  }

  /** Crate hitboxes for cuts and bullets (crates still standing). */
  crateTargets(): HitTarget[] {
    const out: HitTarget[] = [];
    for (const t of this.targets.values()) if (t.kind === TargetKind.Crate && !t.done) out.push({ id: t.id, x: t.x, y: t.y, z: t.z, crouch: 0, yaw: 0, shape: CRATE_SHAPE });
    return out;
  }

  /** Damage to a crate; true when it breaks (the objective counts it, the packs turn to the next crate). */
  hitCrate(id: string, damage: number): boolean {
    const t = this.targets.get(id);
    if (!t || t.done || damage <= 0) return false;
    t.hp = Math.max(0, t.hp - damage);
    if (t.hp > 0) return false;
    t.done = true;
    this.done++;
    this.ev.targetDone(t);
    const next = [...this.targets.values()].find((x) => !x.done);
    if (next) this.setRally(next);
    return true;
  }

  /** Test hooks only: the objective cannot be taken while frozen (the e2e's kit test fights near it). */
  frozen = false;

  /** Is the objective in play taken? */
  get complete(): boolean {
    return !this.frozen && this.index > 0 && this.need > 0 && this.done >= this.need;
  }

  /** Tests and the e2e (test hooks): take the objective now. */
  completeNow(): void {
    this.done = this.need;
    for (const t of this.targets.values()) t.done = true;
  }
}
