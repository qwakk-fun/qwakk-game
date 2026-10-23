/**
 * Hunt Season results on a real PostgreSQL (skipped without the local test
 * database): migration 004, XP and level granted once per run (a retried
 * write grants nothing), the personal best, only account ducks get XP, and
 * deleting a duck removes its best and unlinks its run rows.
 */
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levelOfXp, raidXp } from '@qwakk/shared';
import { MetaService } from '../../src/meta/service.ts';
import type { RaidRunResult } from '../../src/meta/raid.ts';
import { dbReachable, freshDatabase } from './testDb.ts';

const reachable = await dbReachable();

describe.skipIf(!reachable)('hunt season results (PostgreSQL)', () => {
  let db: { url: string; drop: () => Promise<void> };
  let meta: MetaService;
  let sql: Sql;
  const account = randomUUID();
  const duck = randomUUID();
  const guest = randomUUID();

  beforeAll(async () => {
    db = await freshDatabase('raid');
    meta = new MetaService({ env: { DATABASE_URL: db.url, SESSION_SECRET: 'raid-test-secret-raid-test-secret-12345' }, mailer: null });
    await meta.start();
    sql = meta.sql!;
    await sql`insert into accounts (id, legal_version, legal_accepted_at, age_confirmed_at) values (${account}, 'x', now(), now())`;
    await sql`insert into players (id, name, tag, account_id, slot, look) values (${duck}, 'Hunter_Duck', 1234, ${account}, 0, 0)`;
    await sql`insert into players (id, name, tag) values (${guest}, 'Guesty', 2345)`;
  });
  afterAll(async () => {
    await meta?.stop();
    await db?.drop();
  });

  const run = (id: string, waves: number, kills: number, won = false, ms = 600_000): RaidRunResult => ({
    runId: id, mapId: 'canard-quarter', startedAt: Date.now() - ms, endedAt: Date.now(), wavesCleared: waves, won, bestMs: ms,
    players: [
      { playerId: duck, name: 'Hunter_Duck', wavesCleared: waves, kills, bossKills: waves >= 5 ? 1 : 0, revives: 0, xp: 999999, won },
      { playerId: guest, name: 'Guesty', wavesCleared: waves, kills: 3, bossKills: 0, revives: 0, xp: 50, won },
    ],
  });

  it('grants the formula XP to the account duck, once per run id', async () => {
    const g = await meta.recordRaid(run('run-1', 3, 10));
    const want = raidXp({ wavesCleared: 3, kills: 10, bossKills: 0, revives: 0, won: false });
    // The room's number (999999) is not trusted: the grant is the shared formula.
    expect(g?.get(duck)).toMatchObject({ xpBefore: 0, xpAfter: want, levelBefore: 1, levelAfter: levelOfXp(want), bestWave: 3, newBest: true });
    expect(g?.has(guest)).toBe(false);
    expect(await meta.recordRaid(run('run-1', 3, 10))).toBeNull();
    const [p] = await sql<{ xp: string; level: number }[]>`select xp, level from players where id = ${duck}`;
    expect(Number(p!.xp)).toBe(want);
    expect(p!.level).toBe(levelOfXp(want));
    const [gp] = await sql<{ xp: string }[]>`select xp from players where id = ${guest}`;
    expect(Number(gp!.xp)).toBe(0);
    const rows = await sql<{ player_id: string | null; xp: number }[]>`select player_id, xp from raid_run_players order by slot`;
    expect(rows).toEqual([{ player_id: duck, xp: want }, { player_id: null, xp: 0 }]);
  });

  it('keeps the best wave, and the fastest time for it', async () => {
    const worse = await meta.recordRaid(run('run-2', 2, 5));
    expect(worse?.get(duck)).toMatchObject({ bestWave: 3, newBest: false });
    const faster = await meta.recordRaid(run('run-3', 3, 5, false, 300_000));
    expect(faster?.get(duck)).toMatchObject({ bestWave: 3, bestMs: 300_000, newBest: true });
    const win = await meta.recordRaid(run('run-4', 15, 140, true, 900_000));
    expect(win?.get(duck)).toMatchObject({ bestWave: 15, bestMs: 900_000, newBest: true });
    const [b] = await sql<{ best_wave: number; runs: number; wins: number }[]>`select best_wave, runs, wins from raid_bests where player_id = ${duck}`;
    expect(b).toEqual({ best_wave: 15, runs: 4, wins: 1 });
    // The account API shows it.
    const list = await sql<{ best_wave: number }[]>`select b.best_wave from players p left join raid_bests b on b.player_id = p.id where p.id = ${duck}`;
    expect(list[0]!.best_wave).toBe(15);
  });

  it('deleting the duck drops its best and unlinks its run rows', async () => {
    await sql`delete from players where id = ${duck}`;
    expect(await sql`select 1 from raid_bests where player_id = ${duck}`).toHaveLength(0);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from raid_run_players where player_id is null`;
    expect(n!.n).toBeGreaterThan(4);
  });
});
