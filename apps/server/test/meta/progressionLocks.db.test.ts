/**
 * Hunt Season progression under contention, on a real PostgreSQL (skipped
 * without the local test database): a run's grant and a duck's `/api/duck`
 * writes take their locks in the same order (the `players` row, then
 * `duck_progress`), so a purchase from a second tab as the run ends waits
 * instead of deadlocking; `recordRaid` retries a run after a deadlock or a
 * serialization failure; the daily bonus day never moves back across UTC
 * midnight (one duck in two rooms) and a duplicate ledger row never aborts a
 * grant; an idempotency key is bound to its action and item.
 */
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FEATHERS, raidFeathers } from '@qwakk/shared';
import { MetaService } from '../../src/meta/service.ts';
import { isRetryable, withRetry, type RaidRunResult } from '../../src/meta/raid.ts';
import { RateLimiter } from '../../src/meta/rateLimit.ts';
import { signSession } from '../../src/meta/token.ts';
import { dbReachable, freshDatabase } from './testDb.ts';

const reachable = await dbReachable();
const SECRET = 'progression-lock-secret-progression-lock-1';
const DAY = 86_400_000;

describe('recordRaid retries', () => {
  it('runs a transaction again after a deadlock or a serialization failure, and only then', async () => {
    let n = 0;
    expect(await withRetry(async () => (++n < 3 ? Promise.reject(Object.assign(new Error('deadlock'), { code: '40P01' })) : 'ok'), 4, 1)).toBe('ok');
    expect(n).toBe(3);
    n = 0;
    await expect(withRetry(async () => (++n, Promise.reject(Object.assign(new Error('x'), { code: '23505' }))), 4, 1)).rejects.toThrow('x');
    expect(n).toBe(1);
    n = 0;
    await expect(withRetry(async () => (++n, Promise.reject(Object.assign(new Error('again'), { code: '40001' }))), 3, 1)).rejects.toThrow('again');
    expect(n).toBe(3);
    expect(isRetryable({ code: '40P01' }) && isRetryable({ code: '40001' }) && !isRetryable(new Error('no'))).toBe(true);
  });
});

describe.skipIf(!reachable)('progression under contention (PostgreSQL)', () => {
  let db: { url: string; drop: () => Promise<void> };
  let meta: MetaService;
  let sql: Sql;
  const account = randomUUID();
  const duck = randomUUID();
  let token = '';
  const ip = '127.0.0.1';
  let runs = 0;
  const auth = (): string => `Bearer ${token}`;
  const body = (r: { body: unknown }): { duck?: { feathers: number; owned: string[] }; error?: string; replay?: boolean } => r.body as never;
  const run = (endedAt: number, wavesCleared = 1, won = false): RaidRunResult => ({
    runId: `lock-run-${++runs}`, mapId: 'pond-keep', startedAt: endedAt - 600_000, endedAt, wavesCleared, won, bestMs: 600_000,
    players: [{ playerId: duck, name: 'Lock_Duck', wavesCleared, kills: 2, minionKills: 10, comboXp: 0, bossKills: 0, revives: 0, xp: 0, won }],
  });

  beforeAll(async () => {
    db = await freshDatabase('proglocks');
    meta = new MetaService({ env: { DATABASE_URL: db.url, SESSION_SECRET: SECRET }, mailer: null });
    await meta.start();
    sql = meta.sql!;
    await sql`insert into accounts (id, legal_version, legal_accepted_at, age_confirmed_at) values (${account}, 'x', now(), now())`;
    await sql`insert into players (id, name, tag, account_id, slot, look, xp, level) values (${duck}, 'Lock_Duck', 4321, ${account}, 0, 0, 20000, 12)`;
    token = signSession(SECRET, { playerId: duck, name: 'Lock_Duck', tag: '4321', account: true, look: 0 }).token;
  });
  afterAll(async () => {
    await meta?.stop();
    await db?.drop();
  });
  beforeEach(() => {
    meta.progression.limits.duck = new RateLimiter({ capacity: 1000, refillPerSec: 1000 });
  });

  it("a purchase while a run's grant holds the duck waits for it, never deadlocks (the run's lock order)", async () => {
    await meta.progression.view(auth(), ip);
    await sql`update duck_progress set feathers = 5000 where player_id = ${duck}`;
    let held!: () => void;
    const holding = new Promise<void>((r) => (held = r));
    // The run's transaction as insertRaid takes its locks: the players row, a pause, then duck_progress.
    const grant = sql.begin(async (tx) => {
      await tx`select id from players where id = ${duck} for update`;
      await tx`update players set last_seen = now() where id = ${duck}`;
      held();
      await new Promise((r) => setTimeout(r, 400));
      await tx`select feathers from duck_progress where player_id = ${duck} for update`;
      return 'granted';
    });
    await holding;
    const bought = meta.progression.buy(auth(), { item: 'katana_bamboo' }, ip);
    const [g, b] = await Promise.all([grant, bought]);
    expect(g).toBe('granted');
    expect(b.status).toBe(200);
    expect(body(b).duck!.owned).toContain('katana_bamboo');
  });

  it('runs ending while the duck buys, equips, spends and resets in another tab: every run is stored, every write answers', async () => {
    await sql`update duck_progress set feathers = 20000 where player_id = ${duck}`;
    const base = Date.now() - 2 * DAY;
    const items = ['katana_steel', 'armor_padded', 'armor_leather', 'armor_chain', 'katana_moon'];
    for (let round = 0; round < 5; round++) {
      const writes = [
        meta.progression.buy(auth(), { item: items[round]! }, ip),
        meta.progression.equip(auth(), { item: 'katana_bamboo' }, ip),
        meta.progression.spend(auth(), { node: 'feathers' }, ip),
        meta.progression.respec(auth(), {}, ip),
        meta.progression.spend(auth(), { node: 'edge' }, ip),
      ];
      const [grant, ...answers] = await Promise.all([meta.recordRaid(run(base + round * 1000)), ...writes]);
      expect(grant?.get(duck), `round ${round}: the run was lost`).toBeTruthy();
      for (const a of answers) expect(a.status, JSON.stringify(a.body)).not.toBe(503);
    }
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from feather_ledger where player_id = ${duck} and reason = 'run'`;
    expect(n!.n).toBe(5);
  });

  it('the daily bonus day never moves back across midnight, and a duplicate ledger row never aborts a grant', async () => {
    const day0 = Math.floor(Date.now() / DAY) * DAY - 5 * DAY + 12 * 3600_000;
    const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
    await sql`update duck_progress set daily_bonus_on = null where player_id = ${duck}`;
    // A run ending on day +1 (one room) gets the bonus...
    const g1 = await meta.recordRaid(run(day0 + DAY));
    expect(g1?.get(duck)?.daily).toBe(FEATHERS.daily);
    // ...a run of the same duck ending a little earlier, on day 0, in another room: no bonus, and the day stays.
    const g0 = await meta.recordRaid(run(day0));
    expect(g0?.get(duck)?.daily).toBe(0);
    const [p] = await sql<{ d: string }[]>`select to_char(daily_bonus_on, 'YYYY-MM-DD') as d from duck_progress where player_id = ${duck}`;
    expect(p!.d).toBe(dayOf(day0 + DAY));
    // Another run on day +1: no second bonus, and the run is stored.
    const g2 = await meta.recordRaid(run(day0 + DAY + 60_000));
    expect(g2?.get(duck)?.daily).toBe(0);
    // A ledger row for day +2 already there (whatever wrote it): the run of day +2 is stored, with no second bonus.
    await sql`insert into feather_ledger (player_id, delta, balance_after, reason, ref) values (${duck}, 0, 0, 'daily', ${`day:${dayOf(day0 + 2 * DAY)}`})`;
    const before = (await sql<{ feathers: number }[]>`select feathers from duck_progress where player_id = ${duck}`)[0]!.feathers;
    const g3 = await meta.recordRaid(run(day0 + 2 * DAY));
    const want = raidFeathers({ wavesCleared: 1, kills: 2, minionKills: 10, bossKills: 0, won: false });
    expect(g3?.get(duck)).toMatchObject({ daily: 0, feathersBefore: before, feathersAfter: before + want });
  });

  it('an idempotency key is bound to its action and item: a reuse for anything else is refused, a retry replays', async () => {
    await sql`update duck_progress set feathers = 9000 where player_id = ${duck}`;
    await sql`update players set level = 20 where id = ${duck}`;
    const key = 'one-click-key-01';
    const first = await meta.progression.buy(auth(), { item: 'armor_plate', key }, ip);
    expect(first.status).toBe(200);
    const retry = await meta.progression.buy(auth(), { item: 'armor_plate', key }, ip);
    expect(body(retry).replay).toBe(true);
    const other = await meta.progression.buy(auth(), { item: 'katana_dragon', key }, ip);
    expect(other.status).toBe(409);
    expect(body(other).error).toBe('idem_conflict');
    expect(body(await meta.progression.respec(auth(), { key }, ip)).error).toBe('idem_conflict');
    expect(await sql`select 1 from duck_items where player_id = ${duck} and item_id = 'katana_dragon'`).toHaveLength(0);
    const [p] = await sql<{ feathers: number }[]>`select feathers from duck_progress where player_id = ${duck}`;
    expect(p!.feathers).toBe(9000 - 3500);
  });
});
