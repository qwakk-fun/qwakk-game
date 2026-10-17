/**
 * The admin store on PostgreSQL (skipped when the local test database is not
 * running): migration 002 applies, settings, bans and blocked words survive a
 * reload (a restart), the audit log pages, and a hidden player leaves the
 * leaderboard while the matches stay recorded.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminStore } from '../../src/admin/store.ts';
import { checkName, setExtraBlocked } from '../../src/meta/names.ts';
import { MetaService } from '../../src/meta/service.ts';
import { isBanned, replaceBans } from '../../src/ops/bans.ts';
import { settings } from '../../src/settings/index.ts';
import { dbReachable, freshDatabase } from '../meta/testDb.ts';

const reachable = await dbReachable();
const SECRET = 'admin-db-test-secret-admin-db-test-01';

describe.skipIf(!reachable)('admin store (PostgreSQL)', () => {
  let db: { url: string; drop: () => Promise<void> };
  let meta: MetaService;
  let store: AdminStore;
  beforeAll(async () => {
    db = await freshDatabase('admin');
    meta = new MetaService({ env: { DATABASE_URL: db.url, SESSION_SECRET: SECRET } });
    await meta.start();
    store = new AdminStore(() => (meta.dbState === 'up' ? meta.sql : null));
  });
  afterAll(async () => {
    settings.reset('dm.players');
    settings.reset('ops.banner');
    replaceBans([]);
    setExtraBlocked([]);
    await meta?.stop();
    await db?.drop();
  });

  it('stores settings, bans and words, and loads them back after a restart', async () => {
    expect(store.persistent).toBe(true);
    settings.set('dm.players', 12);
    await store.saveSetting('dm.players', 12);
    settings.set('ops.banner', 'Hello pond');
    await store.saveSetting('ops.banner', 'Hello pond');
    const banned = '00000000-0000-4000-8000-0000000000b1';
    await store.addBan({ playerId: banned, reason: 'spam', createdAt: Date.now(), expiresAt: Date.now() + 3600_000 }, 'admin@test');
    await store.addWord('gander', false, 'admin@test');

    // A restart: memory forgets everything, load() brings it back.
    settings.reset('dm.players');
    settings.reset('ops.banner');
    replaceBans([]);
    setExtraBlocked([]);
    expect(isBanned(banned)).toBe(false);
    expect(await store.load()).toBe(true);
    expect(settings.num('dm.players')).toBe(12);
    expect(settings.text('ops.banner')).toBe('Hello pond');
    expect(isBanned(banned)).toBe(true);
    expect(checkName('Gander_7')).toEqual({ ok: false, reason: 'blocked' });

    // Back to the default deletes the row.
    settings.reset('dm.players');
    await store.saveSetting('dm.players', null);
    const rows = await meta.sql!<{ key: string }[]>`select key from admin_settings order by key`;
    expect(rows.map((r) => r.key)).toEqual(['ops.banner']);
  });

  it('keeps an audit log that pages back by id', async () => {
    for (let i = 0; i < 5; i++) await store.audit('admin@test', 'setting.set', `k${i}`, i, i + 1);
    const first = await store.listAudit(null, 3);
    expect(first.map((e) => e.target)).toEqual(['k4', 'k3', 'k2']);
    expect(first[0]).toMatchObject({ actor: 'admin@test', old: 4, new: 5 });
    const next = await store.listAudit(first[2]!.id, 3);
    expect(next.map((e) => e.target)).toEqual(['k1', 'k0']);
  });

  it('a hidden player leaves the leaderboard; the matches stay', async () => {
    const make = async (name: string) => (await meta.createSession({ name }, '127.0.0.1')).body as { playerId: string };
    const a = await make('Alpha');
    const b = await make('Bravo');
    await meta.recordMatch({
      matchId: 'admin-hide-1',
      mode: 'br',
      mapId: 'sainte-canard',
      startedAt: Date.now() - 60_000,
      endedAt: Date.now(),
      players: [
        { playerId: a.playerId, name: 'Alpha', isBot: false, placement: 1, kills: 3, damage: 300, survivedMs: 60_000 },
        { playerId: b.playerId, name: 'Bravo', isBot: false, placement: 2, kills: 1, damage: 100, survivedMs: 50_000 },
      ],
    });
    const names = async () => (((await meta.leaderboard(new URLSearchParams(), '10.9.9.9')).body as { rows: { name: string }[] }).rows ?? []).map((r) => r.name);
    expect(await names()).toEqual(['Alpha', 'Bravo']);
    await store.hide(a.playerId, 'cheating', 'admin@test');
    meta.clearCache();
    expect(await names()).toEqual(['Bravo']);
    expect((await store.listHidden()).map((h) => h.name)).toEqual(['Alpha']);
    const found = await store.searchPlayers('alp');
    expect(found?.[0]).toMatchObject({ name: 'Alpha', hidden: true });
    await store.unhide(a.playerId);
    meta.clearCache();
    expect(await names()).toEqual(['Alpha', 'Bravo']);
    const [n] = await meta.sql!<{ n: number }[]>`select count(*)::int as n from match_players`;
    expect(n?.n).toBe(2);
  });
});
