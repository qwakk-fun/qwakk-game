/**
 * Lag compensation for shots at hunters: a short history of every hunter's
 * hitbox (position, facing, stance), so a duck's shot is judged against the
 * hunters as that duck saw them, exactly like shots at ducks (lagComp.ts,
 * the TPS hit rule). One snapshot per tick, linear between snapshots, the
 * same rewind cap. Hunters themselves never rewind: their shots use the
 * ducks' current positions, like bots.
 */
import { hunterShape, type HitTarget } from '@qwakk/shared';

interface Entry {
  x: number;
  y: number;
  z: number;
  yaw: number;
  kind: number;
  act: number;
}

interface Snapshot {
  time: number;
  hunters: Map<string, Entry>;
}

export interface HunterPose {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  kind: number;
  act: number;
  /** Only standing hunters can be hit (a defeated one is a poof). */
  alive: boolean;
}

const wrap = (a: number): number => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

export class HunterHistory {
  private readonly ring: Snapshot[] = [];
  private readonly capacity: number;

  constructor(capacity = 12) {
    this.capacity = capacity;
  }

  record(time: number, hunters: Iterable<HunterPose>): void {
    const map = new Map<string, Entry>();
    for (const h of hunters) if (h.alive) map.set(h.id, { x: h.x, y: h.y, z: h.z, yaw: h.yaw, kind: h.kind, act: h.act });
    const last = this.ring[this.ring.length - 1];
    if (last && last.time === time) {
      last.hunters = map;
      return;
    }
    this.ring.push({ time, hunters: map });
    if (this.ring.length > this.capacity) this.ring.shift();
  }

  clear(): void {
    this.ring.length = 0;
  }

  /** Hunter hitboxes at `time` (clamped to the window). Only hunters alive in the newest snapshot. */
  sample(time: number): HitTarget[] {
    const out: HitTarget[] = [];
    const snaps = this.ring;
    const newest = snaps[snaps.length - 1];
    if (!newest) return out;
    let a: Snapshot = newest;
    let b: Snapshot = newest;
    let u = 0;
    if (time < newest.time) {
      for (let i = snaps.length - 1; i > 0; i--) {
        const lo = snaps[i - 1] as Snapshot;
        const hi = snaps[i] as Snapshot;
        if (time >= lo.time) {
          a = lo;
          b = hi;
          u = hi.time > lo.time ? (time - lo.time) / (hi.time - lo.time) : 1;
          break;
        }
        a = lo;
        b = lo;
      }
    }
    for (const [id, nb] of newest.hunters) {
      const pa = a.hunters.get(id);
      const pb = b.hunters.get(id);
      const e = pa && pb ? null : (pb ?? pa ?? nb);
      if (e) {
        out.push({ id, x: e.x, y: e.y, z: e.z, crouch: 0, yaw: e.yaw, shape: hunterShape(e.kind, e.act) });
        continue;
      }
      const p = pa as Entry;
      const q = pb as Entry;
      out.push({
        id,
        x: p.x + (q.x - p.x) * u,
        y: p.y + (q.y - p.y) * u,
        z: p.z + (q.z - p.z) * u,
        crouch: 0,
        yaw: p.yaw + wrap(q.yaw - p.yaw) * u,
        shape: hunterShape(q.kind, u < 0.5 ? p.act : q.act),
      });
    }
    return out;
  }
}
