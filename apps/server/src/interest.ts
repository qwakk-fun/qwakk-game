/**
 * Interest management: decides, per viewer, how each other player is sent.
 *
 * Every player has two quantized pose entries: `poses` (written every tick)
 * and `farPoses` (written every third tick). Both state maps are `.view()`,
 * so a client only receives the entries in its own StateView. A viewer gets
 * the near entry for players within INTEREST.nearRadius and the far entry for
 * the rest (with hysteresis), and never its own (it has its exact state).
 */
import type { StateView } from '@colyseus/schema';

type Ref = Parameters<StateView['add']>[0];
import { INTEREST } from '@qwakk/shared';

export interface InterestSeat {
  id: string;
  x: number;
  z: number;
  /** Near and far pose instances (schema refs living in the state maps). */
  pose: Ref;
  farPose: Ref;
}

export interface Viewer {
  id: string;
  view: StateView;
  /** Ids this viewer currently gets through the far entry. */
  far: Set<string>;
  /** Ids this viewer currently has any entry for. */
  seen: Set<string>;
}

export class Interest {
  readonly viewers = new Map<string, Viewer>();
  /** Off: everyone near (benchmark baseline). */
  private readonly enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  addViewer(id: string, view: StateView): Viewer {
    const v: Viewer = { id, view, far: new Set(), seen: new Set() };
    this.viewers.set(id, v);
    return v;
  }

  removeViewer(id: string): void {
    this.viewers.delete(id);
  }

  /** A seat left: forget it in every view (the map deletes reach clients by themselves). */
  forget(id: string): void {
    for (const v of this.viewers.values()) {
      v.far.delete(id);
      v.seen.delete(id);
    }
    for (const key of [...this.switches.keys()]) if (key.startsWith(`${id}|`) || key.endsWith(`|${id}`)) this.switches.delete(key);
  }

  /** Pairs that changed class recently: when, and what they were before. */
  private readonly switches = new Map<string, { since: number; prevFar: boolean }>();

  isFar(viewerId: string, targetId: string): boolean {
    return this.viewers.get(viewerId)?.far.has(targetId) ?? false;
  }

  /**
   * The class the VIEWER was drawing `targetId` with when it fired. A switch
   * reaches the client half a round trip after the server makes it, and the
   * client eases it in over about 150 ms; until roughly the middle of that the
   * client still draws the old timeline, so lag compensation uses the old class.
   */
  isFarAt(viewerId: string, targetId: string, nowMs: number, rttMs: number): boolean {
    const cur = this.isFar(viewerId, targetId);
    const sw = this.switches.get(`${viewerId}|${targetId}`);
    if (sw && nowMs - sw.since < rttMs / 2 + 75) return sw.prevFar;
    return cur;
  }

  /** Re-classify every pair. `self` gives the viewer's own position (spectators have none). */
  update(seats: Iterable<InterestSeat>, nowMs: number, self: (viewerId: string) => { x: number; z: number } | null): void {
    const list = [...seats];
    for (const v of this.viewers.values()) {
      const me = self(v.id);
      for (const s of list) {
        if (s.id === v.id) continue;
        let far = false;
        if (this.enabled && me) {
          const d = Math.hypot(s.x - me.x, s.z - me.z);
          const wasFar = v.far.has(s.id);
          far = wasFar ? d > INTEREST.nearRadius : d > INTEREST.farRadius;
        }
        const had = v.seen.has(s.id);
        if (had && far === v.far.has(s.id)) continue;
        if (had) {
          v.view.remove(v.far.has(s.id) ? s.farPose : s.pose);
          this.switches.set(`${v.id}|${s.id}`, { since: nowMs, prevFar: v.far.has(s.id) });
        }
        v.view.add(far ? s.farPose : s.pose);
        v.seen.add(s.id);
        if (far) v.far.add(s.id);
        else v.far.delete(s.id);
      }
    }
  }
}
