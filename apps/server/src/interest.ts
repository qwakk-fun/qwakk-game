/**
 * Interest management: decides, per viewer, how each other player is sent.
 *
 * Every player has two quantized pose entries: `poses` (written every tick)
 * and `farPoses` (written every third tick). Both state maps are `.view()`,
 * so a client only receives the entries in its own StateView. A viewer gets
 * the near entry for players within INTEREST.nearRadius and the far entry for
 * the rest (with hysteresis), and never its own (it has its exact state).
 *
 * Anti-wallhack (battle royale): with culling on, a viewer gets no entry at
 * all for an enemy it cannot plausibly see. Visible means: within
 * VIS.alwaysRadius, or within VIS.maxRange with a clear line of sight now or
 * at the positions both will have a moment from now (predictive, so a duck
 * coming round a corner is already there when it shows), then kept for
 * VIS.graceMs after it was last visible. Removing an entry deletes it on the
 * client, so a hidden enemy is simply not in the client's memory.
 */
import type { StateView } from '@colyseus/schema';
import { INTEREST, VIS } from '@qwakk/shared';
import type { Visibility } from './visibility.ts';

type Ref = Parameters<StateView['add']>[0];

export interface InterestSeat {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  crouch: number;
  /** False while in the plane (not in the world: never sent as a pose). */
  inWorld: boolean;
  /** Near and far pose instances (schema refs living in the state maps). */
  pose: Ref;
  farPose: Ref;
}

/** Where a viewer looks from: its own duck, or the duck it spectates. */
export interface ViewerPoint {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  crouch: number;
  /** Always send this seat (the one being spectated, or the viewer's own body). */
  watchId: string | null;
  /** Half the measured round trip (ms), for the lookahead. */
  halfRttMs: number;
}

export interface Viewer {
  id: string;
  view: StateView;
  /** Ids this viewer currently gets through the far entry. */
  far: Set<string>;
  /** Ids this viewer currently has any entry for. */
  seen: Set<string>;
  /** Last time each target was visible (culling). */
  lastVisible: Map<string, number>;
}

export interface InterestOptions {
  /** Distance classes on (off: everyone near, the benchmark baseline). */
  enabled: boolean;
  /** Anti-wallhack line-of-sight culling (battle royale). */
  cull: boolean;
}

export class Interest {
  readonly viewers = new Map<string, Viewer>();
  private readonly o: InterestOptions;
  private readonly vis: Visibility | null;
  /** Pairs tested and pairs found visible since the last reset (stats). */
  readonly counts = { pairs: 0, visible: 0, predicted: 0 };

  constructor(options: InterestOptions | boolean = true, vis: Visibility | null = null) {
    this.o = typeof options === 'boolean' ? { enabled: options, cull: false } : options;
    this.vis = vis;
  }

  addViewer(id: string, view: StateView): Viewer {
    const v: Viewer = { id, view, far: new Set(), seen: new Set(), lastVisible: new Map() };
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
      v.lastVisible.delete(id);
    }
    for (const key of [...this.switches.keys()]) if (key.startsWith(`${id}|`) || key.endsWith(`|${id}`)) this.switches.delete(key);
  }

  /** Pairs that changed class recently: when, and what they were before. */
  private readonly switches = new Map<string, { since: number; prevFar: boolean }>();

  isFar(viewerId: string, targetId: string): boolean {
    return this.viewers.get(viewerId)?.far.has(targetId) ?? false;
  }

  /** Does this viewer currently receive this target's pose (it may draw it)? */
  sees(viewerId: string, targetId: string): boolean {
    return this.viewers.get(viewerId)?.seen.has(targetId) ?? false;
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

  /**
   * Re-classify every pair. `self` gives the viewer's viewpoint (null: a free
   * spectator, sees all). With `part`, only the viewers whose join order
   * modulo `of` is `index` (the room staggers the culling over ticks).
   */
  update(seats: Iterable<InterestSeat>, nowMs: number, self: (viewerId: string) => ViewerPoint | null, part?: { index: number; of: number }): void {
    const list = [...seats];
    let i = -1;
    for (const v of this.viewers.values()) {
      i++;
      if (part && i % part.of !== part.index) continue;
      const me = self(v.id);
      for (const s of list) {
        if (s.id === v.id) continue;
        const visible = this.visible(v, me, s, nowMs);
        let far = false;
        if (visible && this.o.enabled && me) {
          const d = Math.hypot(s.x - me.x, s.z - me.z);
          const wasFar = v.far.has(s.id);
          far = wasFar ? d > INTEREST.nearRadius : d > INTEREST.farRadius;
        }
        const had = v.seen.has(s.id);
        if (!visible) {
          if (had) {
            v.view.remove(v.far.has(s.id) ? s.farPose : s.pose);
            v.seen.delete(s.id);
            v.far.delete(s.id);
            this.switches.delete(`${v.id}|${s.id}`);
          }
          continue;
        }
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

  private visible(v: Viewer, me: ViewerPoint | null, s: InterestSeat, nowMs: number): boolean {
    if (!s.inWorld) return false;
    if (!this.o.cull || !this.vis || !me) return true;
    if (me.watchId === s.id) return true;
    this.counts.pairs++;
    const dx = s.x - me.x;
    const dz = s.z - me.z;
    const d = Math.hypot(dx, dz);
    let now = false;
    if (d <= VIS.alwaysRadius) now = true;
    else if (d <= VIS.maxRange) {
      now = this.vis.canSee(me, s);
      if (!now && d < 150) {
        // Predictive: where both will be a moment from now (round trip plus the interpolation buffer).
        const la = (VIS.lookaheadMs + me.halfRttMs) / 1000;
        now = this.vis.quick({ x: me.x + me.vx * la, y: me.y, z: me.z + me.vz * la, yaw: me.yaw, crouch: me.crouch }, { x: s.x + s.vx * la, y: s.y, z: s.z + s.vz * la, crouch: s.crouch });
        if (now) this.counts.predicted++;
      }
    }
    if (now) {
      v.lastVisible.set(s.id, nowMs);
      this.counts.visible++;
      return true;
    }
    const last = v.lastVisible.get(s.id);
    return last !== undefined && nowMs - last < VIS.graceMs;
  }
}
