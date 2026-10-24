/**
 * Hunt Season progression rows (migration 007_progression.sql): a duck's Tüy
 * balance and ledger, owned and equipped gear, the skill tree and its
 * respecs. Every write runs in one transaction with the duck's rows locked,
 * so two requests of the same duck never both spend the same Tüy; the checks
 * (level, balance, ownership, the tree's rules) run inside those locks.
 *
 * Lock order (always the same, so a write never deadlocks with the run's
 * grant in meta/raid.ts): the duck's `players` row first (`for update`), then
 * its `duck_progress` row. The inserts into the duck's tables take a key
 * share on the `players` row through their foreign keys; holding the row
 * already makes that free. The rules themselves are the shared
 * ones (`@qwakk/shared/duck`). The service (service.ts) decides who may call
 * what; the game server alone grants Tüy (`grantRun`, from meta/raid.ts).
 */
import type { Sql, TransactionSql } from 'postgres';
import {
  canSpend,
  cleanTree,
  FEATHERS,
  gearById,
  kitFrom,
  respecCost,
  STARTER_KATANA,
  type DuckApiError,
  type DuckKit,
  type DuckProgressView,
  type TreeAlloc,
} from '@qwakk/shared/duck';

type Db = Sql | TransactionSql;

export type Result = { ok: true; view: DuckProgressView; replay?: boolean } | { ok: false; error: DuckApiError };

interface Duck {
  level: number;
  xp: number;
}

/** The duck's level and XP; null for a guest row or an unknown id (account ducks only). */
async function duckOf(db: Db, playerId: string): Promise<Duck | null> {
  const [r] = await db<{ level: number; xp: string | number }[]>`select level, xp from players where id = ${playerId} and account_id is not null`;
  return r ? { level: r.level, xp: Number(r.xp) } : null;
}

/** In a write: the duck's `players` row, locked first (the lock order above; the same as the run's grant). */
async function lockDuck(tx: TransactionSql, playerId: string): Promise<Duck | null> {
  const [r] = await tx<{ level: number; xp: string | number }[]>`select level, xp from players where id = ${playerId} and account_id is not null for update`;
  return r ? { level: r.level, xp: Number(r.xp) } : null;
}

/** First use: the progress row, the starter katana owned and worn. Idempotent. */
export async function ensureProgress(db: Db, playerId: string): Promise<void> {
  await db`insert into duck_progress (player_id) values (${playerId}) on conflict do nothing`;
  await db`insert into duck_items (player_id, item_id, source) values (${playerId}, ${STARTER_KATANA}, 'starter') on conflict do nothing`;
  await db`insert into duck_equipped (player_id, slot, item_id) values (${playerId}, 'katana', ${STARTER_KATANA}) on conflict do nothing`;
}

interface Locked {
  feathers: number;
  respecs: number;
  daily_bonus_on: string | null;
}

/** The progress row, locked for this transaction (made first if missing). */
async function lock(tx: TransactionSql, playerId: string): Promise<Locked> {
  await ensureProgress(tx, playerId);
  const [r] = await tx<Locked[]>`select feathers, respecs, to_char(daily_bonus_on, 'YYYY-MM-DD') as daily_bonus_on from duck_progress where player_id = ${playerId} for update`;
  return r!;
}

async function treeOf(db: Db, playerId: string): Promise<TreeAlloc> {
  const rows = await db<{ node_id: string; rank: number }[]>`select node_id, rank from duck_tree where player_id = ${playerId}`;
  const out: TreeAlloc = {};
  for (const r of rows) out[r.node_id] = r.rank;
  return out;
}

/** The duck's progression as the API shows it (rows made on first use). Null for a guest or an unknown id. */
export async function loadView(db: Db, playerId: string): Promise<DuckProgressView | null> {
  const duck = await duckOf(db, playerId);
  if (!duck) return null;
  await ensureProgress(db, playerId);
  const [p] = await db<{ feathers: number; respecs: number }[]>`select feathers, respecs from duck_progress where player_id = ${playerId}`;
  const owned = (await db<{ item_id: string }[]>`select item_id from duck_items where player_id = ${playerId} order by acquired_at, item_id`).map((r) => r.item_id);
  const eq = await db<{ slot: string; item_id: string }[]>`select slot, item_id from duck_equipped where player_id = ${playerId}`;
  const slot = (s: string): string | null => eq.find((r) => r.slot === s)?.item_id ?? null;
  return {
    level: duck.level,
    xp: duck.xp,
    feathers: p?.feathers ?? 0,
    owned,
    equipped: { katana: slot('katana') ?? STARTER_KATANA, armor: slot('armor') },
    tree: cleanTree(await treeOf(db, playerId), duck.level),
    respecs: p?.respecs ?? 0,
  };
}

/**
 * An idempotency key seen before: the same action on the same item is a
 * retry (`replay`: answer what is stored now); the key used for anything
 * else is a client bug or a forgery (`conflict`), never a silent success.
 */
async function seenKey(tx: TransactionSql, playerId: string, key: string | null, reason: 'buy' | 'respec', ref: string | null): Promise<'new' | 'replay' | 'conflict'> {
  if (!key) return 'new';
  const [r] = await tx<{ reason: string; ref: string | null }[]>`select reason, ref from feather_ledger where player_id = ${playerId} and idem_key = ${key}`;
  if (!r) return 'new';
  return r.reason === reason && (r.ref ?? null) === ref ? 'replay' : 'conflict';
}

type Reason = 'run' | 'daily' | 'buy' | 'respec' | 'admin';

async function ledger(tx: TransactionSql, playerId: string, delta: number, after: number, reason: Reason, ref: string | null, key: string | null = null): Promise<void> {
  await tx`insert into feather_ledger (player_id, delta, balance_after, reason, ref, idem_key) values (${playerId}, ${delta}, ${after}, ${reason}, ${ref}, ${key})`;
}

/** A grant's ledger row, never twice (`feather_ledger_run`): false when that run or day was granted already. */
async function ledgerOnce(tx: TransactionSql, playerId: string, delta: number, after: number, reason: 'run' | 'daily', ref: string): Promise<boolean> {
  const r = await tx`insert into feather_ledger (player_id, delta, balance_after, reason, ref) values (${playerId}, ${delta}, ${after}, ${reason}, ${ref})
    on conflict (player_id, ref) where reason in ('run', 'daily') do nothing returning id`;
  return r.length > 0;
}

/** Buy an item with Tüy: the level, the price and ownership checked under the lock; the new item is not equipped by itself. */
export async function buy(sql: Sql, playerId: string, itemId: string, key: string | null): Promise<Result> {
  const item = gearById(itemId);
  if (!item) return { ok: false, error: 'unknown_item' };
  if (item.cost <= 0) return { ok: false, error: 'not_for_sale' };
  const out = await sql.begin(async (tx): Promise<Result | { done: true; replay: boolean }> => {
    const duck = await lockDuck(tx, playerId);
    if (!duck) return { ok: false, error: 'needs_account' };
    const p = await lock(tx, playerId);
    const seen = await seenKey(tx, playerId, key, 'buy', item.id);
    if (seen === 'replay') return { done: true, replay: true };
    if (seen === 'conflict') return { ok: false, error: 'idem_conflict' };
    if (duck.level < item.level) return { ok: false, error: 'needs_level' };
    const owned = await tx`select 1 from duck_items where player_id = ${playerId} and item_id = ${item.id}`;
    if (owned.length > 0) return { ok: false, error: 'owned' };
    if (p.feathers < item.cost) return { ok: false, error: 'too_poor' };
    const after = p.feathers - item.cost;
    await tx`update duck_progress set feathers = ${after}, updated_at = now() where player_id = ${playerId}`;
    await tx`insert into duck_items (player_id, item_id, source) values (${playerId}, ${item.id}, 'shop')`;
    await ledger(tx, playerId, -item.cost, after, 'buy', item.id, key);
    return { done: true, replay: false };
  });
  if ('ok' in out) return out;
  const view = await loadView(sql, playerId);
  return view ? { ok: true, view, ...(out.replay ? { replay: true } : {}) } : { ok: false, error: 'needs_account' };
}

/** Wear an owned item in its slot. */
export async function equip(sql: Sql, playerId: string, itemId: string): Promise<Result> {
  const item = gearById(itemId);
  if (!item) return { ok: false, error: 'unknown_item' };
  const out = await sql.begin(async (tx): Promise<Result | null> => {
    if (!(await lockDuck(tx, playerId))) return { ok: false, error: 'needs_account' };
    await lock(tx, playerId);
    const owned = await tx`select 1 from duck_items where player_id = ${playerId} and item_id = ${item.id}`;
    if (owned.length === 0) return { ok: false, error: 'not_owned' };
    await tx`insert into duck_equipped (player_id, slot, item_id) values (${playerId}, ${item.slot}, ${item.id})
      on conflict (player_id, slot) do update set item_id = excluded.item_id`;
    return null;
  });
  if (out) return out;
  const view = await loadView(sql, playerId);
  return view ? { ok: true, view } : { ok: false, error: 'needs_account' };
}

/** One more rank in a tree node (the shared rules: points, level, prerequisites). */
export async function spend(sql: Sql, playerId: string, nodeId: string): Promise<Result> {
  const out = await sql.begin(async (tx): Promise<Result | null> => {
    const duck = await lockDuck(tx, playerId);
    if (!duck) return { ok: false, error: 'needs_account' };
    await lock(tx, playerId);
    const tree = cleanTree(await treeOf(tx, playerId), duck.level);
    const why = canSpend(tree, nodeId, duck.level);
    if (why) return { ok: false, error: why };
    await tx`insert into duck_tree (player_id, node_id, rank) values (${playerId}, ${nodeId}, 1)
      on conflict (player_id, node_id) do update set rank = duck_tree.rank + 1`;
    return null;
  });
  if (out) return out;
  const view = await loadView(sql, playerId);
  return view ? { ok: true, view } : { ok: false, error: 'needs_account' };
}

/** Reset the tree: the first time free, later `respecCost` Tüy. */
export async function respec(sql: Sql, playerId: string, key: string | null): Promise<Result> {
  const out = await sql.begin(async (tx): Promise<Result | { done: true; replay: boolean }> => {
    if (!(await lockDuck(tx, playerId))) return { ok: false, error: 'needs_account' };
    const p = await lock(tx, playerId);
    const seen = await seenKey(tx, playerId, key, 'respec', null);
    if (seen === 'replay') return { done: true, replay: true };
    if (seen === 'conflict') return { ok: false, error: 'idem_conflict' };
    const spent = await tx`select 1 from duck_tree where player_id = ${playerId} limit 1`;
    if (spent.length === 0) return { ok: false, error: 'nothing_to_reset' };
    const cost = respecCost(p.respecs);
    if (p.feathers < cost) return { ok: false, error: 'too_poor' };
    const after = p.feathers - cost;
    await tx`delete from duck_tree where player_id = ${playerId}`;
    await tx`update duck_progress set feathers = ${after}, respecs = respecs + 1, updated_at = now() where player_id = ${playerId}`;
    // Free ones are logged too (no balance change), so support sees every reset.
    await ledger(tx, playerId, -cost, after, 'respec', null, key);
    return { done: true, replay: false };
  });
  if ('ok' in out) return out;
  const view = await loadView(sql, playerId);
  return view ? { ok: true, view, ...(out.replay ? { replay: true } : {}) } : { ok: false, error: 'needs_account' };
}

/** A duck's kit for a Hunt Season run (level, gear, tree). Null for a guest or an unknown id. */
export async function loadKit(db: Db, playerId: string): Promise<DuckKit | null> {
  const duck = await duckOf(db, playerId);
  if (!duck) return null;
  const eq = await db<{ slot: string; item_id: string }[]>`select slot, item_id from duck_equipped where player_id = ${playerId}`;
  const slot = (s: string): string | null => eq.find((r) => r.slot === s)?.item_id ?? null;
  return kitFrom(duck.level, slot('katana'), slot('armor'), await treeOf(db, playerId));
}

export interface FeatherGrant {
  before: number;
  after: number;
  /** The run's Tüy plus the daily bonus. */
  gained: number;
  daily: number;
}

/**
 * The game server's grant at a run's end (inside recordRaid's transaction,
 * after the run row and the duck's `players` row lock: once per run id): the
 * run's Tüy, plus the daily bonus for the first run of a UTC day that took an
 * objective. The bonus day only moves forward (a run that ended before the
 * last bonus day, in another room across midnight, gets none and never moves
 * it back), and a grant whose ledger row exists already adds nothing instead
 * of failing: nothing here can abort the run's transaction.
 */
export async function grantRun(tx: TransactionSql, playerId: string, runKey: string, feathers: number, cleared: number, today: string): Promise<FeatherGrant> {
  const p = await lock(tx, playerId);
  const runWant = Math.max(0, Math.min(FEATHERS.maxPerRun, Math.floor(feathers)));
  // 'YYYY-MM-DD' strings compare in date order.
  const dailyWant = cleared > 0 && (p.daily_bonus_on === null || today > p.daily_bonus_on) ? FEATHERS.daily : 0;
  let bal = p.feathers;
  let run = 0;
  let daily = 0;
  if (runWant > 0 && (await ledgerOnce(tx, playerId, runWant, bal + runWant, 'run', runKey))) {
    run = runWant;
    bal += run;
  }
  if (dailyWant > 0 && (await ledgerOnce(tx, playerId, dailyWant, bal + dailyWant, 'daily', `day:${today}`))) {
    daily = dailyWant;
    bal += daily;
  }
  if (run + daily > 0) {
    await tx`update duck_progress set feathers = ${bal}, feathers_earned = feathers_earned + ${run + daily},
      daily_bonus_on = case when ${daily > 0} then greatest(coalesce(daily_bonus_on, ${today}::date), ${today}::date) else daily_bonus_on end, updated_at = now()
      where player_id = ${playerId}`;
  }
  return { before: p.feathers, after: bal, gained: run + daily, daily };
}

/** Support: a duck's balance and its latest ledger rows (admin panel, read only). */
export async function ledgerOf(db: Db, playerId: string, limit = 20): Promise<{ feathers: number; earned: number; respecs: number; rows: { delta: number; balanceAfter: number; reason: string; ref: string | null; at: string }[] } | null> {
  const [p] = await db<{ feathers: number; feathers_earned: string; respecs: number }[]>`select feathers, feathers_earned, respecs from duck_progress where player_id = ${playerId}`;
  if (!p) return null;
  const rows = await db<{ delta: number; balance_after: number; reason: string; ref: string | null; at: Date }[]>`
    select delta, balance_after, reason, ref, at from feather_ledger where player_id = ${playerId} order by id desc limit ${Math.max(1, Math.min(100, limit))}`;
  return { feathers: p.feathers, earned: Number(p.feathers_earned), respecs: p.respecs, rows: rows.map((r) => ({ delta: r.delta, balanceAfter: r.balance_after, reason: r.reason, ref: r.ref, at: r.at.toISOString() })) };
}
