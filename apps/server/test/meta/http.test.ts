import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetaHandler } from '../../src/meta/http.ts';
import { applyMatchmakingCors, checkUpgradeOrigin, meta } from '../../src/meta/index.ts';
import { MetaService } from '../../src/meta/service.ts';
import type { FetchLike } from '../../src/meta/turnstile.ts';

const SECRET = 'http-test-secret-http-test-secret-12345';

async function serve(meta: MetaService): Promise<{ base: string; server: Server }> {
  const server = createServer(createMetaHandler(meta));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('meta HTTP without a database (dev)', () => {
  let meta: MetaService;
  let base: string;
  let server: Server;
  beforeAll(async () => {
    meta = new MetaService({ env: { SESSION_SECRET: SECRET } });
    ({ base, server } = await serve(meta));
  });
  afterAll(() => server.close());

  it('answers /health without a database', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, db: 'off' });
  });

  it('creates a session that verifySession accepts, and keeps the id on rename', async () => {
    const r = await post(base, { name: 'Mallard' });
    expect(r.status).toBe(200);
    const s = (await r.json()) as { token: string; deviceToken: string; playerId: string; name: string; tag: string };
    expect(s.tag).toMatch(/^\d{4}$/);
    expect(meta.verifySession(s.token)).toEqual({ playerId: s.playerId, name: 'Mallard', tag: s.tag });
    const again = (await (await post(base, { name: 'Mallard', deviceToken: s.deviceToken })).json()) as { playerId: string; tag: string };
    expect(again).toMatchObject({ playerId: s.playerId, tag: s.tag });
    const renamed = (await (await post(base, { name: 'Teal', deviceToken: s.deviceToken })).json()) as { playerId: string };
    expect(renamed.playerId).toBe(s.playerId);
  });

  it('rejects bad names, bodies and content types', async () => {
    expect(((await (await post(base, { name: 'sh1tduck' })).json()) as { error: string }).error).toBe('name_blocked');
    expect(((await (await post(base, { name: 'x' })).json()) as { error: string }).error).toBe('name_format');
    expect((await post(base, { name: 'A'.repeat(5000) })).status).toBe(413);
    expect((await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' })).status).toBe(415);
    expect((await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' })).status).toBe(400);
    expect((await fetch(`${base}/api/session`)).status).toBe(405);
    expect((await fetch(`${base}/api/nothing`)).status).toBe(404);
  });

  it('gives a dev guest without a token, null for a bad token', () => {
    const g = meta.verifySession(undefined);
    expect(g?.playerId).toMatch(/^dev-/);
    expect(meta.verifySession('s1.bad.token')).toBeNull();
  });

  it('says the leaderboard is unavailable, and /api/me still knows you', async () => {
    expect((await fetch(`${base}/api/leaderboard`)).status).toBe(503);
    const s = (await (await post(base, { name: 'Pintail' })).json()) as { token: string };
    const me = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${s.token}` } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ player: { name: 'Pintail' }, leaderboard: false, standing: null });
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });

  it('rate-limits session creation per IP', async () => {
    const m = new MetaService({ env: { SESSION_SECRET: SECRET } });
    const codes = [];
    for (let i = 0; i < 10; i++) codes.push((await m.createSession({ name: 'Wigeon' }, '5.5.5.5')).status);
    expect(codes.filter((c) => c === 200)).toHaveLength(8);
    expect(codes.slice(-1)[0]).toBe(429);
    expect((await m.createSession({ name: 'Wigeon' }, '5.5.5.6')).status).toBe(200);
  });

  it('limits joins per IP', () => {
    const m = new MetaService({ env: { SESSION_SECRET: SECRET } });
    const ok = Array.from({ length: 15 }, () => m.allowJoin('::ffff:7.7.7.7')).filter(Boolean).length;
    expect(ok).toBe(10);
    expect(m.allowJoin('7.7.7.8')).toBe(true);
    // Local benchmarks and e2e open many clients from loopback outside production.
    expect(Array.from({ length: 40 }, () => m.allowJoin('127.0.0.1')).every(Boolean)).toBe(true);
    const prod = new MetaService({ env: { NODE_ENV: 'production', SESSION_SECRET: SECRET } });
    expect(Array.from({ length: 15 }, () => prod.allowJoin('127.0.0.1')).filter(Boolean)).toHaveLength(10);
  });
});

describe('meta HTTP in production', () => {
  let calls: { url: string; body: URLSearchParams }[];
  let answer: boolean;
  const fakeFetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    return { ok: true, json: async () => ({ success: answer }) };
  };
  let meta: MetaService;
  let base: string;
  let server: Server;
  beforeAll(async () => {
    meta = new MetaService({
      env: { NODE_ENV: 'production', SESSION_SECRET: SECRET, TURNSTILE_SECRET: 'ts-secret', ALLOWED_ORIGINS: 'https://qwakk.fun', TRUST_PROXY: '1' },
      fetch: fakeFetch,
    });
    ({ base, server } = await serve(meta));
  });
  afterAll(() => server.close());

  it('refuses to start without SESSION_SECRET', () => {
    expect(() => new MetaService({ env: { NODE_ENV: 'production' } })).toThrow(/SESSION_SECRET/);
    expect(() => new MetaService({ env: { SESSION_SECRET: 'short' } })).toThrow(/32/);
  });

  it('returns null for a missing token', () => {
    expect(meta.verifySession(undefined)).toBeNull();
    expect(meta.verifySession('')).toBeNull();
  });

  it('checks Turnstile for new guests only, with the proxied client IP', async () => {
    calls = [];
    answer = false;
    const denied = await post(base, { name: 'Gadwall', turnstileToken: 'tok' }, { 'x-forwarded-for': '6.6.6.6, 8.8.4.4' });
    expect(denied.status).toBe(403);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(calls[0]!.body)).toEqual({ secret: 'ts-secret', response: 'tok', remoteip: '8.8.4.4' });

    expect((await post(base, { name: 'Gadwall' })).status).toBe(403); // no token at all
    answer = true;
    const ok = await post(base, { name: 'Gadwall', turnstileToken: 'tok' });
    expect(ok.status).toBe(200);
    const s = (await ok.json()) as { deviceToken: string };
    calls = [];
    expect((await post(base, { name: 'Gadwall', deviceToken: s.deviceToken })).status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it('allows only ALLOWED_ORIGINS', async () => {
    const good = await fetch(`${base}/health`, { headers: { origin: 'https://qwakk.fun' } });
    expect(good.status).toBe(200);
    expect(good.headers.get('access-control-allow-origin')).toBe('https://qwakk.fun');
    const bad = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await fetch(`${base}/api/session`, { method: 'OPTIONS', headers: { origin: 'https://qwakk.fun' } });
    expect(pre.status).toBe(204);
  });
});

describe('origin policy for upgrades and matchmaking', () => {
  const env = process.env;
  const upgrade = (origin: string | null, host = 'game.qwakk.fun') =>
    checkUpgradeOrigin(new Request(`http://${host}/abc/def`, { headers: { host, ...(origin ? { origin } : {}) } }));
  const controller = () => ({ getCorsHeaders: (_h: Headers): Record<string, string> => ({ 'Access-Control-Allow-Origin': '*' }) });

  it('production without ALLOWED_ORIGINS: same origin only, with a warning', () => {
    process.env = { NODE_ENV: 'production', SESSION_SECRET: SECRET };
    try {
      const m = meta();
      expect(m.config.allowedOrigins).toBeNull();
      expect(upgrade('https://evil.example')?.status).toBe(403);
      expect(upgrade('https://game.qwakk.fun')).toBeUndefined();
      expect(upgrade(null)).toBeUndefined(); // bots and tools send no Origin
      const c = controller();
      const warn = console.warn;
      const warned: unknown[] = [];
      console.warn = (...a: unknown[]) => warned.push(a);
      applyMatchmakingCors(c);
      console.warn = warn;
      expect(String(warned[0])).toMatch(/ALLOWED_ORIGINS is not set/);
      expect(c.getCorsHeaders(new Headers({ origin: 'https://evil.example', host: 'game.qwakk.fun' }))['Access-Control-Allow-Origin']).toBe('https://game.qwakk.fun');
      expect(c.getCorsHeaders(new Headers({ origin: 'https://game.qwakk.fun', host: 'game.qwakk.fun' }))['Access-Control-Allow-Origin']).toBe('https://game.qwakk.fun');
    } finally {
      process.env = env;
    }
  });
});
