/**
 * Hunt Season upgrades (v3, melee builds): between objectives each duck picks
 * one of three cards (a timer picks at random). The ids and the card order
 * are shared; every number behind them is server only (apps/server/src/raid/
 * upgrades.ts, admin settings `raid.upgrade.*`), and none touches the client
 * sim: damage, reach, crits, armor, health, regen, lifesteal, bleed, chain
 * lightning, the storm meter and revive speed are all applied by the server.
 * The sim's timings (swings, the dash, the quack, the storm) never change.
 */
export const Upgrade = {
  /** More damage with the katana and the pistol. */
  Damage: 1,
  MaxHealth: 2,
  Armor: 3,
  Regen: 4,
  /** Wider arcs: every swing reaches further (server's sweep). */
  Reach: 5,
  Revive: 6,
  /** Harder crits (heavy spins and back-stabs). */
  Crit: 7,
  /** Health back for every cut that lands. */
  Lifesteal: 8,
  /** The Blade Storm meter fills faster. */
  Storm: 9,
  /** Cuts make hunters bleed for a while. */
  Bleed: 10,
  /** The heavy spin's hits arc on to more hunters nearby. */
  Chain: 11,
  /** The combo's third cut hits much harder. */
  Finisher: 12,
} as const;
export type UpgradeId = (typeof Upgrade)[keyof typeof Upgrade];

export const UPGRADE_IDS: readonly UpgradeId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function isUpgradeId(v: unknown): v is UpgradeId {
  return typeof v === 'number' && (UPGRADE_IDS as readonly number[]).includes(v);
}

/** Cards per offer. */
export const OFFER_SIZE = 3;

/**
 * Three different cards from the pool, using `rand` (server: Math.random).
 * Cards at their stack limit (`maxed`) are left out; the revive card only
 * when the duck has friends (`team`).
 */
export function rollOffer(rand: () => number, opts: { maxed?: ReadonlySet<number>; team?: boolean }): UpgradeId[] {
  const pool = UPGRADE_IDS.filter((id) => !opts.maxed?.has(id) && (id !== Upgrade.Revive || opts.team !== false));
  const out: UpgradeId[] = [];
  while (out.length < OFFER_SIZE && pool.length > 0) {
    const i = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
    out.push(pool.splice(i, 1)[0]!);
  }
  return out;
}
