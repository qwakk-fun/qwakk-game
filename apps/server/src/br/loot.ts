/**
 * Loot lying in the world (server only): spawned from the map's loot points
 * with the match seed (items on the floor, contents inside the map's crates),
 * picked up through the input path (the Use button), dropped from the
 * inventory, dropped as a crate when a duck dies. A coarse grid answers "what
 * is near here" for pickups, bots and per-viewer item interest.
 *
 * Crates: a map crate starts closed and its contents are unknown to clients.
 * The Use button on a closed crate opens it (the lid swings up for everyone
 * who can see it); after LOOT.crateOpenTicks its contents can be taken (Use
 * takes everything that fits, the inventory screen takes one item). An opened
 * map crate stays open, empty or not. A dead duck's crate is open from the
 * start and goes away once it is empty.
 */
import {
  applyPickup,
  choosePickup,
  Deny,
  isStack,
  Item,
  LOOT,
  OPAQUE_QUERY_GROUPS,
  PLAYER_QUERY_GROUPS,
  pickupBlock,
  replacedBy,
  rollLoot,
  type Armor,
  type DropItem,
  type ItemExtra,
  type PlayerSim,
  type SimWorld,
} from '@qwakk/shared';

export interface LootEntity {
  id: string;
  kind: number;
  amount: number;
  x: number;
  y: number;
  z: number;
  /** Crates only: what is inside (guns keep their magazine, armor its durability). */
  contents: DropItem[] | null;
  /** A loose item's own magazine or durability (dropped from an inventory); null when new. */
  extra: ItemExtra | null;
  /** Crates: Container.* of a map crate, 0 for a dead duck's crate. */
  box: number;
  /** Crates: map loot point id, -1 when not a map crate. */
  point: number;
  /** Crates: opened (a dead duck's crate is open from the start). */
  open: boolean;
  /** Tick the crate was opened. */
  openTick: number;
  /** Grid cell key. */
  cell: number;
}

export interface LootEvents {
  added(e: LootEntity): void;
  changed(e: LootEntity): void;
  removed(e: LootEntity): void;
}

/** What a Use press or an inventory request did. */
export interface LootResult {
  /** What went into the inventory ([kind, amount] pairs). */
  got: { kind: number; amount: number }[];
  /** A closed crate was opened. */
  opened: LootEntity | null;
  /** Nothing happened, and why (Deny.*), with the item it was about. */
  deny: number;
  denyKind: number;
}

const CELL = 20;
const GRID = 64;

function cellOf(x: number, z: number): number {
  const cx = Math.max(0, Math.min(GRID - 1, Math.floor((x + 640) / CELL)));
  const cz = Math.max(0, Math.min(GRID - 1, Math.floor((z + 640) / CELL)));
  return cz * GRID + cx;
}

const result = (): LootResult => ({ got: [], opened: null, deny: Deny.None, denyKind: 0 });

/** Crates with nothing left in them are no pickup target (an opened map crate stays, empty). */
export function isEmptyCrate(e: LootEntity): boolean {
  return e.kind === Item.Crate && e.open && (e.contents?.length ?? 0) === 0;
}

export class LootWorld {
  readonly items = new Map<string, LootEntity>();
  private readonly grid = new Map<number, Set<LootEntity>>();
  private nextId = 1;
  private readonly sim: SimWorld;
  private readonly ev: LootEvents;
  private readonly now: () => number;
  /** Pickups and crate openings so far (stats). */
  pickups = 0;
  opened = 0;

  /** `now` is the match tick (crate opening timer). */
  constructor(sim: SimWorld, events: LootEvents, now: () => number = () => 0) {
    this.sim = sim;
    this.ev = events;
    this.now = now;
  }

  /** Roll the map's loot points for this match: floor items, and the contents of every map crate. */
  spawnMatchLoot(seed: number): void {
    const points = this.sim.map.br?.loot ?? [];
    const crates = new Map<number, { x: number; y: number; z: number; box: number; contents: DropItem[] }>();
    for (const it of rollLoot(points, seed)) {
      if (it.box === 0) {
        this.add(it.kind, it.amount, it.x, it.y, it.z, null);
        continue;
      }
      let c = crates.get(it.point);
      if (!c) {
        const p = points.find((q) => q.id === it.point);
        crates.set(it.point, (c = { x: p?.x ?? it.x, y: p?.y ?? it.y, z: p?.z ?? it.z, box: it.box, contents: [] }));
      }
      const same = c.contents.find((d) => d.kind === it.kind && it.kind !== Item.Rifle && it.kind !== Item.Pistol);
      if (same) same.amount += it.amount;
      else c.contents.push({ kind: it.kind, amount: it.amount });
    }
    for (const [point, c] of crates) this.add(Item.Crate, 1, c.x, c.y, c.z, c.contents, { box: c.box, point, open: false });
  }

  clear(): void {
    for (const e of [...this.items.values()]) this.remove(e);
  }

  add(
    kind: number,
    amount: number,
    x: number,
    y: number,
    z: number,
    contents: LootEntity['contents'],
    crate: { box: number; point: number; open: boolean } | null = null,
    extra: ItemExtra | null = null,
  ): LootEntity {
    const e: LootEntity = {
      id: `i${this.nextId++}`, kind, amount, x, y, z, contents, extra,
      box: crate?.box ?? 0, point: crate?.point ?? -1, open: crate ? crate.open : kind === Item.Crate, openTick: -1_000_000,
      cell: cellOf(x, z),
    };
    this.items.set(e.id, e);
    let set = this.grid.get(e.cell);
    if (!set) this.grid.set(e.cell, (set = new Set()));
    set.add(e);
    this.ev.added(e);
    return e;
  }

  remove(e: LootEntity): void {
    if (!this.items.delete(e.id)) return;
    this.grid.get(e.cell)?.delete(e);
    this.ev.removed(e);
  }

  /** Items within `r` meters (2D) of (x, z). */
  near(x: number, z: number, r: number, out: LootEntity[] = []): LootEntity[] {
    out.length = 0;
    const c0x = Math.max(0, Math.floor((x - r + 640) / CELL));
    const c1x = Math.min(GRID - 1, Math.floor((x + r + 640) / CELL));
    const c0z = Math.max(0, Math.floor((z - r + 640) / CELL));
    const c1z = Math.min(GRID - 1, Math.floor((z + r + 640) / CELL));
    const r2 = r * r;
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const set = this.grid.get(cz * GRID + cx);
        if (!set) continue;
        for (const e of set) if ((e.x - x) ** 2 + (e.z - z) ** 2 <= r2) out.push(e);
      }
    }
    return out;
  }

  /** Is the item in line of sight from the duck's eye (nothing opaque in between)? */
  reachable(s: PlayerSim, e: LootEntity): boolean {
    return this.clearLine(s, e.x, e.y + 0.2, e.z);
  }

  /** Nothing opaque between the duck's eye and this point (pickups, revives). */
  clearLine(s: PlayerSim, x: number, y: number, z: number): boolean {
    const ey = s.y + (s.crouch ? 1.0 : 1.55);
    const tx = x - s.x;
    const ty = y - ey;
    const tz = z - s.z;
    const d = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (d < 0.05) return true;
    const hit = this.sim.world.castRay(new this.sim.rapier.Ray({ x: s.x, y: ey, z: s.z }, { x: tx / d, y: ty / d, z: tz / d }), d, true, undefined, OPAQUE_QUERY_GROUPS);
    return !hit || hit.timeOfImpact > d - 0.25;
  }

  /** In reach of the duck's chest and in line of sight: the pickup rule. */
  inReach(s: PlayerSim, e: LootEntity): boolean {
    return Math.hypot(e.x - s.x, e.y + 0.15 - (s.y + 0.9), e.z - s.z) <= LOOT.reach && this.reachable(s, e);
  }

  /** Can this crate's contents be taken yet (open, and the lid had time to swing up)? */
  lootable(e: LootEntity): boolean {
    return e.open && this.now() - e.openTick >= LOOT.crateOpenTicks;
  }

  private readonly scratch: LootEntity[] = [];

  /**
   * The Use button: act on the item in reach the duck is looking at, if it is
   * in line of sight. A closed crate opens; an open one gives what fits; an
   * item on the floor goes into the inventory if it fits. Null: nothing in reach.
   */
  tryPickup(s: PlayerSim, armor: Armor): LootResult | null {
    const cp = Math.cos(s.pitch);
    const near = this.near(s.x, s.z, 3.5, this.scratch).filter((e) => !isEmptyCrate(e) && this.reachable(s, e));
    const target = choosePickup(near, s.x, s.y, s.z, -Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp);
    if (!target) return null;
    if (target.kind === Item.Crate && !target.open) return this.openCrate(target);
    return this.take(s, armor, target);
  }

  /** Open a closed map crate (its contents become visible to whoever sees it). */
  openCrate(e: LootEntity): LootResult {
    const r = result();
    if (e.open) return r;
    e.open = true;
    e.openTick = this.now();
    this.opened++;
    this.ev.changed(e);
    r.opened = e;
    return r;
  }

  /**
   * Move what fits from an item, or from a crate (all of it, or only the
   * content at `index`), into the inventory. A replaced vest, helmet or
   * backpack drops at the duck's feet.
   */
  take(s: PlayerSim, armor: Armor, e: LootEntity, index = -1): LootResult {
    const r = result();
    const give = (kind: number, amount: number, extra: ItemExtra): number => {
      const block = pickupBlock(s, armor, kind, extra);
      if (block !== Deny.None) {
        if (r.deny === Deny.None) {
          r.deny = block;
          r.denyKind = kind;
        }
        return 0;
      }
      const old = replacedBy(armor, kind);
      const n = applyPickup(s, armor, kind, amount, extra);
      if (n > 0) {
        r.got.push({ kind, amount: n });
        if (old) this.dropAt(s, old, 0);
      }
      // Part of a stack left behind: say why.
      if (n < amount && isStack(kind) && r.deny === Deny.None) {
        r.deny = pickupBlock(s, armor, kind, extra);
        r.denyKind = kind;
      }
      return n;
    };
    if (e.kind === Item.Crate) {
      if (!this.lootable(e)) {
        r.deny = Deny.Opening;
        r.denyKind = Item.Crate;
        return r;
      }
      const contents = e.contents ?? [];
      const picks = index >= 0 ? contents.slice(index, index + 1) : contents;
      for (const c of picks) c.amount -= give(c.kind, c.amount, c);
      e.contents = contents.filter((c) => c.amount > 0);
      if (e.contents.length === 0 && e.box === 0) this.remove(e);
      else if (r.got.length > 0) this.ev.changed(e);
    } else {
      const n = give(e.kind, e.amount, e.extra ?? {});
      if (n > 0) {
        e.amount -= n;
        if (e.amount <= 0) this.remove(e);
        else this.ev.changed(e);
      }
    }
    if (r.got.length > 0) this.pickups++;
    return r;
  }

  /**
   * A point on the ground next to the duck for a dropped item: a little in
   * front (spread around it by `k`), at the duck's feet when a wall is there.
   */
  private dropSpot(s: PlayerSim, k: number): { x: number; y: number; z: number } {
    const ang = s.yaw + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 0.55;
    const dx = -Math.sin(ang);
    const dz = -Math.cos(ang);
    const R = this.sim.rapier;
    const from = { x: s.x, y: s.y + 0.5, z: s.z };
    const hit = this.sim.world.castRay(new R.Ray(from, { x: dx, y: 0, z: dz }), 1.1, true, undefined, PLAYER_QUERY_GROUPS);
    const reach = hit ? Math.max(0, hit.timeOfImpact - 0.35) : 0.8;
    const x = s.x + dx * reach;
    const z = s.z + dz * reach;
    const down = this.sim.world.castRay(new R.Ray({ x, y: s.y + 0.6, z }, { x: 0, y: -1, z: 0 }), 3, true, undefined, PLAYER_QUERY_GROUPS);
    const y = down ? s.y + 0.6 - down.timeOfImpact : s.y;
    return { x, y: Math.fround(y + 0.02), z };
  }

  private dropCount = 0;

  /** Put an item from an inventory on the ground next to the duck (it keeps its magazine or durability). */
  dropAt(s: PlayerSim, item: DropItem, k = this.dropCount++): LootEntity {
    const p = this.dropSpot(s, k % 7);
    const extra: ItemExtra | null = item.mag !== undefined ? { mag: item.mag } : item.dur !== undefined ? { dur: item.dur } : null;
    return this.add(item.kind, item.amount, p.x, p.y, p.z, null, null, extra);
  }

  /** A dead duck's crate (nothing if it carried nothing). */
  dropCrate(x: number, y: number, z: number, contents: DropItem[]): LootEntity | null {
    if (contents.length === 0) return null;
    return this.add(Item.Crate, 1, x, y, z, contents.map((c) => ({ ...c })));
  }
}
