/**
 * What a battle royale bot may read about the match besides its own sim
 * state: public match facts (plane route and time, the announced zone) and
 * the loot near it (it still checks line of sight before going for an item,
 * like a player who sees it). Never other players' positions: those come
 * through the shared bot view and the line-of-sight rule.
 */
import type { Armor, Circle, MapDef, PlaneRoute, SimWorld } from '@qwakk/shared';
import type { LootEntity } from './loot.ts';

export interface BrBotContext {
  sim: SimWorld;
  map: MapDef;
  /** The plane's route, and seconds since it started (negative before take-off). */
  route(): PlaneRoute | null;
  planeTime(): number;
  /** The zone right now, and the announced next circle (null before it is shown). */
  zone(): { now: Circle; next: Circle | null; dps: number };
  /** Items within r meters of (x, z). */
  itemsNear(x: number, z: number, r: number): LootEntity[];
  /** Is this item in line of sight and reach from the duck (the server's pickup rule)? */
  canReach(self: import('@qwakk/shared').PlayerSim, item: LootEntity): boolean;
  armorOf(seatId: string): Armor;
}
