/**
 * Hunt Season progression on a real PostgreSQL (skipped without the local
 * test database): migration 007 on a database that already holds ducks and
 * runs; Tüy granted by the game server only, once per run id, with the daily
 * bonus once a day; the /api/duck routes (identity from the game session
 * token only, guests refused): purchases checked for level, balance and
 * ownership, safe under concurrent requests (no double spend), idempotent
 * with a key; equips only owned items; tree spends follow the rules; the
 * first respec is free; the kit a run reads; deleting a duck or an account
 * deletes all of it.
 */
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FEATHERS, raidFeathers, RESPEC_COST } from '@qwakk/shared';
import { MetaService } from '../../src/meta/service.ts';
import { PROGRESSION_LIMITS } from '../../src/meta/progression/service.ts';
import { RateLimiter } from '../../src/meta/rateLimit.ts';
import { migrate, readMigrations } from '../../src/meta/migrate.ts';
import { deleteAccount, deleteCharacter } from '../../src/meta/accounts/store.ts';
import type { RaidRunResult } from '../../src/meta/raid.ts';
import { signSession } from '../../src/meta/token.ts';
import { dbReachable, freshDatabase } from './testDb.ts';

const reachable = await dbReachable();
const SECRET = 'progression-test-secret-progression-1234';

describe.skipIf(!reachable)('hunt season progression (PostgreSQL)', () => {
  let db: { url: string; drop: () => Promise<void> };
  let meta: MetaService;
  let sql: Sql;
  const account = randomUUID();
  const duck = randomUUID();
  const other = randomUUID();
  const guest = randomUUID();
  let token = '';
  let otherToken = '';
  let guestToken = '';
  const ip = '127.0.0.1';
  let runs = 0;

  beforeAll(async () => {
    db = await freshDatabase('progression');
    // Migration safety: the database as it was before 007, with ducks and a run in it.
    const pre = postgres(db.url, { max: 1, onnotice: () => {} });
    const files = await readMigrations();
    await migrate(pre, files.filter((f) => f.name < '007'));
    await pre`insert into accounts (id, legal_version, legal_accepted_at, age_confirmed_at) values (${account}, 'x', now(), now())`;
    await pre`insert into players (id, name, tag, account_id, slot, look, xp, level) values (${duck}, 'Gear_Duck', 1111, ${account}, 0, 0, 1000, 4)`;
    await pre`insert into players (id, name, tag, account_id, slot, look) values (${other}, 'Other_Duck', 2222, ${account}, 1, 0)`;
    await pre`insert into players (id, name, tag) values (${guest}, 'Guesty', 3333)`;
    await pre`insert into raid_runs (run_key, map_id, started_at, ended_at, waves_cleared, won, duck_count) values ('old-run', 'pond-keep', now(), now(), 2, false, 1)`;
    await pre.end();
    meta = new MetaService({ env: { DATABASE_URL: db.url, SESSION_SECRET: SECRET }, mailer: null });
    await meta.start();
    sql = meta.sql!;
    token = signSession(SECRET, { playerId: duck, name: 'Gear_Duck', tag: '1111', account: true, look: 0 }).token;
    otherToken = signSession(SECRET, { playerId: other, name: 'Other_Duck', tag: '2222', account: true, look: 0 }).token;
    guestToken = signSession(SECRET, { playerId: guest, name: 'Guesty', tag: '3333', account: false }).token;
  });
  afterAll(async () => {
    await meta?.stop();
    await db?.drop();
  });
  // Roomy limits for the rules tests; the rate-limit test puts the real ones back.
  beforeEach(() => {
    meta.progression.limits.duck = new RateLimiter({ capacity: 1000, refillPerSec: 1000 });
  });

  const auth = (t: string): string => `Bearer ${t}`;
  const run = (wavesCleared: number, won: boolean, minionKills = 0, kills = 0, endedAt = Date.now()): RaidRunResult => ({
    runId: `run-${++runs}`, mapId: 'pond-keep', startedAt: endedAt - 600_000, endedAt, wavesCleared, won, bestMs: 600_000,
    players: [{ playerId: duck, name: 'Gear_Duck', wavesCleared, kills, minionKills, comboXp: 0, bossKills: won ? 1 : 0, revives: 0, xp: 0, won }],
  });
  const body = (r: { body: unknown }): { duck?: { feathers: number; owned: string[]; equipped: { katana: string; armor: string | null }; tree: Record<string, number>; respecs: number; level: number }; error?: string; replay?: boolean } => r.body as never;

  it('migrates a database that already holds ducks and runs: nothing lost, rows made on first use', async () => {
    const [p] = await sql<{ xp: string; level: number }[]>`select xp, level from players where id = ${duck}`;
    expect(Number(p!.xp)).toBe(1000);
    expect(p!.level).toBe(4);
    expect(await sql`select 1 from raid_runs where run_key = 'old-run'`).toHaveLength(1);
    expect(await sql`select 1 from duck_progress`).toHaveLength(0);
    const r = await meta.progression.view(auth(token), ip);
    expect(r.status).toBe(200);
    expect(body(r).duck).toMatchObject({ level: 4, feathers: 0, owned: ['katana_bokken'], equipped: { katana: 'katana_bokken', armor: null }, tree: {}, respecs: 0 });
  });

  it('refuses without a token, a guest, and a bad body', async () => {
    expect((await meta.progression.view(undefined, ip)).status).toBe(401);
    expect((await meta.progression.view('Bearer nope', ip)).status).toBe(401);
    expect(body(await meta.progression.view(auth(guestToken), ip)).error).toBe('needs_account');
    expect((await meta.progression.buy(auth(token), { item: 7 }, ip)).status).toBe(400);
    expect((await meta.progression.buy(auth(token), { item: 'katana_bamboo', key: 'x' }, ip)).status).toBe(400);
    // The body never names the duck, a price or a balance: a playerId field changes nothing.
    const r = await meta.progression.buy(auth(token), { item: 'katana_bamboo', playerId: other, cost: 0, feathers: 99999 }, ip);
    expect(body(r).error).toBe('too_poor');
  });

  it('grants Tüy at the run end only, once per run id; the daily bonus once a day for a run that took an objective', async () => {
    // Noon (UTC) three days ago, then the day after it (runs from the future are refused).
    const day = Math.floor(Date.now() / 86_400_000) * 86_400_000 - 3 * 86_400_000 + 43_200_000;
    const r1 = run(2, false, 12, 3, day);
    const want = raidFeathers({ wavesCleared: 2, kills: 3, minionKills: 12, bossKills: 0, won: false });
    const g1 = await meta.recordRaid(r1);
    expect(g1?.get(duck)).toMatchObject({ feathersBefore: 0, feathersAfter: want + FEATHERS.daily, daily: FEATHERS.daily });
    // The same run id again: nothing.
    expect(await meta.recordRaid(r1)).toBeNull();
    // A second run that day: no daily bonus. A run that took nothing: no bonus either.
    const g2 = await meta.recordRaid(run(1, false, 0, 0, day + 3600_000));
    expect(g2?.get(duck)?.daily).toBe(0);
    const g3 = await meta.recordRaid(run(0, false, 0, 0, day + 86_400_000));
    expect(g3?.get(duck)?.daily).toBe(0);
    const g4 = await meta.recordRaid(run(4, true, 200, 40, day + 86_400_000 + 60_000));
    expect(g4?.get(duck)?.daily).toBe(FEATHERS.daily);
    const ledger = await sql<{ reason: string; delta: number }[]>`select reason, delta from feather_ledger where player_id = ${duck} order by id`;
    expect(ledger.map((l) => l.reason)).toEqual(['run', 'daily', 'run', 'run', 'daily']);
    const [p] = await sql<{ feathers: number; feathers_earned: string }[]>`select feathers, feathers_earned from duck_progress where player_id = ${duck}`;
    expect(p!.feathers).toBe(ledger.reduce((n, l) => n + l.delta, 0));
    expect(Number(p!.feathers_earned)).toBe(p!.feathers);
  });

  it('buys: the level, the balance and ownership checked; concurrent buys never spend twice', async () => {
    await sql`update players set level = 4 where id = ${duck}`;
    const before = body(await meta.progression.view(auth(token), ip)).duck!.feathers;
    expect(before).toBeGreaterThanOrEqual(200);
    // Level 4: the Steel Katana needs level 7.
    expect(body(await meta.progression.buy(auth(token), { item: 'katana_steel' }, ip)).error).toBe('needs_level');
    expect(body(await meta.progression.buy(auth(token), { item: 'katana_bokken' }, ip)).error).toBe('not_for_sale');
    expect((await meta.progression.buy(auth(token), { item: 'nope' }, ip)).status).toBe(404);
    // Ten requests for the same item at once: one goes through, the balance drops once.
    const tries = await Promise.all(Array.from({ length: 10 }, () => meta.progression.buy(auth(token), { item: 'katana_bamboo' }, ip)));
    const ok = tries.filter((t) => t.status === 200);
    expect(ok).toHaveLength(1);
    expect(tries.filter((t) => body(t).error === 'owned')).toHaveLength(9);
    const after = body(await meta.progression.view(auth(token), ip)).duck!;
    expect(after.feathers).toBe(before - 200);
    expect(after.owned).toContain('katana_bamboo');
    // Not equipped by itself.
    expect(after.equipped.katana).toBe('katana_bokken');
    expect(await sql`select 1 from feather_ledger where player_id = ${duck} and reason = 'buy'`).toHaveLength(1);
  });

  it('two different items the balance pays for only one of: exactly one goes through', async () => {
    await sql`update duck_progress set feathers = 600 where player_id = ${duck}`;
    await sql`update players set level = 6 where id = ${duck}`;
    const [a, b] = await Promise.all([meta.progression.buy(auth(token), { item: 'armor_padded' }, ip), meta.progression.buy(auth(token), { item: 'armor_leather' }, ip)]);
    // 150 + 550 > 600: whichever came second is too poor.
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([body(a).error, body(b).error].filter(Boolean)).toEqual(['too_poor']);
    const [p] = await sql<{ feathers: number }[]>`select feathers from duck_progress where player_id = ${duck}`;
    expect(p!.feathers === 600 - 150 || p!.feathers === 600 - 550).toBe(true);
    expect(p!.feathers).toBeGreaterThanOrEqual(0);
  });

  it('an idempotency key makes a retried purchase a no-op', async () => {
    await sql`update duck_progress set feathers = 5000 where player_id = ${duck}`;
    await sql`update players set level = 10 where id = ${duck}`;
    const key = 'retry-key-0001';
    const [x, y] = await Promise.all([meta.progression.buy(auth(token), { item: 'armor_chain', key }, ip), meta.progression.buy(auth(token), { item: 'armor_chain', key }, ip)]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect([body(x).replay, body(y).replay].filter(Boolean)).toHaveLength(1);
    const [p] = await sql<{ feathers: number }[]>`select feathers from duck_progress where player_id = ${duck}`;
    expect(p!.feathers).toBe(5000 - 1500);
  });

  it('equips only owned items, in their slot; the kit a run reads follows', async () => {
    expect(body(await meta.progression.equip(auth(token), { item: 'katana_dragon' }, ip)).error).toBe('not_owned');
    expect(body(await meta.progression.equip(auth(otherToken), { item: 'katana_bamboo' }, ip)).error).toBe('not_owned');
    const r = body(await meta.progression.equip(auth(token), { item: 'katana_bamboo' }, ip)).duck!;
    expect(r.equipped.katana).toBe('katana_bamboo');
    body(await meta.progression.equip(auth(token), { item: 'armor_chain' }, ip));
    const kit = await meta.duckKit(duck);
    expect(kit).toMatchObject({ level: 10, katana: 'katana_bamboo', armor: 'armor_chain' });
    // The account API shows the katana on the character select.
    const list = await sql<{ katana: string }[]>`select e.item_id as katana from duck_equipped e where e.player_id = ${duck} and e.slot = 'katana'`;
    expect(list[0]!.katana).toBe('katana_bamboo');
    expect(await meta.duckKit(guest)).toBeNull();
  });

  it('spends tree points by the rules; the first respec is free, then it costs Tüy', async () => {
    const spend = async (node: string) => body(await meta.progression.spend(auth(token), { node }, ip));
    expect((await spend('reach')).error).toBe('needs_node');
    expect((await spend('nope')).error).toBe('unknown');
    for (let i = 0; i < 3; i++) expect((await spend('edge')).duck?.tree.edge).toBe(i + 1);
    expect((await spend('edge')).error).toBe('maxed');
    expect((await spend('iaido')).error).toBe('needs_level');
    // Level 10: 10 points; spend them all.
    for (const n of ['reach', 'reach', 'finisher', 'finisher', 'feathers', 'feathers', 'feathers']) expect((await spend(n)).error).toBeUndefined();
    expect((await spend('tough')).error).toBe('no_points');
    expect((await meta.duckKit(duck))!.tree).toEqual({ edge: 3, reach: 2, finisher: 2, feathers: 3 });
    // Concurrent spends past the points: never more than the points.
    await sql`delete from duck_tree where player_id = ${duck}`;
    await Promise.all(Array.from({ length: 14 }, () => meta.progression.spend(auth(token), { node: 'feathers' }, ip)));
    const [t] = await sql<{ rank: number }[]>`select rank from duck_tree where player_id = ${duck} and node_id = 'feathers'`;
    expect(t!.rank).toBe(3);
    const bal = body(await meta.progression.view(auth(token), ip)).duck!.feathers;
    const r1 = body(await meta.progression.respec(auth(token), {}, ip)).duck!;
    expect(r1.tree).toEqual({});
    expect(r1.respecs).toBe(1);
    expect(r1.feathers).toBe(bal);
    expect(body(await meta.progression.respec(auth(token), {}, ip)).error).toBe('nothing_to_reset');
    await spend('edge');
    const r2 = body(await meta.progression.respec(auth(token), { key: 'respec-key-01' }, ip)).duck!;
    expect(r2.feathers).toBe(bal - RESPEC_COST);
    await spend('edge');
    await sql`update duck_progress set feathers = 10 where player_id = ${duck}`;
    expect(body(await meta.progression.respec(auth(token), {}, ip)).error).toBe('too_poor');
  });

  it('rate limits a duck that hammers the routes', async () => {
    const svc = meta.progression;
    svc.limits.duck = new RateLimiter(PROGRESSION_LIMITS.duck);
    let limited = 0;
    for (let i = 0; i < 40; i++) if ((await svc.view(auth(otherToken), '203.0.113.9')).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });

  it('deleting a duck deletes its progression; deleting the account deletes the rest', async () => {
    await meta.progression.view(auth(otherToken), '198.51.100.1').catch(() => undefined);
    expect(await deleteCharacter(sql, account, duck)).toBe(true);
    for (const t of ['duck_progress', 'feather_ledger', 'duck_items', 'duck_equipped', 'duck_tree']) {
      expect(await sql.unsafe(`select 1 from ${t} where player_id = $1`, [duck])).toHaveLength(0);
    }
    expect(await sql`select 1 from duck_progress where player_id = ${other}`).toHaveLength(1);
    await deleteAccount(sql, account, 'nobody@example.com');
    expect(await sql`select 1 from duck_progress`).toHaveLength(0);
    expect(await sql`select 1 from duck_items`).toHaveLength(0);
  });
});
