/**
 * Lag compensation: a short history of every player's hitbox state, so a shot
 * is judged against where the shooter actually saw the targets.
 *
 * We keep our own history instead of Colyseus `allowRewindState` because the
 * targets are drawn from quantized near/far poses on per-viewer timelines, and
 * a pure buffer is easy to unit test. One snapshot per tick, linear
 * interpolation between snapshots, rewind capped (COMBAT.maxRewindMs).
 */
import type { HitTarget } from '@qwakk/shared';

interface Snapshot {
  time: number;
  ids: string[];
  data: Float64Array; // x, y, z, crouch, alive per id
}

const STRIDE = 5;

export interface HistoryEntry {
  id: string;
  x: number;
  y: number;
  z: number;
  crouch: number;
  alive: number;
}

export class LagHistory {
  private readonly ring: Snapshot[] = [];
  private head = 0;
  private count = 0;
  private readonly capacity: number;

  /** @param capacity snapshots kept (ticks); covers the rewind cap plus a margin. */
  constructor(capacity = 12) {
    this.capacity = capacity;
  }

  record(time: number, entries: Iterable<HistoryEntry>): void {
    const ids: string[] = [];
    const vals: number[] = [];
    for (const e of entries) {
      ids.push(e.id);
      vals.push(e.x, e.y, e.z, e.crouch, e.alive);
    }
    const snap: Snapshot = { time, ids, data: Float64Array.from(vals) };
    // Two ticks in one wake-up share a timestamp: keep only the newest.
    if (this.count > 0) {
      const lastIdx = (this.head - 1 + this.capacity) % this.capacity;
      if ((this.ring[lastIdx] as Snapshot).time === time) {
        this.ring[lastIdx] = snap;
        return;
      }
    }
    if (this.ring.length < this.capacity) this.ring.push(snap);
    else this.ring[this.head] = snap;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /** Snapshots oldest to newest. */
  private ordered(): Snapshot[] {
    const out: Snapshot[] = [];
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) out.push(this.ring[(start + i) % this.capacity] as Snapshot);
    return out;
  }

  get newestTime(): number {
    const snaps = this.ordered();
    return snaps.length ? (snaps[snaps.length - 1] as Snapshot).time : 0;
  }

  /**
   * Living players' hitboxes at `time` (clamped to the stored window). `timeFor`
   * can shift the time per target (far targets are drawn later).
   */
  sample(time: number, timeFor?: (id: string, t: number) => number): HitTarget[] {
    const snaps = this.ordered();
    const out: HitTarget[] = [];
    if (snaps.length === 0) return out;
    const newest = snaps[snaps.length - 1] as Snapshot;
    for (let k = 0; k < newest.ids.length; k++) {
      const id = newest.ids[k] as string;
      const t = timeFor ? timeFor(id, time) : time;
      const p = this.at(snaps, id, t);
      if (p && p.alive) out.push({ id, x: p.x, y: p.y, z: p.z, crouch: p.crouch });
    }
    return out;
  }

  private read(s: Snapshot, id: string): HistoryEntry | null {
    const i = s.ids.indexOf(id);
    if (i < 0) return null;
    const d = s.data;
    const b = i * STRIDE;
    return { id, x: d[b] as number, y: d[b + 1] as number, z: d[b + 2] as number, crouch: d[b + 3] as number, alive: d[b + 4] as number };
  }

  private at(snaps: Snapshot[], id: string, time: number): HistoryEntry | null {
    const first = snaps[0] as Snapshot;
    const last = snaps[snaps.length - 1] as Snapshot;
    if (time >= last.time) return this.read(last, id);
    if (time <= first.time) return this.read(first, id) ?? this.read(last, id);
    for (let i = snaps.length - 1; i > 0; i--) {
      const a = snaps[i - 1] as Snapshot;
      const b = snaps[i] as Snapshot;
      if (time >= a.time && time <= b.time) {
        const pa = this.read(a, id);
        const pb = this.read(b, id);
        if (!pa || !pb) return pb ?? pa;
        const u = b.time > a.time ? (time - a.time) / (b.time - a.time) : 1;
        // A big jump between two snapshots is a respawn: do not interpolate across it.
        const jump = (pb.x - pa.x) ** 2 + (pb.z - pa.z) ** 2 > 25;
        if (jump) return u < 0.5 ? pa : pb;
        return {
          id,
          x: pa.x + (pb.x - pa.x) * u,
          y: pa.y + (pb.y - pa.y) * u,
          z: pa.z + (pb.z - pa.z) * u,
          crouch: u < 0.5 ? pa.crouch : pb.crouch,
          alive: u < 0.5 ? pa.alive : pb.alive,
        };
      }
    }
    return this.read(last, id);
  }
}
