/**
 * Moderation in the meta layer (no database): a ban ends the player's
 * sessions and refuses a new one for its device token; an IP block (memory
 * only) refuses sockets, joins and new sessions from that address (IPv6 per
 * /64) until it ends; extra blocked words reach the name filter; the memory
 * store keeps an audit log without the database.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AdminStore } from '../../src/admin/store.ts';
import { checkName } from '../../src/meta/names.ts';
import { MetaService } from '../../src/meta/service.ts';
import { dropBan, isBanned, putBan } from '../../src/ops/bans.ts';
import { blockIp, clearIpBlocks, isIpBlocked, listIpBlocks, maskKey, unblockIp } from '../../src/ops/ipBlocks.ts';

const SECRET = 'moderation-test-secret-moderation-test-1';

afterEach(() => clearIpBlocks());

describe('bans', () => {
  it('a ban ends sessions and refuses new ones for that device token', async () => {
    const meta = new MetaService({ env: { SESSION_SECRET: SECRET } });
    const first = (await meta.createSession({ name: 'Mallard' }, '10.1.1.1')).body as { token: string; deviceToken: string; playerId: string };
    expect(meta.verifySession(first.token)?.playerId).toBe(first.playerId);
    putBan({ playerId: first.playerId, reason: 'test', createdAt: Date.now(), expiresAt: null });
    expect(isBanned(first.playerId)).toBe(true);
    expect(meta.verifySession(first.token)).toBeNull();
    const again = await meta.createSession({ name: 'Mallard', deviceToken: first.deviceToken }, '10.1.1.1');
    expect(again).toMatchObject({ status: 403, body: { error: 'banned' } });
    dropBan(first.playerId);
    expect(meta.verifySession(first.token)?.playerId).toBe(first.playerId);
    expect((await meta.createSession({ name: 'Mallard', deviceToken: first.deviceToken }, '10.1.1.1')).status).toBe(200);
  });

  it('a ban with an end lifts itself', () => {
    const id = '00000000-0000-4000-8000-00000000ab01';
    putBan({ playerId: id, reason: '', createdAt: 0, expiresAt: 1000 });
    expect(isBanned(id, 999)).toBe(true);
    expect(isBanned(id, 1000)).toBe(false);
  });
});

describe('IP blocks (memory only)', () => {
  it('refuses sockets, joins and new sessions from a blocked address until the block ends', async () => {
    const meta = new MetaService({ env: { SESSION_SECRET: SECRET, NODE_ENV: 'test' } });
    const socket = { once: () => undefined };
    expect(meta.admitSocket('203.0.113.9', socket)).toBe(true);
    const b = blockIp('203.0.113.9', 30, 'Duck#1234 in istanbul');
    expect(isIpBlocked('203.0.113.9')).toBe(true);
    expect(isIpBlocked('203.0.113.10')).toBe(false);
    expect(meta.admitSocket('203.0.113.9', socket)).toBe(false);
    expect(meta.allowJoin('203.0.113.9')).toBe(false);
    expect((await meta.createSession({ name: 'Teal' }, '203.0.113.9')).status).toBe(429);
    expect(listIpBlocks()).toEqual([{ id: b.id, masked: '203.0.113.x', label: 'Duck#1234 in istanbul', until: b.until, createdAt: b.createdAt }]);
    expect(unblockIp(b.id)?.id).toBe(b.id);
    expect(meta.allowJoin('203.0.113.9')).toBe(true);
  });

  it('blocks an IPv6 /64, caps the length and ends on time', () => {
    const b = blockIp('2001:db8:aa:bb::1', 999_999, 'manual', 0);
    expect(isIpBlocked('2001:db8:aa:bb:1234::9', 1000)).toBe(true);
    expect(isIpBlocked('2001:db8:aa:bc::1', 1000)).toBe(false);
    expect(b.until).toBe(24 * 3600_000);
    expect(isIpBlocked('2001:db8:aa:bb::1', 24 * 3600_000)).toBe(false);
    expect(maskKey('2001:db8:aa:bb::/64')).toBe('2001:db8:...');
  });

  it('even loopback is blocked (no dev exemption for blocks)', () => {
    blockIp('127.0.0.1', 5, 'manual');
    const meta = new MetaService({ env: { SESSION_SECRET: SECRET } });
    expect(meta.allowJoin('127.0.0.1')).toBe(false);
  });
});

describe('admin store without a database', () => {
  it('keeps blocked words, bans and the audit log in memory', async () => {
    const store = new AdminStore(() => null);
    expect(store.persistent).toBe(false);
    expect(checkName('Gooseface').ok).toBe(true);
    await store.addWord('goose', false, 'admin@test');
    expect(checkName('Gooseface')).toEqual({ ok: false, reason: 'blocked' });
    expect(checkName('G00seface')).toEqual({ ok: false, reason: 'blocked' });
    await store.addWord('teal', true, 'admin@test');
    expect(checkName('Teal')).toEqual({ ok: false, reason: 'blocked' });
    expect(checkName('Big_Teal')).toEqual({ ok: false, reason: 'blocked' });
    expect(checkName('Tealish').ok).toBe(true); // whole word only
    await store.removeWord('goose');
    await store.removeWord('teal');
    expect(checkName('Gooseface').ok).toBe(true);
    expect(store.listWords()).toEqual([]);

    const id = '00000000-0000-4000-8000-00000000ab02';
    await store.addBan({ playerId: id, reason: 'spam', createdAt: Date.now(), expiresAt: null }, 'admin@test');
    expect(isBanned(id)).toBe(true);
    expect((await store.listBans()).map((b) => b.playerId)).toContain(id);
    await store.removeBan(id);
    expect(isBanned(id)).toBe(false);

    await store.audit('admin@test', 'setting.set', 'dm.players', 24, 10);
    await store.audit('admin@test', 'notice.send', '1 rooms', null, { text: 'hi' });
    const log = await store.listAudit(null, 10);
    expect(log.map((e) => e.action)).toEqual(['notice.send', 'setting.set']);
    expect(log[1]).toMatchObject({ actor: 'admin@test', target: 'dm.players', old: 24, new: 10 });
    expect(await store.listAudit(log[0]!.id, 10)).toHaveLength(1);
  });
});
