/**
 * Hunt Season upgrades: between waves each living duck picks one of three
 * cards (a timer picks at random). The ids and the card order are shared;
 * every number behind them is server only (apps/server/src/raid/upgrades.ts,
 * admin settings), and none touches the client sim: damage, armor, health,
 * regen, lifesteal and revive speed are applied by the server, an extra
 * grenade is a count the server sets.
 */
export const Upgrade = {
  Damage: 1,
  MaxHealth: 2,
  Armor: 3,
  Regen: 4,
  Grenade: 5,
  Revive: 6,
  Headshot: 7,
  Lifesteal: 8,
  Repair: 9,
} as const;
export type UpgradeId = (typeof Upgrade)[keyof typeof Upgrade];

export const UPGRADE_IDS: readonly UpgradeId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function isUpgradeId(v: unknown): v is UpgradeId {
  return typeof v === 'number' && (UPGRADE_IDS as readonly number[]).includes(v);
}

/** Cards per offer. */
export const OFFER_SIZE = 3;

/**
 * Three different cards from `ids`, using `rand` (server: Math.random). Cards
 * at their stack limit (`maxed`) are left out; the core repair kit only when
 * the core is hurt.
 */
export function rollOffer(rand: () => number, opts: { maxed?: ReadonlySet<number>; coreHurt: boolean }): UpgradeId[] {
  const pool = UPGRADE_IDS.filter((id) => !opts.maxed?.has(id) && (id !== Upgrade.Repair || opts.coreHurt));
  const out: UpgradeId[] = [];
  while (out.length < OFFER_SIZE && pool.length > 0) {
    const i = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
    out.push(pool.splice(i, 1)[0]!);
  }
  return out;
}
