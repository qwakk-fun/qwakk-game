import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, readMigrations } from '../../src/meta/migrate.ts';
import { MetaService } from '../../src/meta/service.ts';
import type { MatchResult } from '../../src/meta/matches.ts';
import { dbReachable, freshDatabase } from './testDb.ts';

const reachable = await dbReachable();
const SECRET = 'db-test-secret-db-test-secret-db-test-1';

describe.skipIf(!reachable)('migration runner (PostgreSQL)', () => {
  let db: { url: string; drop: () => Promise<void> };
  let sql: Sql;
  beforeAll(async () => {
    db = await freshDatabase('migrate');
    sql = postgres(db.url, { max: 2, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql?.end();
    await db?.drop();
  });

  it('applies the real migrations once, then nothing', async () => {
    const files = await readMigrations();
    expect(files.map((f) => f.name)).toContain('001_init.sql');
    expect(await migrate(sql, files)).toEqual(files.map((f) => f.name));
    expect(await migrate(sql, files)).toEqual([]);
    const [s] = await sql<{ id: number }[]>`select id from seasons`;
    expect(s?.id).toBe(1);
  });

  it('runs concurrently without double-applying, and rolls back a failing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qwakk-mig-'));
    await writeFile(join(dir, '900_extra.sql'), 'create table extra_a (id int);');
    const files = [...(await readMigrations()), ...(await readMigrations(dir))];
    const [a, b] = await Promise.all([migrate(sql, files), migrate(sql, files)]);
    expect([...a, ...b]).toEqual(['900_extra.sql']);

    await writeFile(join(dir, '901_broken.sql'), 'create table extra_b (id int); select nope_not_a_function();');
    await expect(migrate(sql, [...files, ...(await readMigrations(dir)).filter((f) => f.name === '901_broken.sql')])).rejects.toThrow();
    const [t] = await sql<{ n: number }[]>`select count(*)::int as n from information_schema.tables where table_name = 'extra_b'`;
    expect(t?.n).toBe(0);
  });
});

describe.skipIf(!reachable)('recordMatch and leaderboard (PostgreSQL)', () => {
  let db: { url: string; drop: () => Promise<void> };
  let meta: MetaService;
  beforeAll(async () => {
    db = await freshDatabase('record');
    meta = new MetaService({ env: { DATABASE_URL: db.url, SESSION_SECRET: SECRET } });
    await meta.start();
  });
  afterAll(async () => {
    await meta?.stop();
    await db?.drop();
  });

  async function guest(name: string): Promise<{ playerId: string; tag: string; deviceToken: string }> {
    const r = await meta.createSession({ name }, `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`);
    expect(r.status).toBe(200);
    return r.body as { playerId: string; tag: string; deviceToken: string };
  }

  function match(id: string, players: MatchResult['players'], mode: 'br' | 'dm' = 'br'): MatchResult {
    return { matchId: id, mode, mapId: 'island-1', startedAt: Date.now() - 300_000, endedAt: Date.now(), players };
  }

  it('records humans and bots, ranks humans only, and ignores a repeated matchId', async () => {
    expect(meta.dbState).toBe('up');
    const a = await guest('Alpha');
    const b = await guest('Bravo');
    const result = match('m-1', [
      { playerId: a.playerId, name: 'Alpha', isBot: false, placement: 1, kills: 4, damage: 610, survivedMs: 290_000 },
      { playerId: null, name: 'BotDuck', isBot: true, placement: 2, kills: 9, damage: 900, survivedMs: 280_000 },
      { playerId: b.playerId, name: 'Bravo', isBot: false, placement: 3, kills: 1, damage: 120, survivedMs: 100_000 },
      { playerId: 'dev-123', name: 'DevGuest', isBot: false, placement: 4, kills: 0, damage: 0, survivedMs: 10_000 },
    ]);
    await meta.recordMatch(result);
    await meta.recordMatch(result);
    const sql = meta.sql!;
    const [m] = await sql<{ n: number }[]>`select count(*)::int as n from matches`;
    expect(m?.n).toBe(1);
    const rows = await sql<{ player_id: string | null; is_bot: boolean; points: number; deaths: number }[]>`select player_id, is_bot, points, deaths from match_players order by slot`;
    expect(rows.map((r) => r.points)).toEqual([140, 0, 27, 0]);
    expect(rows.map((r) => r.deaths)).toEqual([0, 1, 1, 1]);
    expect(rows[3]?.player_id).toBeNull();

    const lb = await meta.leaderboard(new URLSearchParams(), '1.1.1.1');
    expect(lb.status).toBe(200);
    const body = lb.body as { total: number; rows: { name: string; tag: string; rank: number; score: number; wins: number; kd: number }[] };
    expect(body.total).toBe(2);
    expect(body.rows.map((r) => [r.rank, r.name, r.score, r.wins])).toEqual([
      [1, 'Alpha', 140, 1],
      [2, 'Bravo', 27, 0],
    ]);
    expect(body.rows[0]?.tag).toBe(a.tag);
  });

  it('never throws on bad input or a broken database', async () => {
    await expect(meta.recordMatch({} as MatchResult)).resolves.toBeUndefined();
    await expect(meta.recordMatch(match('m-bad', [{ playerId: null, name: 'x', isBot: false, placement: NaN, kills: Infinity, damage: -5, survivedMs: 0 }]))).resolves.toBeUndefined();
    const broken = new MetaService({ env: { DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none', SESSION_SECRET: SECRET }, retryMs: 60_000 });
    await broken.start();
    expect(broken.dbState).toBe('down');
    await expect(broken.recordMatch(match('m-x', [{ playerId: null, name: 'x', isBot: false, placement: 1, kills: 0, damage: 0, survivedMs: 0 }]))).resolves.toBeUndefined();
    await broken.stop();
  });

  it('keeps the player id and stats across a rename and gives each name a free tag', async () => {
    const first = await guest('Charlie');
    const again = await meta.createSession({ name: 'Delta', deviceToken: first.deviceToken }, '9.9.9.9');
    const renamed = again.body as { playerId: string; tag: string; deviceToken: string };
    expect(renamed.playerId).toBe(first.playerId);
    expect(renamed.deviceToken).toBe(first.deviceToken);
    // Many guests under one name never share a tag.
    const tags = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const r = await meta.createSession({ name: 'SameName' }, `172.16.0.${i}`);
      tags.add((r.body as { tag: string }).tag);
    }
    expect(tags.size).toBe(25);
  });

  it('sorts by kills, filters by mode, and reports my standing', async () => {
    const e = await guest('Echo');
    await meta.recordMatch(match('m-2', [
      { playerId: e.playerId, name: 'Echo', isBot: false, placement: 1, kills: 30, damage: 3000, survivedMs: 300_000, deaths: 2 },
      { playerId: null, name: 'Bot', isBot: true, placement: 2, kills: 3, damage: 300, survivedMs: 300_000 },
    ], 'dm'));
    const byKills = (await meta.leaderboard(new URLSearchParams('sort=kills'), '2.2.2.2')).body as { rows: { name: string; kills: number }[] };
    expect(byKills.rows[0]).toMatchObject({ name: 'Echo', kills: 30 });
    const brOnly = (await meta.leaderboard(new URLSearchParams('mode=br'), '2.2.2.2')).body as { rows: { name: string }[] };
    expect(brOnly.rows.map((r) => r.name)).not.toContain('Echo');
    expect((await meta.leaderboard(new URLSearchParams('sort=nope'), '2.2.2.2')).status).toBe(400);

    const session = await meta.createSession({ name: 'Echo', deviceToken: (e as { deviceToken: string }).deviceToken }, '3.3.3.3');
    const token = (session.body as { token: string }).token;
    const me = await meta.me(`Bearer ${token}`, new URLSearchParams(), '3.3.3.3');
    expect(me.status).toBe(200);
    expect((me.body as { standing: { rank: number; kills: number; kd: number } }).standing).toMatchObject({ kills: 30, kd: 15 });
    expect((await meta.me('Bearer nope', new URLSearchParams(), '3.3.3.3')).status).toBe(401);
  });
});
