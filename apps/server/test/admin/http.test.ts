/**
 * The /admin HTTP surface on a bare http.Server: off without the secrets
 * (plain 404), the login page carries no app code, the Origin check on every
 * POST, login with password and TOTP (replay refused), the session cookie,
 * the app files and API only behind a session, JSON only for API writes,
 * settings changes audited, logout.
 */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAdminConfig } from '../../src/admin/config.ts';
import { createAdminHandler, sameOrigin } from '../../src/admin/http.ts';
import { hashPassword } from '../../src/admin/password.ts';
import { AdminStore } from '../../src/admin/store.ts';
import { hotp, stepAt } from '../../src/admin/totp.ts';
import { COOKIE_NAME } from '../../src/admin/sessions.ts';
import { settings } from '../../src/settings/index.ts';

const SECRET_B32 = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const SECRET = Buffer.from('48656c6c6f21deadbeef48656c6c6f21deadbeef', 'hex'); // base32 JBSWY3DPEHPK3PXP twice
const PASSWORD = 'quack quack admin 2026';

async function listen(handler: ReturnType<typeof createAdminHandler>): Promise<{ server: Server; base: string; host: string }> {
  const server = createServer((req, res) => handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base: `http://${host}`, host };
}

describe('admin panel switched off', () => {
  it('answers every /admin path with the plain 404 of an unknown path', async () => {
    const { server, base } = await listen(createAdminHandler(null));
    try {
      for (const p of ['/admin', '/admin/', '/admin/api/overview', '/admin/assets/x.js']) {
        const r = await fetch(base + p);
        expect(r.status).toBe(404);
        expect(await r.text()).toBe('not found\n');
      }
      expect((await fetch(`${base}/admin/login`, { method: 'POST' })).status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('admin panel', () => {
  let server: Server;
  let base = '';
  let host = '';
  let uiDir = '';
  const store = new AdminStore(() => null);
  let code = '';
  let step = 0;

  beforeAll(async () => {
    uiDir = mkdtempSync(join(tmpdir(), 'qwakk-admin-ui-'));
    mkdirSync(join(uiDir, 'assets'));
    writeFileSync(join(uiDir, 'index.html'), '<!doctype html><title>admin app</title><script type="module" src="/admin/assets/app-1.js"></script>');
    writeFileSync(join(uiDir, 'assets', 'app-1.js'), 'console.log("admin app")');
    const hash = await hashPassword(PASSWORD, { logN: 14, r: 8, p: 1, keyLen: 32, saltLen: 16 });
    const { config } = loadAdminConfig({ ADMIN_PASSWORD_HASH: hash, ADMIN_TOTP_SECRET: SECRET_B32, QWAKK_ADMIN_DIR: uiDir });
    expect(config).not.toBeNull();
    const handler = createAdminHandler({ config: config!, store, trustProxyHops: 0, overview: async () => ({ rooms: [] }), clearLeaderboardCache: () => {} });
    ({ server, base, host } = await listen(handler));
  });

  afterAll(() => {
    server.close();
    rmSync(uiDir, { recursive: true, force: true });
    settings.reset('dm.scoreLimit');
  });

  /** A code for a step the guard has not seen yet (it refuses a used one), within the drift window. */
  const nextCode = (): string => {
    step = Math.max(step + 1, stepAt(Date.now()) - 1);
    code = hotp(SECRET, step);
    return code;
  };
  /** A code for a request that never reaches the code check. */
  const anyCode = '123456';
  const login = (password: string, c: string, headers: Record<string, string> = { origin: `http://${host}` }) =>
    fetch(`${base}/admin/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ password, code: c }).toString() });

  it('shows the login page without any script', async () => {
    const r = await fetch(`${base}/admin`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('name="password"');
    expect(html).toContain('name="code"');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('app-1.js');
    const csp = r.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps the app files and the API behind a session', async () => {
    expect((await fetch(`${base}/admin/assets/app-1.js`)).status).toBe(404);
    expect((await fetch(`${base}/admin/api/overview`)).status).toBe(401);
    expect((await fetch(`${base}/admin/nothing`)).status).toBe(404);
  });

  it('refuses POSTs without our own Origin', async () => {
    expect((await login(PASSWORD, anyCode, {})).status).toBe(403);
    expect((await login(PASSWORD, anyCode, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await login(PASSWORD, anyCode, { origin: 'https://qwakk.fun' })).status).toBe(403);
    expect((await login(PASSWORD, anyCode, { origin: `http://${host}`, 'sec-fetch-site': 'same-site' })).status).toBe(403);
  });

  it('checks the Origin by host and, in production, https', () => {
    const req = (origin: string | undefined, h: string, site?: string) => ({ headers: { origin, host: h, ...(site ? { 'sec-fetch-site': site } : {}) } }) as never;
    expect(sameOrigin(req('https://play.qwakk.fun', 'play.qwakk.fun'), true)).toBe(true);
    expect(sameOrigin(req('http://play.qwakk.fun', 'play.qwakk.fun'), true)).toBe(false);
    expect(sameOrigin(req('https://qwakk.fun', 'play.qwakk.fun'), true)).toBe(false);
    expect(sameOrigin(req(undefined, 'play.qwakk.fun'), true)).toBe(false);
    expect(sameOrigin(req('null', 'play.qwakk.fun'), true)).toBe(false);
    expect(sameOrigin(req('https://play.qwakk.fun', 'play.qwakk.fun', 'cross-site'), true)).toBe(false);
  });

  it('refuses a wrong password or a wrong code with the same answer', async () => {
    const a = await login('wrong password', anyCode);
    expect(a.status).toBe(303);
    expect(a.headers.get('location')).toBe('/admin?e=bad');
    expect(a.headers.get('set-cookie')).toBeNull();
    const b = await login(PASSWORD, '000000');
    expect(b.headers.get('location')).toBe('/admin?e=bad');
  });

  let cookie = '';

  it('logs in with the password and a fresh code, and refuses the same code again', async () => {
    const c = nextCode();
    const r = await login(PASSWORD, c);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/admin');
    const set = r.headers.get('set-cookie') ?? '';
    expect(set).toMatch(new RegExp(`^${COOKIE_NAME}=v1\\.`));
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) expect(set).toContain(flag);
    cookie = set.split(';')[0]!;
    const replay = await login(PASSWORD, c);
    expect(replay.headers.get('location')).toBe('/admin?e=bad');
    expect(replay.headers.get('set-cookie')).toBeNull();
  });

  it('serves the app shell, its files and the API with the session', async () => {
    const shell = await fetch(`${base}/admin`, { headers: { cookie } });
    expect(await shell.text()).toContain('app-1.js');
    expect(shell.headers.get('content-security-policy')).toContain("script-src 'self'");
    const js = await fetch(`${base}/admin/assets/app-1.js`, { headers: { cookie } });
    expect(js.status).toBe(200);
    expect(js.headers.get('cache-control')).toBe('no-store');
    expect((await fetch(`${base}/admin/assets/nope.js`, { headers: { cookie } })).status).toBe(404);
    expect((await fetch(`${base}/admin/assets/.env`, { headers: { cookie } })).status).toBe(404);
    const me = await fetch(`${base}/admin/api/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { actor: string }).actor).toMatch(/^admin@/);
  });

  it('takes API writes as JSON from our origin only, and logs them', async () => {
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}/admin/api/${path}`, { method: 'POST', headers: { cookie, origin: `http://${host}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    expect((await post('settings/set', { key: 'dm.scoreLimit', value: 30 }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('settings/set', { key: 'dm.scoreLimit', value: 30 }, { 'content-type': 'text/plain' })).status).toBe(415);
    const r = await post('settings/set', { key: 'dm.scoreLimit', value: 30 });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ key: 'dm.scoreLimit', value: 30, clamped: false, isDefault: false });
    expect(settings.num('dm.scoreLimit')).toBe(30);
    const clamped = (await (await post('settings/set', { key: 'dm.scoreLimit', value: 9999 })).json()) as { value: number; clamped: boolean };
    expect(clamped).toMatchObject({ value: 500, clamped: true });
    expect((await post('settings/set', { key: 'no.such', value: 1 })).status).toBe(400);
    expect((await post('settings/set', { key: 'dm.room.istanbul', value: 'yes' })).status).toBe(400);
    const audit = (await (await fetch(`${base}/admin/api/audit`, { headers: { cookie } })).json()) as { entries: { action: string; target: string; old: unknown; new: unknown }[] };
    const sets = audit.entries.filter((e) => e.action === 'setting.set' && e.target === 'dm.scoreLimit');
    expect(sets[0]).toMatchObject({ old: 30, new: 500 });
    expect(sets[1]).toMatchObject({ old: 50, new: 30 });
    expect(audit.entries.some((e) => e.action === 'login')).toBe(true);
    const reset = (await (await post('settings/reset', { key: 'dm.scoreLimit' })).json()) as { value: number; isDefault: boolean };
    expect(reset).toMatchObject({ value: 50, isDefault: true });
  });

  it('logs out for good', async () => {
    const r = await fetch(`${base}/admin/logout`, { method: 'POST', redirect: 'manual', headers: { cookie, origin: `http://${host}` } });
    expect(r.status).toBe(303);
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await fetch(`${base}/admin/api/me`, { headers: { cookie } })).status).toBe(401);
  });

  it('locks the address out after repeated failures', async () => {
    let last: string | null = null;
    for (let i = 0; i < 6; i++) last = (await login('wrong', '111111')).headers.get('location');
    expect(last).toBe('/admin?e=locked');
    // Even the right password and a fresh code wait now.
    expect((await login(PASSWORD, nextCode())).headers.get('location')).toBe('/admin?e=locked');
  });
});
