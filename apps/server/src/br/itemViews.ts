/**
 * Loot items per viewer, with the same anti-wallhack idea as the poses: a
 * viewer only learns about an item when it could see it (line of sight from
 * its eye, or within VIS.alwaysRadius), and only learns that an item is gone
 * or changed when it can see that spot again. Until then it keeps a stale
 * copy (a "ghost"), which is harmless: pickups are decided by the server on
 * its own item list, so pressing E on a ghost does nothing.
 *
 * Each item version is its own schema entry (`state.items`, a `.view()` map).
 * A change (part of a stack taken) retires the old entry as a ghost and adds a
 * new one; a pickup retires the entry. Ghost entries are deleted from the map
 * once no viewer holds them any more.
 */
import type { StateView } from '@colyseus/schema';
import { extraValue, packContents, VIS } from '@qwakk/shared';
import { LootItem } from '@qwakk/shared/net';
import type { ViewerPoint } from '../interest.ts';
import type { Visibility } from '../visibility.ts';
import type { LootEntity, LootWorld } from './loot.ts';

type Item = InstanceType<typeof LootItem>;

interface Entry {
  key: string;
  schema: Item;
  x: number;
  y: number;
  z: number;
  /** False once the item is gone or replaced: a ghost kept for viewers who did not see it go. */
  live: boolean;
}

/** Items within NEAR are added (when visible); beyond FAR they leave the view. */
const NEAR = 100;
const FAR = 115;

export interface ItemViewer {
  id: string;
  view: StateView;
  point: ViewerPoint;
}

export class ItemViews {
  private readonly entries = new Map<string, Entry>();
  /** Current entry key per loot entity. */
  private readonly current = new Map<string, string>();
  private readonly viewers = new Map<string, Set<string>>();
  private version = 0;
  private readonly map: Map<string, Item> & { set(k: string, v: Item): unknown; delete(k: string): boolean };
  private readonly vis: Visibility;
  private readonly loot: () => LootWorld;
  /** Line-of-sight tests since the last reset (stats). */
  rays = 0;

  constructor(stateItems: ItemViews['map'], vis: Visibility, loot: () => LootWorld) {
    this.map = stateItems;
    this.vis = vis;
    this.loot = loot;
  }

  addViewer(id: string): void {
    this.viewers.set(id, new Set());
  }

  removeViewer(id: string): void {
    this.viewers.delete(id);
  }

  added(e: LootEntity): void {
    const key = `${e.id}.${this.version++}`;
    const schema = new LootItem();
    schema.kind = e.kind;
    schema.amount = Math.min(65535, e.amount);
    schema.x = e.x;
    schema.y = e.y;
    schema.z = e.z;
    if (e.extra) {
      schema.ex = extraValue(e.kind, e.extra);
      schema.exk = 1;
    }
    if (e.box > 0 || e.contents) {
      schema.box = e.box;
      schema.pt = e.point >= 0 ? e.point + 1 : 0;
      schema.open = e.open ? 1 : 0;
      // A closed crate keeps its secret: contents go out only once it is open.
      if (e.open && e.contents) schema.c = packContents(e.contents);
    }
    this.entries.set(key, { key, schema, x: e.x, y: e.y, z: e.z, live: true });
    this.current.set(e.id, key);
    this.map.set(key, schema);
  }

  /** The stack changed: the old entry becomes a ghost, a fresh one replaces it. */
  changed(e: LootEntity): void {
    this.retire(e.id);
    this.added(e);
  }

  removed(e: LootEntity): void {
    this.retire(e.id);
  }

  private retire(entityId: string): void {
    const key = this.current.get(entityId);
    this.current.delete(entityId);
    const entry = key ? this.entries.get(key) : undefined;
    if (entry) entry.live = false;
  }

  /** Can this viewer see the item's spot? */
  private sees(p: ViewerPoint, x: number, y: number, z: number): boolean {
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz <= VIS.alwaysRadius * VIS.alwaysRadius) return true;
    this.rays++;
    return this.vis.clear(p.x, p.y + (p.crouch ? 1.0 : 1.55), p.z, x, y + 0.3, z);
  }

  /** Bring every viewer's item set up to date (call a few times a second). */
  update(viewers: readonly ItemViewer[]): void {
    const near: LootEntity[] = [];
    for (const v of viewers) {
      const set = this.viewers.get(v.id);
      if (!set) continue;
      const p = v.point;
      // Drop what is far away, and ghosts whose spot the viewer can see again.
      for (const key of [...set]) {
        const e = this.entries.get(key);
        const far = !e || (e.x - p.x) ** 2 + (e.z - p.z) ** 2 > FAR * FAR;
        if (e && !far && (e.live || !this.sees(p, e.x, e.y, e.z))) continue;
        set.delete(key);
        if (e) v.view.remove(e.schema);
      }
      // Add live items that came near and are visible.
      for (const it of this.loot().near(p.x, p.z, NEAR, near)) {
        const key = this.current.get(it.id);
        if (!key || set.has(key)) continue;
        const e = this.entries.get(key);
        if (!e || !this.sees(p, e.x, e.y, e.z)) continue;
        set.add(key);
        v.view.add(e.schema);
      }
    }
    this.collect();
  }

  /** Delete ghost entries nobody holds any more. */
  private collect(): void {
    for (const [key, e] of this.entries) {
      if (e.live) continue;
      let held = false;
      for (const set of this.viewers.values()) {
        if (set.has(key)) {
          held = true;
          break;
        }
      }
      if (held) continue;
      this.entries.delete(key);
      this.map.delete(key);
    }
  }

  /** Test hook: entry keys a viewer holds. */
  heldBy(viewerId: string): string[] {
    return [...(this.viewers.get(viewerId) ?? [])];
  }

  isLive(key: string): boolean {
    return this.entries.get(key)?.live ?? false;
  }
}
