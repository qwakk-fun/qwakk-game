import { describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAuthContext } from '@colyseus/core';
import { clientIp, guardClientIp, installClientIpGuard, ipKey, normalizeIp } from '../../src/meta/ip.ts';
import { CONNECTIONS_PER_IP, ConnectionCounter, LIMITS, RateLimiter } from '../../src/meta/rateLimit.ts';
import { MetaService } from '../../src/meta/service.ts';
import { EventEmitter } from 'node:events';

describe('token bucket', () => {
  it('allows a burst, then refills at the set rate', () => {
    const rl = new RateLimiter({ capacity: 3, refillPerSec: 1 });
    const t = 1_000_000;
    expect([rl.take('a', t), rl.take('a', t), rl.take('a', t), rl.take('a', t)]).toEqual([true, true, true, false]);
    expect(rl.retryAfter('a', t)).toBe(1);
    expect(rl.take('a', t + 500)).toBe(false);
    expect(rl.take('a', t + 1000)).toBe(true);
    expect(rl.take('b', t)).toBe(true);
  });

  it('never banks more than the capacity', () => {
    const rl = new RateLimiter({ capacity: 2, refillPerSec: 1 });
    rl.take('a', 0);
    const t = 3_600_000;
    expect([rl.take('a', t), rl.take('a', t), rl.take('a', t)]).toEqual([true, true, false]);
  });

  it('sweeps full buckets and bounds memory', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSec: 1, maxKeys: 10 });
    for (let i = 0; i < 10; i++) rl.take(`k${i}`, 0);
    expect(rl.size).toBe(10);
    rl.take('k10', 1); // table full: cleared, fails open
    expect(rl.size).toBe(1);
    rl.take('late', 120_000); // sweep drops refilled buckets
    expect(rl.size).toBe(1);
  });

  it('room creation limit: 3 quick rooms, then one a minute', () => {
    const rl = new RateLimiter(LIMITS.createRoom);
    const ok = Array.from({ length: 5 }, () => rl.take('ip', 0)).filter(Boolean).length;
    expect(ok).toBe(3);
    expect(rl.take('ip', 59_000)).toBe(false);
    expect(rl.take('ip', 60_000)).toBe(true);
  });

  it('join limit: 10 quick joins, then one per 4 s', () => {
    const rl = new RateLimiter(LIMITS.join);
    const ok = Array.from({ length: 12 }, () => rl.take('ip', 0)).filter(Boolean).length;
    expect(ok).toBe(10);
    expect(rl.take('ip', 3900)).toBe(false);
    expect(rl.take('ip', 4000)).toBe(true);
  });
});

describe('open connections per IP', () => {
  it('caps what is open at once and gives slots back on close', () => {
    const c = new ConnectionCounter(2);
    expect([c.tryOpen('a'), c.tryOpen('a'), c.tryOpen('a'), c.tryOpen('b')]).toEqual([true, true, false, true]);
    c.close('a');
    expect(c.tryOpen('a')).toBe(true);
    c.close('a');
    c.close('a');
    c.close('b');
    expect(c.size).toBe(0);
    c.close('ghost'); // never below zero, never a stray key
    expect(c.size).toBe(0);
  });

  it('MetaService counts each socket until it closes, per /64, loopback exempt only outside production', () => {
    const prod = new MetaService({ env: { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) } });
    const sockets = Array.from({ length: CONNECTIONS_PER_IP + 1 }, () => new EventEmitter());
    const admitted = sockets.map((s, i) => prod.admitSocket(`2001:db8:1:2::${i + 1}`, s));
    expect(admitted.filter(Boolean).length).toBe(CONNECTIONS_PER_IP);
    expect(admitted.at(-1)).toBe(false);
    expect(prod.admitSocket('203.0.113.9', new EventEmitter())).toBe(true); // another address is not affected
    sockets[0]!.emit('close');
    expect(prod.admitSocket('2001:db8:1:2::99', new EventEmitter())).toBe(true);
    // Production limits loopback too (only the dev server exempts it for the benchmarks).
    const local = Array.from({ length: CONNECTIONS_PER_IP + 1 }, () => prod.admitSocket('127.0.0.1', new EventEmitter()));
    expect(local.at(-1)).toBe(false);
    const dev = new MetaService({ env: {} });
    expect(Array.from({ length: CONNECTIONS_PER_IP + 5 }, () => dev.admitSocket('127.0.0.1', new EventEmitter())).every(Boolean)).toBe(true);
  });
});

describe('client ip', () => {
  it('ignores X-Forwarded-For unless TRUST_PROXY is set', () => {
    expect(clientIp('10.0.0.5', '6.6.6.6', 0)).toBe('10.0.0.5');
    expect(clientIp('10.0.0.5', '6.6.6.6, 1.2.3.4', 1)).toBe('1.2.3.4');
    expect(clientIp('10.0.0.5', '6.6.6.6, 1.2.3.4, 10.0.0.9', 2)).toBe('1.2.3.4');
    expect(clientIp('10.0.0.5', undefined, 1)).toBe('10.0.0.5');
  });

  it('normalizes mapped IPv4 and groups IPv6 by /64', () => {
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(ipKey('1.2.3.4')).toBe('1.2.3.4');
    expect(ipKey('2001:db8:aa:bb:1:2:3:4')).toBe('2001:db8:aa:bb::/64');
    expect(ipKey('2001:db8:aa:bb::99')).toBe('2001:db8:aa:bb::/64');
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });
});

describe('join IP guard (what Colyseus puts in context.ip)', () => {
  /** Send an upgrade request with spoofed headers; return the context.ip Colyseus would build. */
  async function upgradeIp(hops: number, headers: Record<string, string>): Promise<string | undefined> {
    const server = createServer();
    installClientIpGuard(server, hops);
    const seen = new Promise<string | undefined>((resolve) => {
      // Registered after the guard, like the WebSocket transport's own listener.
      server.on('upgrade', (req: IncomingMessage, socket) => {
        resolve(createAuthContext({ headers: req.headers as Record<string, string>, remoteAddress: req.socket.remoteAddress }).ip);
        socket.destroy();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const req = httpRequest({ port: (server.address() as AddressInfo).port, host: '127.0.0.1', headers: { Connection: 'Upgrade', Upgrade: 'websocket', ...headers } });
    req.on('error', () => {});
    req.end();
    const ip = await seen;
    server.close();
    return ip;
  }

  it('without TRUST_PROXY, spoofed X-Real-IP, X-Forwarded-For and X-Client-IP are ignored', async () => {
    const spoof = { 'X-Real-IP': '9.9.9.9', 'X-Forwarded-For': '8.8.8.8', 'X-Client-IP': '7.7.7.7' };
    expect(await upgradeIp(0, spoof)).toBe('127.0.0.1');
    expect(await upgradeIp(0, { 'X-Real-IP': '1.2.3.4' })).toBe('127.0.0.1');
  });

  it('with TRUST_PROXY=1, the entry the proxy appended (rightmost) wins over spoofed ones', async () => {
    expect(await upgradeIp(1, { 'X-Real-IP': '9.9.9.9', 'X-Forwarded-For': '6.6.6.6, 203.0.113.7' })).toBe('203.0.113.7');
    // No proxy header at all: the socket address.
    expect(await upgradeIp(1, { 'X-Real-IP': '9.9.9.9' })).toBe('127.0.0.1');
  });

  it('matchmaking requests (room creation) get the same treatment, even for listeners prepended later', async () => {
    const server = createServer();
    installClientIpGuard(server, 0);
    const seen = new Promise<string | undefined>((resolve) => {
      // Colyseus prepends its matchmaking listener at listen time, after the guard.
      server.prependListener('request', (req: IncomingMessage, res) => {
        resolve(createAuthContext({ headers: req.headers as Record<string, string> }).ip);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const req = httpRequest({ port: (server.address() as AddressInfo).port, host: '127.0.0.1', method: 'POST', path: '/matchmake/create/br', headers: { 'X-Real-IP': '9.9.9.9', 'X-Forwarded-For': '8.8.8.8' } });
    req.on('error', () => {});
    req.end();
    expect(await seen).toBe('127.0.0.1');
    server.close();
  });

  it('refuses upgrades over the connection cap with 429 before any other listener', async () => {
    const server = createServer();
    let open = 0;
    installClientIpGuard(server, 1, (ip) => ip !== '198.51.100.1' || open++ < 1);
    const reached: string[] = [];
    server.on('upgrade', (req: IncomingMessage, socket) => {
      reached.push(String(req.headers['x-real-ip']));
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: close\r\n\r\n');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const status = (xff: string) =>
      new Promise<number>((resolve) => {
        const req = httpRequest({ port, host: '127.0.0.1', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'X-Forwarded-For': xff } });
        req.on('upgrade', (res, socket) => {
          socket.destroy();
          resolve(res.statusCode ?? 0);
        });
        req.on('response', (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', () => resolve(-1));
        req.end();
      });
    expect(await status('198.51.100.1')).toBe(101);
    expect(await status('198.51.100.1')).toBe(429);
    expect(await status('198.51.100.2')).toBe(101);
    expect(reached).toEqual(['198.51.100.1', '198.51.100.2']);
    server.close();
  });

  it('rewrites the headers in place', () => {
    const req = { socket: { remoteAddress: '::ffff:10.0.0.2' }, headers: { 'x-real-ip': '1.1.1.1', 'x-client-ip': '2.2.2.2' } } as unknown as IncomingMessage;
    expect(guardClientIp(req, 0)).toBe('10.0.0.2');
    expect(req.headers).toEqual({ 'x-real-ip': '10.0.0.2' });
  });
});
