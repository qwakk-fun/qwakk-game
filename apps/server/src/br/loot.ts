/**
 * Loot lying in the world (server only): spawned from the map's loot points
 * with the match seed, picked up through the input path (the Use button),
 * dropped as a crate when a duck dies. A coarse grid answers "what is near
 * here" for pickups, bots and per-viewer item interest.
 */
import {
  applyPickup,
  choosePickup,
  Item,
  OPAQUE_QUERY_GROUPS,
  rollLoot,
  type Armor,
  type DropItem,
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
  /** Grid cell key. */
  cell: number;
}

export interface LootEvents {
  added(e: LootEntity): void;
  changed(e: LootEntity): void;
  removed(e: LootEntity): void;
}

const CELL = 20;
const GRID = 64;

function cellOf(x: number, z: number): number {
  const cx = Math.max(0, Math.min(GRID - 1, Math.floor((x + 640) / CELL)));
  const cz = Math.max(0, Math.min(GRID - 1, Math.floor((z + 640) / CELL)));
  return cz * GRID + cx;
}

export class LootWorld {
  readonly items = new Map<string, LootEntity>();
  private readonly grid = new Map<number, Set<LootEntity>>();
  private nextId = 1;
  private readonly sim: SimWorld;
  private readonly ev: LootEvents;
  /** Pickups so far (stats). */
  pickups = 0;

  constructor(sim: SimWorld, events: LootEvents) {
    this.sim = sim;
    this.ev = events;
  }

  /** Roll the map's loot points for this match. */
  spawnMatchLoot(seed: number): void {
    const points = this.sim.map.br?.loot ?? [];
    for (const it of rollLoot(points, seed)) this.add(it.kind, it.amount, it.x, it.y, it.z, null);
  }

  clear(): void {
    for (const e of [...this.items.values()]) this.remove(e);
  }

  add(kind: number, amount: number, x: number, y: number, z: number, contents: LootEntity['contents']): LootEntity {
    const e: LootEntity = { id: `i${this.nextId++}`, kind, amount, x, y, z, contents, cell: cellOf(x, z) };
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
    const ey = s.y + (s.crouch ? 1.0 : 1.55);
    const tx = e.x - s.x;
    const ty = e.y + 0.2 - ey;
    const tz = e.z - s.z;
    const d = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (d < 0.05) return true;
    const hit = this.sim.world.castRay(new this.sim.rapier.Ray({ x: s.x, y: ey, z: s.z }, { x: tx / d, y: ty / d, z: tz / d }), d, true, undefined, OPAQUE_QUERY_GROUPS);
    return !hit || hit.timeOfImpact > d - 0.25;
  }

  private readonly scratch: LootEntity[] = [];

  /**
   * The Use button: pick up the item in reach the duck is looking at, if it is
   * in line of sight. Returns what was taken ([kind, amount] pairs) or null.
   */
  tryPickup(s: PlayerSim, armor: Armor): { kind: number; amount: number }[] | null {
    const cp = Math.cos(s.pitch);
    const near = this.near(s.x, s.z, 3.5, this.scratch).filter((e) => this.reachable(s, e));
    const target = choosePickup(near, s.x, s.y, s.z, -Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp);
    if (!target) return null;
    return this.take(s, armor, target);
  }

  /** Move what fits from an item (or a crate's contents) into the inventory. */
  take(s: PlayerSim, armor: Armor, e: LootEntity): { kind: number; amount: number }[] | null {
    const got: { kind: number; amount: number }[] = [];
    if (e.kind === Item.Crate && e.contents) {
      for (const c of e.contents) {
        const n = applyPickup(s, armor, c.kind, c.amount, c);
        if (n > 0) {
          got.push({ kind: c.kind, amount: n });
          c.amount -= n;
        }
      }
      e.contents = e.contents.filter((c) => c.amount > 0);
      if (e.contents.length === 0) this.remove(e);
      else if (got.length > 0) this.ev.changed(e);
    } else {
      const n = applyPickup(s, armor, e.kind, e.amount);
      if (n > 0) {
        got.push({ kind: e.kind, amount: n });
        e.amount -= n;
        if (e.amount <= 0) this.remove(e);
        else this.ev.changed(e);
      }
    }
    if (got.length === 0) return null;
    this.pickups++;
    return got;
  }

  /** A dead duck's crate (nothing if it carried nothing). */
  dropCrate(x: number, y: number, z: number, contents: DropItem[]): LootEntity | null {
    if (contents.length === 0) return null;
    return this.add(Item.Crate, 1, x, y, z, contents.map((c) => ({ ...c })));
  }
}
