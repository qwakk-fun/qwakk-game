/**
 * Interest management for the hub: bandwidth only. There is no combat in the
 * hub, so no line-of-sight culling: a viewer gets the near pose of ducks
 * within HUB.near meters (sent every tick), the far pose within HUB.far
 * (every HUB.farEveryTicks ticks) and nothing beyond, with hysteresis
 * (HUB.nearOut, HUB.farOut). Never its own duck (it has its exact state).
 * Removing an entry from a StateView deletes it on that client.
 */
import type { StateView } from '@colyseus/schema';
import { HUB } from '@qwakk/shared/hub';

type Ref = Parameters<StateView['add']>[0];

export interface HubInterestDuck {
  id: string;
  x: number;
  z: number;
  pose: Ref;
  farPose: Ref;
}

/** 0: not sent, 1: far, 2: near. */
export type HubClass = 0 | 1 | 2;

/** The class a pair moves to from `prev` at distance `d` (m). */
export function hubClass(prev: HubClass, d: number): HubClass {
  if (d <= HUB.near || (prev === 2 && d <= HUB.nearOut)) return 2;
  if (d <= HUB.far || (prev >= 1 && d <= HUB.farOut)) return 1;
  return 0;
}

interface Viewer {
  view: StateView;
  classes: Map<string, HubClass>;
}

export class HubInterest {
  private readonly viewers = new Map<string, Viewer>();
  /** Pairs re-classified (stats). */
  pairs = 0;

  addViewer(id: string, view: StateView): void {
    this.viewers.set(id, { view, classes: new Map() });
  }

  removeViewer(id: string): void {
    this.viewers.delete(id);
  }

  /** A duck left: forget it everywhere (its map entries are deleted for every client anyway). */
  forget(id: string): void {
    for (const v of this.viewers.values()) v.classes.delete(id);
  }

  /** The class `viewerId` gets `targetId` in now. */
  classOf(viewerId: string, targetId: string): HubClass {
    return this.viewers.get(viewerId)?.classes.get(targetId) ?? 0;
  }

  /** Does this viewer receive that duck's pose (near or far)? */
  sees(viewerId: string, targetId: string): boolean {
    return this.classOf(viewerId, targetId) > 0;
  }

  /** Re-classify every pair from the ducks' positions. */
  update(ducks: readonly HubInterestDuck[]): void {
    for (const [vid, v] of this.viewers) {
      const me = ducks.find((d) => d.id === vid);
      if (!me) continue;
      for (const d of ducks) {
        if (d.id === vid) continue;
        this.pairs++;
        const prev = v.classes.get(d.id) ?? 0;
        const next = hubClass(prev, Math.hypot(d.x - me.x, d.z - me.z));
        if (next === prev) continue;
        if (prev === 2) v.view.remove(d.pose);
        else if (prev === 1) v.view.remove(d.farPose);
        if (next === 2) v.view.add(d.pose);
        else if (next === 1) v.view.add(d.farPose);
        if (next === 0) v.classes.delete(d.id);
        else v.classes.set(d.id, next);
      }
    }
  }
}
