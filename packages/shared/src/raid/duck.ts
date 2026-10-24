/**
 * Hunt Season progression for the menu, the plaza and the HUD
 * (`@qwakk/shared/duck`): unlocks by level, the gear catalog, the skill tree,
 * the kit's numbers, Tüy, and the API shapes of `/api/duck`. Pure data and
 * math; no Rapier, no network. The server rules live in
 * `apps/server/src/meta/progression/` and `apps/server/src/raid/`.
 */
export * from './unlocks.ts';
export * from './gear.ts';
export * from './tree.ts';
export * from './kit.ts';
export * from './progress.ts';

/** `GET /api/duck` and every successful write: a duck's progression as the server stores it. */
export interface DuckProgressView {
  level: number;
  xp: number;
  /** Tüy balance. */
  feathers: number;
  /** Owned item ids (the starter katana included). */
  owned: string[];
  /** Equipped item per slot (null: none). */
  equipped: { katana: string; armor: string | null };
  tree: Record<string, number>;
  /** Respecs done so far (the next costs `respecCost(respecs)`). */
  respecs: number;
}

/** Error codes of the `/api/duck` writes (the menu explains them). */
export type DuckApiError =
  | 'needs_account'
  | 'unauthorized'
  | 'rate_limited'
  | 'unavailable'
  | 'bad_request'
  | 'unknown_item'
  | 'not_for_sale'
  | 'needs_level'
  | 'owned'
  | 'not_owned'
  | 'too_poor'
  | 'unknown'
  | 'maxed'
  | 'no_points'
  | 'needs_node'
  | 'needs_branch'
  | 'nothing_to_reset'
  /** An idempotency key already used for another action or item. */
  | 'idem_conflict';
