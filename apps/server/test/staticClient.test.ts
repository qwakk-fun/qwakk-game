import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClientHandler } from '../src/staticClient.ts';

let root: string;
let server: Server;
let base: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'qwakk-static-'));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  mkdirSync(join(dist, 'models'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>q</title>');
  writeFileSync(join(dist, 'assets', 'main-abc123.js'), 'console.log(1)');
  writeFileSync(join(dist, 'assets', 'main-abc123.js.gz'), 'gz');
  writeFileSync(join(dist, 'assets', 'main-abc123.js.br'), 'br');
  writeFileSync(join(dist, 'assets', 'main-abc123.js.map'), '{}');
  writeFileSync(join(dist, 'models', 'duck.glb'), 'glb');
  writeFileSync(join(dist, '.env'), 'SECRET=1');
  writeFileSync(join(root, 'secret.ts'), 'export const x = 1');
  symlinkSync(join(root, 'secret.ts'), join(dist, 'link.ts'));
  const handler = createClientHandler(dist);
  server = createServer((req, res) => handler(req, res, () => {
    res.statusCode = 418;
    res.end('next');
  }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers, redirect: 'manual' });

describe('client file handler', () => {
  it('serves index.html at / with no-cache, and hashed assets as immutable', async () => {
    const page = await get('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const js = await get('/assets/main-abc123.js', { 'Accept-Encoding': 'identity' });
    expect(await js.text()).toBe('console.log(1)');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    const glb = await get('/models/duck.glb');
    expect(glb.headers.get('content-type')).toBe('model/gltf-binary');
    expect(glb.headers.get('cache-control')).toBe('no-cache');
  });

  it('sends precompressed copies and answers revalidation with 304', async () => {
    const r = await fetch(`${base}/assets/main-abc123.js`, { headers: { 'Accept-Encoding': 'br' } });
    expect(r.headers.get('content-encoding')).toBe('br');
    const etag = r.headers.get('etag')!;
    expect((await get('/assets/main-abc123.js', { 'If-None-Match': etag })).status).toBe(304);
  });

  it('never serves anything outside the client files', async () => {
    for (const p of ['/.env', '/link.ts', '/assets/main-abc123.js.map', '/../secret.ts', '/%2e%2e/secret.ts', '/assets/..%2f..%2fsecret.ts', '/package.json', '/apps/server/src/index.ts', '/.git/config', '/node_modules/postgres/package.json']) {
      const r = await get(p, { Accept: 'text/html' });
      expect([p, r.status]).toEqual([p, 404]);
    }
  });

  it('no catch-all: unknown paths are 404; /game links redirect to the root; reserved routes and other methods fall through', async () => {
    expect((await get('/some/route', { Accept: 'text/html' })).status).toBe(404);
    expect((await get('/etc/passwd', { Accept: 'text/html' })).status).toBe(404);
    const old = await get('/game/?mode=dm');
    expect([old.status, old.headers.get('location')]).toEqual([301, '/?mode=dm']);
    expect((await get('/game')).headers.get('location')).toBe('/');
    expect((await get('/game//evil.example')).headers.get('location')).toBe('/evil.example');
    expect((await get('/game/%5Cevil.example')).headers.get('location')).toBe('/evil.example');
    expect((await get('/game/models/duck.glb')).headers.get('location')).toBe('/models/duck.glb');
    // Browsers drop tabs and newlines from a Location, so these must never become `//evil.example`.
    for (const bad of ['/game/%09/evil.example', '/game/%09%5Cevil.example', '/game/%2F%09/evil.example', '/game/%0a/evil.example', '/game/%E2%80%94x']) {
      const res = await get(bad);
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe('/');
    }
    for (const p of ['/api/leaderboard', '/health', '/matchmake/joinById/istanbul', '/__healthcheck']) {
      expect([p, (await get(p, { Accept: 'text/html' })).status]).toEqual([p, 418]);
    }
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(418);
  });
});
