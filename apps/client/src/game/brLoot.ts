/**
 * Loot as this client knows it (battle royale): the item entries the server
 * sent (only what we have seen; a stale copy until we see the spot again),
 * bound to the world views. Loose items go to the items view; crates drive
 * the crates view (map crates by loot point, dead ducks' crates by entity),
 * their lids swing open when an entry says so, and an open crate's contents
 * are drawn lying inside it. Nothing here decides anything: the server does.
 */
import { Item, extraFrom, unpackContents, type DropItem, type ItemExtra } from '@qwakk/shared';
import type { LootItem } from '@qwakk/shared/net';
import type { CratesView } from '../world/sainte/crates.ts';
import { CrateVariant } from '../world/sainte/crates.ts';
import type { ItemsView } from '../world/sainte/items.ts';

export interface LootEntry {
  /** Schema key, `i<entity>.<version>` (also `id`, for choosePickup). */
  key: string;
  id: string;
  /** Entity number (Msg.Inv take requests name it). */
  num: number;
  kind: number;
  amount: number;
  x: number;
  y: number;
  z: number;
  /** A loose item's own magazine or durability. */
  extra: ItemExtra;
  /** Crates: Container.* of a map crate (0: a dead duck's), the loot point + 1, open, and contents (only once open). */
  box: number;
  pt: number;
  open: boolean;
  contents: DropItem[];
  /** The crates view key, for crates. */
  crate: string | null;
}

/** Ring size around a crate the prompt targets, by variant. */
const RING = [1.15, 1.6, 0.7];

export interface LootHooks {
  /** A lid we watched swing open (sound). */
  opened(x: number, y: number, z: number): void;
  /** Close enough to the camera that an opening should animate (else it snaps). */
  near(x: number, z: number): boolean;
}

export class LootClient {
  readonly entries = new Map<string, LootEntry>();
  /** Per crate: the entry keys we hold for it (a stale copy and its successor can overlap briefly), and the newest. */
  private readonly crateKeys = new Map<string, Set<string>>();
  private readonly latest = new Map<string, string>();
  private readonly shown = new Map<string, number>();
  private readonly items: ItemsView;
  private readonly crates: CratesView | null;
  private readonly hooks: LootHooks;
  /** Crate lids this client saw swing open (test hook stats). */
  opened = 0;

  constructor(items: ItemsView, crates: CratesView | null, hooks: LootHooks) {
    this.items = items;
    this.crates = crates;
    this.hooks = hooks;
  }

  add(key: string, it: LootItem): LootEntry {
    const num = Number(key.slice(1, key.indexOf('.') > 0 ? key.indexOf('.') : undefined));
    const isCrate = it.kind === Item.Crate;
    const e: LootEntry = {
      key, id: key, num, kind: it.kind, amount: it.amount, x: it.x, y: it.y, z: it.z,
      extra: extraFrom(it.kind, it.ex, it.exk === 1),
      box: it.box, pt: it.pt, open: it.open === 1, contents: unpackContents(it.c ?? ''),
      crate: isCrate ? (it.pt > 0 ? `pt:${it.pt - 1}` : `e:${num}`) : null,
    };
    this.entries.set(key, e);
    if (!e.crate) {
      this.items.upsert(key, e.kind, e.x, e.y, e.z);
      return e;
    }
    let set = this.crateKeys.get(e.crate);
    if (!set) this.crateKeys.set(e.crate, (set = new Set()));
    set.add(key);
    const prev = this.latest.get(e.crate);
    this.latest.set(e.crate, key);
    if (prev) this.hideContents(prev);
    const variant = e.pt > 0 ? Math.max(0, e.box - 1) : CrateVariant.Small;
    if (this.crates && e.pt === 0) this.crates.addDynamic(e.crate, CrateVariant.Small, e.x, e.y, e.z, (num * 2.399) % (Math.PI * 2));
    if (this.crates && e.open && !this.crates.isOpen(e.crate)) {
      const animate = this.hooks.near(e.x, e.z);
      this.crates.setOpen(e.crate, true, animate);
      if (animate) {
        this.opened++;
        this.hooks.opened(e.x, e.y, e.z);
      }
    }
    this.items.upsert(key, Item.Crate, e.x, e.y, e.z, { marker: true, ring: RING[variant] ?? 1 });
    this.showContents(e);
    return e;
  }

  remove(key: string): void {
    const e = this.entries.get(key);
    this.entries.delete(key);
    this.items.remove(key);
    if (!e?.crate) return;
    this.hideContents(key);
    const set = this.crateKeys.get(e.crate);
    set?.delete(key);
    if (this.latest.get(e.crate) === key) {
      const next = set && set.size > 0 ? [...set][set.size - 1] : undefined;
      if (next) {
        this.latest.set(e.crate, next);
        const n = this.entries.get(next);
        if (n) this.showContents(n);
      } else this.latest.delete(e.crate);
    }
    // A dead duck's crate goes when we hold nothing of it; a map crate keeps the state we last saw.
    if (set && set.size === 0) {
      this.crateKeys.delete(e.crate);
      if (e.pt === 0) this.crates?.removeDynamic(e.crate);
    }
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.remove(key);
  }

  /** Draw an open crate's contents lying inside it. */
  private showContents(e: LootEntry): void {
    if (!e.crate || !e.open || !this.crates) return;
    const n = e.contents.length;
    e.contents.forEach((c, i) => {
      const s = this.crates?.slot(e.crate as string, i, n);
      if (s) this.items.upsert(`${e.key}#${i}`, c.kind, s.x, s.y, s.z, { still: { yaw: s.yaw, scale: s.scale } });
    });
    this.shown.set(e.key, n);
  }

  private hideContents(key: string): void {
    const n = this.shown.get(key) ?? 0;
    for (let i = 0; i < n; i++) this.items.remove(`${key}#${i}`);
    this.shown.delete(key);
  }

  /** Is this the newest entry we hold for its crate (stale copies are skipped)? */
  private current(e: LootEntry): boolean {
    return !e.crate || this.latest.get(e.crate) === e.key;
  }

  /** The newest entry we hold for every crate (what we last saw of it). */
  *crateStates(): Iterable<LootEntry> {
    for (const key of this.latest.values()) {
      const e = this.entries.get(key);
      if (e) yield e;
    }
  }

  /** What the Use button can target: loose items, closed crates, open crates with something in them. */
  *targets(): Iterable<LootEntry> {
    for (const e of this.entries.values()) {
      if (!this.current(e)) continue;
      if (e.crate && e.open && e.contents.length === 0) continue;
      yield e;
    }
  }
}
