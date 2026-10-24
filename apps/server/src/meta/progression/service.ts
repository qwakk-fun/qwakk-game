/**
 * The `/api/duck` routes' rules (Hunt Season progression): read a duck's
 * progression, buy gear, wear it, spend a tree point, reset the tree.
 *
 *   - Identity: the game session token (Bearer, `verifySession`): the duck is
 *     the token's player id and must be an account duck. Never an id, a
 *     level, a price or a balance from the body: the body names only what to
 *     buy, wear or raise (and an optional idempotency key).
 *   - Every write is one transaction with the duck's progress row locked
 *     (store.ts), so concurrent requests cannot spend the same Tüy twice; a
 *     purchase or respec carrying an idempotency key that was already used
 *     answers the stored state again (`replay`).
 *   - Limits in memory: per duck (a burst of 12, then 2 a second) and per IP
 *     (a burst of 60, then 4 a second; loopback exempt outside production).
 *   - Nothing here grants Tüy, XP or levels: the game server does that at a
 *     run's end (meta/raid.ts), and no route may be added for it.
 */
import type { Sql } from 'postgres';
import type { DuckApiError } from '@qwakk/shared/duck';
import { ipKey } from '../ip.ts';
import { RateLimiter } from '../rateLimit.ts';
import { isUuid } from '../token.ts';
import * as store from './store.ts';

export interface ApiResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface ProgressionDeps {
  db(): Sql | null;
  /** The identity behind a game session token (MetaService.verifySession). */
  verify(token: string | undefined): { playerId: string; account: boolean } | null;
  loopbackExempt(ip: string): boolean;
}

export const PROGRESSION_LIMITS = {
  duck: { capacity: 12, refillPerSec: 2 },
  ip: { capacity: 60, refillPerSec: 4 },
} as const;

const STATUS: Partial<Record<DuckApiError, number>> = {
  needs_account: 403,
  unauthorized: 401,
  rate_limited: 429,
  unavailable: 503,
  bad_request: 400,
  unknown_item: 404,
  unknown: 404,
};

const fail = (error: DuckApiError, headers?: Record<string, string>): ApiResult => ({ status: STATUS[error] ?? 409, body: { error }, ...(headers ? { headers } : {}) });

const IDEM = /^[A-Za-z0-9_-]{8,64}$/;

export class ProgressionService {
  private readonly deps: ProgressionDeps;
  readonly limits = { duck: new RateLimiter(PROGRESSION_LIMITS.duck), ip: new RateLimiter(PROGRESSION_LIMITS.ip) };

  constructor(deps: ProgressionDeps) {
    this.deps = deps;
  }

  /** The duck behind the request, or the refusal. */
  private who(authorization: string | undefined, ip: string): { playerId: string; db: Sql } | ApiResult {
    if (!this.deps.loopbackExempt(ip) && !this.limits.ip.take(ipKey(ip))) return fail('rate_limited', { 'Retry-After': String(this.limits.ip.retryAfter(ipKey(ip))) });
    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
    // A token is required (no dev identity here, even outside production).
    const id = token ? this.deps.verify(token) : null;
    if (!id) return fail('unauthorized');
    if (!id.account || !isUuid(id.playerId)) return fail('needs_account');
    if (!this.limits.duck.take(id.playerId)) return fail('rate_limited', { 'Retry-After': String(this.limits.duck.retryAfter(id.playerId)) });
    const db = this.deps.db();
    if (!db) return fail('unavailable');
    return { playerId: id.playerId, db };
  }

  private async run(authorization: string | undefined, ip: string, f: (db: Sql, playerId: string) => Promise<store.Result | ApiResult>): Promise<ApiResult> {
    const w = this.who(authorization, ip);
    if ('status' in w) return w;
    try {
      const r = await f(w.db, w.playerId);
      if ('status' in r) return r;
      if (!r.ok) return fail(r.error);
      return { status: 200, body: { duck: r.view, ...(r.replay ? { replay: true } : {}) } };
    } catch (err) {
      console.error('[meta] duck progression failed:', err instanceof Error ? err.message : err);
      return fail('unavailable');
    }
  }

  /** GET /api/duck */
  view(authorization: string | undefined, ip: string): Promise<ApiResult> {
    return this.run(authorization, ip, async (db, id) => {
      const view = await store.loadView(db, id);
      return view ? { ok: true, view } : { ok: false, error: 'needs_account' };
    });
  }

  /** POST /api/duck/buy { item, key? } */
  buy(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.run(authorization, ip, async (db, id) => {
      const b = fields(body);
      if (!b || typeof b.item !== 'string' || b.item.length > 32) return fail('bad_request');
      const key = idem(b.key);
      if (key === undefined) return fail('bad_request');
      return store.buy(db, id, b.item, key);
    });
  }

  /** POST /api/duck/equip { item } */
  equip(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.run(authorization, ip, async (db, id) => {
      const b = fields(body);
      if (!b || typeof b.item !== 'string' || b.item.length > 32) return fail('bad_request');
      return store.equip(db, id, b.item);
    });
  }

  /** POST /api/duck/tree { node } */
  spend(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.run(authorization, ip, async (db, id) => {
      const b = fields(body);
      if (!b || typeof b.node !== 'string' || b.node.length > 32) return fail('bad_request');
      return store.spend(db, id, b.node);
    });
  }

  /** POST /api/duck/respec { key? } */
  respec(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.run(authorization, ip, async (db, id) => {
      const b = fields(body) ?? {};
      const key = idem(b.key);
      if (key === undefined) return fail('bad_request');
      return store.respec(db, id, key);
    });
  }
}

function fields(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** An optional idempotency key: null when absent, undefined when malformed. */
function idem(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' && IDEM.test(v) ? v : undefined;
}

/** The progression routes (mounted by the meta handler, ../http.ts). */
export const DUCK_PATHS = ['/api/duck', '/api/duck/buy', '/api/duck/equip', '/api/duck/tree', '/api/duck/respec'];

export async function duckRoute(svc: ProgressionService, route: string, authorization: string | undefined, ip: string, body: () => Promise<unknown>): Promise<ApiResult | null> {
  switch (route) {
    case 'GET /api/duck':
      return svc.view(authorization, ip);
    case 'POST /api/duck/buy':
      return svc.buy(authorization, await body(), ip);
    case 'POST /api/duck/equip':
      return svc.equip(authorization, await body(), ip);
    case 'POST /api/duck/tree':
      return svc.spend(authorization, await body(), ip);
    case 'POST /api/duck/respec':
      return svc.respec(authorization, await body(), ip);
    default:
      return null;
  }
}
