/**
 * The contract the game rooms use (src/meta/index.ts), end to end against a
 * real PostgreSQL: create a session over HTTP, verifySession, recordMatch,
 * then read the leaderboard over HTTP.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allowJoin, joinIp, meta, metaHttpHandler, recordMatch, startMeta, stopMeta, verifySession } from '../../src/meta/index.ts';
import { dbReachable, freshDatabase } from './testDb.ts';

const reachable = await dbReachable();

describe.skipIf(!reachable)('meta contract end to end (PostgreSQL)', () => {
  let db: { url: string; drop: () => Promise<void> };
  let server: Server;
  let base: string;
  beforeAll(async () => {
    db = await freshDatabase('contract');
    process.env.DATABASE_URL = db.url;
    process.env.SESSION_SECRET = 'contract-secret-contract-secret-123456';
    await startMeta();
    server = createServer((req, res) => metaHttpHandler(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server?.close();
    await stopMeta();
    await db?.drop();
  });

  it('session -> verifySession -> recordMatch -> leaderboard', async () => {
    const res = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mandarin' }) });
    const s = (await res.json()) as { token: string; playerId: string; tag: string };
    const who = await verifySession(s.token);
    expect(who).toEqual({ playerId: s.playerId, name: 'Mandarin', tag: s.tag, account: false });
    expect(await verifySession('s1.forged.sig')).toBeNull();

    const pending = recordMatch({
      matchId: 'contract-1',
      mode: 'br',
      mapId: 'island-1',
      startedAt: Date.now() - 600_000,
      endedAt: Date.now(),
      players: [
        { playerId: who!.playerId, name: who!.name, isBot: false, placement: 1, kills: 7, damage: 900, survivedMs: 600_000 },
        { playerId: null, name: 'Bot 1', isBot: true, placement: 2, kills: 2, damage: 200, survivedMs: 500_000 },
      ],
    });
    expect(pending).toBeInstanceOf(Promise);
    await pending;

    const lb = (await (await fetch(`${base}/api/leaderboard?sort=score`)).json()) as { rows: { name: string; tag: string; score: number; wins: number; kills: number }[] };
    expect(lb.rows).toEqual([expect.objectContaining({ name: 'Mandarin', tag: s.tag, score: 170, wins: 1, kills: 7 })]);
    const me = (await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${s.token}` } })).json()) as { standing: { rank: number } };
    expect(me.standing.rank).toBe(1);
    expect(meta().dbState).toBe('up');
  });

  it('allowJoin and joinIp', () => {
    expect(joinIp({ ip: '::ffff:4.4.4.4' })).toBe('4.4.4.4');
    expect(joinIp(undefined)).toBe('unknown');
    expect(allowJoin('4.4.4.4')).toBe(true);
  });
});
