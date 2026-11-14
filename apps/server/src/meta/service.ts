/**
 * The meta layer in one object: guest sessions, join limits, match recording
 * and leaderboard reads. `index.ts` holds the process-wide instance; tests
 * build their own with a custom env and a fake fetch.
 */
import { randomBytes } from 'node:crypto';
import { AccountService } from './accounts/service.ts';
import type { ChainFetch } from './duckPass/chain.ts';
import { createMailer, type Mailer } from './accounts/mail.ts';
import { isRevoked } from './accounts/revoked.ts';
import postgres, { type Sql } from 'postgres';
import { loadConfig, type MetaConfig } from './config.ts';
import { ipKey, normalizeIp } from './ip.ts';
import { currentSeason, MODES, playerStanding, seasonById, SORTS, topPlayers, type ModeFilter, type Season, type SortKey, type Standing } from './leaderboard.ts';
import { insertMatch, normalizeMatch, type MatchResult } from './matches.ts';
import { insertRaid, normalizeRaid, withRetry, type RaidGrant, type RaidRunResult } from './raid.ts';
import { migrate, readMigrations, MIGRATIONS_DIR } from './migrate.ts';
import { checkName } from './names.ts';
import { offlineTag, upsertPlayer } from './players.ts';
import { CONNECTIONS_PER_IP, ConnectionCounter, LIMITS, RateLimiter } from './rateLimit.ts';
import { SCORE } from './score.ts';
import { isUuid, mintDeviceToken, signSession, verifyDeviceToken, verifySessionToken } from './token.ts';
import { verifyTurnstile, type FetchLike } from './turnstile.ts';
import { isBanned } from '../ops/bans.ts';
import { ProgressionService } from './progression/service.ts';
import { loadKit } from './progression/store.ts';
import type { DuckKit } from '@qwakk/shared/duck';
import { isIpBlocked } from '../ops/ipBlocks.ts';
import { publicStatus } from '../ops/notice.ts';

export interface Identity {
  playerId: string;
  name: string;
  tag: string;
  /**
   * Signed in: an account character (battle royale needs it). False for a
   * guest. Dev identities without a token (non-production only, for tools,
   * benchmarks and direct-start tests) count as signed in.
   */
  account: boolean;
  /** An account character's stored look (shared catalog id); the room seats it instead of the join option. */
  look?: number;
}

export interface ApiResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface MetaServiceOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  migrationsDir?: string;
  /** Retry a failed database start after this many ms (default 30 s). */
  retryMs?: number;
  /** Replace the mailer (tests); default from the SMTP settings (accounts/mail.ts). */
  mailer?: Mailer | null;
  /** Replace the QoreChain REST reads of Duck Pass (tests); default: Diana's public REST. */
  chainFetch?: ChainFetch;
}

export type DbState = 'off' | 'starting' | 'up' | 'down';

const CACHE_MS = 30_000;
const MAX_PENDING_MATCHES = 200;

const fail = (status: number, error: string, headers?: Record<string, string>): ApiResult => ({ status, body: { error }, ...(headers ? { headers } : {}) });

export class MetaService {
  readonly config: MetaConfig;
  readonly limits = {
    join: new RateLimiter(LIMITS.join),
    session: new RateLimiter(LIMITS.session),
    read: new RateLimiter(LIMITS.read),
    createRoom: new RateLimiter(LIMITS.createRoom),
    lobby: new RateLimiter(LIMITS.lobby),
    partyCreate: new RateLimiter(LIMITS.partyCreate),
    partyJoin: new RateLimiter(LIMITS.partyJoin),
  };
  /** Open WebSockets per address (game rooms plus the lobby). */
  readonly connections = new ConnectionCounter(CONNECTIONS_PER_IP);
  sql: Sql | null = null;
  dbState: DbState = 'off';
  private readonly fetchImpl: FetchLike | undefined;
  private readonly migrationsDir: string;
  private readonly retryMs: number;
  private retryTimer: NodeJS.Timeout | null = null;
  private startPromise: Promise<void> | null = null;
  private readonly pending: MatchResult[] = [];
  private readonly cache = new Map<string, { at: number; value: Promise<ApiResult> }>();
  /** Accounts: email sign-in, ducks, deletion (accounts/service.ts). */
  readonly accounts: AccountService;
  /** Hunt Season progression: gear, the skill tree, Tüy spends (progression/service.ts). */
  readonly progression: ProgressionService;

  constructor(opts: MetaServiceOptions = {}) {
    this.config = loadConfig(opts.env ?? process.env);
    this.fetchImpl = opts.fetch;
    this.migrationsDir = opts.migrationsDir ?? MIGRATIONS_DIR;
    this.retryMs = opts.retryMs ?? 30_000;
    this.accounts = new AccountService({
      config: this.config,
      db: () => this.db,
      mailer: opts.mailer !== undefined ? opts.mailer : createMailer(this.config),
      fetch: this.fetchImpl,
      ...(opts.chainFetch ? { chainFetch: opts.chainFetch } : {}),
      loopbackExempt: (ip) => this.loopbackExempt(ip),
    });
    this.progression = new ProgressionService({
      db: () => this.db,
      verify: (token) => (token ? this.verifySession(token) : null),
      loopbackExempt: (ip) => this.loopbackExempt(ip),
    });
  }

  // ---- lifecycle ----------------------------------------------------------

  /** Connect and migrate. Never throws: on failure the game runs on and the database is retried. */
  start(): Promise<void> {
    if (!this.config.databaseUrl) {
      console.log('[meta] DATABASE_URL not set: leaderboard off, matches are not recorded');
      return Promise.resolve();
    }
    this.startPromise ??= this.connect();
    return this.startPromise;
  }

  private async connect(): Promise<void> {
    this.dbState = 'starting';
    this.sql ??= postgres(this.config.databaseUrl!, { max: 4, idle_timeout: 30, connect_timeout: 5, onnotice: () => {} });
    try {
      const applied = await migrate(this.sql, await readMigrations(this.migrationsDir));
      this.dbState = 'up';
      console.log(`[meta] database ready${applied.length ? `, applied ${applied.join(', ')}` : ''}`);
      void this.flushPending();
    } catch (err) {
      this.dbState = 'down';
      console.error('[meta] database start failed, retrying in', this.retryMs / 1000, 's:', err instanceof Error ? err.message : err);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.startPromise = this.connect();
      }, this.retryMs);
      this.retryTimer.unref();
    }
  }

  async stop(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const sql = this.sql;
    this.sql = null;
    this.dbState = 'off';
    this.startPromise = null;
    if (sql) await sql.end({ timeout: 5 });
  }

  private get db(): Sql | null {
    return this.dbState === 'up' ? this.sql : null;
  }

  /**
   * An account duck's level (players.level, written only by recordRaid), for
   * the badge over it in the hub. Null without a database, for an unknown id
   * or on failure; never throws.
   */
  async playerLevel(playerId: string): Promise<number | null> {
    const db = this.db;
    if (!db || !isUuid(playerId)) return null;
    try {
      const rows = await db<{ level: number }[]>`select level from players where id = ${playerId}`;
      return rows[0]?.level ?? null;
    } catch (err) {
      console.error('[meta] playerLevel failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * An account duck's Hunt Season kit (level, gear, tree), read when it joins
   * a Hunt Season room. Null without a database, for a guest or an unknown id,
   * or on failure; never throws.
   */
  async duckKit(playerId: string): Promise<DuckKit | null> {
    const db = this.db;
    if (!db || !isUuid(playerId)) return null;
    try {
      return await loadKit(db, playerId);
    } catch (err) {
      console.error('[meta] duckKit failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  // ---- contract -----------------------------------------------------------

  /**
   * The identity behind a session token. Null when the token is missing in
   * production, or invalid or expired anywhere. In dev a missing token gets a
   * random guest so `npm run dev` works without the menu.
   */
  verifySession(token: string | undefined): Identity | null {
    if (token === undefined || token === '') {
      if (this.config.production) return null;
      const n = String(1000 + (randomBytes(2).readUInt16BE(0) % 9000));
      return { playerId: `dev-${randomBytes(6).toString('hex')}`, name: `Duck${n}`, tag: n, account: true };
    }
    const c = verifySessionToken(this.config.sessionSecret, token);
    if (!c) return null;
    // A banned player id (admin panel) has no valid session, even with an unexpired token;
    // nor has a deleted duck, or a guest whose duck moved into an account (accounts/revoked.ts).
    if (isBanned(c.playerId) || isRevoked(c.playerId, c.issuedAt, c.account)) return null;
    return { playerId: c.playerId, name: c.name, tag: c.tag, account: c.account, ...(c.look !== undefined ? { look: c.look } : {}) };
  }

  /**
   * Per-IP join limit (token bucket). Outside production, loopback is exempt so
   * the benchmark and e2e scripts can open dozens of local clients.
   */
  allowJoin(ip: string): boolean {
    return this.allow('join', ip);
  }

  /** Per-IP limit on new game rooms (create, or a Quick Play that has to open one). Loopback exempt outside production. */
  allowCreateRoom(ip: string): boolean {
    return this.allow('createRoom', ip);
  }

  /** Per-IP limit on lobby (room list) connections. Loopback exempt outside production. */
  allowLobby(ip: string): boolean {
    return this.allow('lobby', ip);
  }

  /** Per-IP limits on new parties and on party joins by code. Loopback exempt outside production. */
  allowPartyCreate(ip: string): boolean {
    return this.allow('partyCreate', ip);
  }

  allowPartyJoin(ip: string): boolean {
    return this.allow('partyJoin', ip);
  }

  /**
   * Per-IP cap on open WebSockets (every upgrade, before Colyseus sees it).
   * True: counted until the socket closes. False: refuse it. Loopback exempt
   * outside production, like the other limits.
   */
  admitSocket(ip: string, socket: { once(event: 'close', listener: () => void): unknown }): boolean {
    if (isIpBlocked(ip)) return false;
    if (this.loopbackExempt(ip)) return true;
    const key = ipKey(ip);
    if (!this.connections.tryOpen(key)) return false;
    socket.once('close', () => this.connections.close(key));
    return true;
  }

  private allow(kind: 'join' | 'createRoom' | 'lobby' | 'partyCreate' | 'partyJoin', ip: string): boolean {
    if (isIpBlocked(ip)) return false;
    if (this.loopbackExempt(ip)) return true;
    return this.limits[kind].take(ipKey(ip));
  }

  loopbackExempt(ip: string): boolean {
    return !this.config.production && /^(127\.|::1$)/.test(normalizeIp(ip));
  }

  /** Record a finished match. Never throws; waits a macrotask so the caller's tick is not held up. */
  async recordMatch(result: MatchResult): Promise<void> {
    if (!this.config.databaseUrl) return;
    await new Promise<void>((r) => setImmediate(r));
    try {
      if (!this.db) {
        if (this.pending.length >= MAX_PENDING_MATCHES) this.pending.shift();
        this.pending.push(result);
        return;
      }
      const m = normalizeMatch(result);
      if (!m) {
        console.warn('[meta] match result rejected by validation:', result?.matchId);
        return;
      }
      await insertMatch(this.db, m);
      this.cache.clear();
    } catch (err) {
      console.error('[meta] recordMatch failed:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Record a finished Hunt Season run and grant its XP (server only, at the
   * run end). Never throws. Null without a database, when the run was already
   * recorded, or on failure (the XP then is not stored; the room said so).
   */
  async recordRaid(result: RaidRunResult): Promise<Map<string, RaidGrant> | null> {
    if (!this.config.databaseUrl || !this.db) return null;
    await new Promise<void>((r) => setImmediate(r));
    try {
      const run = normalizeRaid(result);
      if (!run) {
        console.warn('[meta] raid result rejected by validation:', result?.runId);
        return null;
      }
      // A deadlock or serialization failure rolls the whole run back: try again, so a run's rewards are never lost to one.
      const db = this.db;
      return await withRetry(() => insertRaid(db, run));
    } catch (err) {
      console.error('[meta] recordRaid failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  private async flushPending(): Promise<void> {
    while (this.pending.length > 0 && this.db) {
      await this.recordMatch(this.pending.shift()!);
    }
  }

  // ---- HTTP API -----------------------------------------------------------

  /** POST /api/session { name, deviceToken?, turnstileToken? } */
  async createSession(body: unknown, ip: string): Promise<ApiResult> {
    const key = ipKey(ip);
    if (isIpBlocked(ip)) return fail(429, 'rate_limited', { 'Retry-After': '600' });
    if (!this.limits.session.take(key)) return fail(429, 'rate_limited', { 'Retry-After': String(this.limits.session.retryAfter(key)) });
    if (!body || typeof body !== 'object') return fail(400, 'bad_request');
    const b = body as Record<string, unknown>;
    const name = checkName(b.name);
    if (!name.ok) return fail(400, `name_${name.reason}`);

    const secret = this.config.sessionSecret;
    let playerId = verifyDeviceToken(secret, b.deviceToken);
    // A banned player (admin panel) gets no new session for this device token.
    if (playerId && isBanned(playerId)) return fail(403, 'banned');
    let deviceToken = typeof b.deviceToken === 'string' ? b.deviceToken : '';
    if (!playerId) {
      // A new guest. Turnstile guards this step only.
      if (this.config.turnstileSecret) {
        const human = await verifyTurnstile(this.config.turnstileSecret, b.turnstileToken, ip, this.fetchImpl);
        if (!human) return fail(403, 'turnstile_failed');
      }
      const minted = mintDeviceToken(secret);
      playerId = minted.playerId;
      deviceToken = minted.token;
    }

    let tag: string;
    const db = this.db;
    if (db) {
      try {
        const r = await upsertPlayer(db, playerId, name.name);
        if (!r.ok) return fail(409, r.reason);
        tag = r.tag;
      } catch (err) {
        console.error('[meta] player upsert failed:', err instanceof Error ? err.message : err);
        tag = offlineTag(secret, playerId, name.name);
      }
    } else {
      tag = offlineTag(secret, playerId, name.name);
    }
    const s = signSession(secret, { playerId, name: name.name, tag });
    return { status: 200, body: { token: s.token, expiresAt: s.expiresAt, deviceToken, playerId, name: name.name, tag } };
  }

  /** GET /api/leaderboard?season=&sort=&mode= (top 100, cached 30 s) */
  async leaderboard(params: URLSearchParams, ip: string): Promise<ApiResult> {
    const key = ipKey(ip);
    if (!this.limits.read.take(key)) return fail(429, 'rate_limited', { 'Retry-After': String(this.limits.read.retryAfter(key)) });
    const q = parseQuery(params);
    if (!q) return fail(400, 'bad_request');
    if (!this.db) return fail(503, 'unavailable');
    const cacheKey = `${q.season ?? 'current'}|${q.mode}|${q.sort}`;
    const now = Date.now();
    const hit = this.cache.get(cacheKey);
    if (hit && now - hit.at < CACHE_MS) return hit.value;
    if (this.cache.size > 200) this.cache.clear();
    const value = this.loadLeaderboard(q.season, q.mode, q.sort);
    this.cache.set(cacheKey, { at: now, value });
    value.then((r) => r.status !== 200 && this.cache.delete(cacheKey), () => this.cache.delete(cacheKey));
    return value;
  }

  private async loadLeaderboard(seasonId: number | null, mode: ModeFilter, sort: SortKey): Promise<ApiResult> {
    const db = this.db;
    if (!db) return fail(503, 'unavailable');
    try {
      const season = seasonId === null ? await currentSeason(db) : await seasonById(db, seasonId);
      if (!season) return fail(404, 'no_season');
      const { total, rows } = await topPlayers(db, season.id, mode, sort);
      return {
        status: 200,
        body: { season, mode, sort, total, updatedAt: new Date().toISOString(), scoring: SCORE, rows },
        headers: { 'Cache-Control': `public, max-age=${CACHE_MS / 1000}` },
      };
    } catch (err) {
      console.error('[meta] leaderboard failed:', err instanceof Error ? err.message : err);
      return fail(503, 'unavailable');
    }
  }

  /** GET /api/me?season=&mode= with `Authorization: Bearer <session>` */
  async me(authorization: string | undefined, params: URLSearchParams, ip: string): Promise<ApiResult> {
    const key = ipKey(ip);
    if (!this.limits.read.take(key)) return fail(429, 'rate_limited', { 'Retry-After': String(this.limits.read.retryAfter(key)) });
    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
    const claims = token ? verifySessionToken(this.config.sessionSecret, token) : null;
    if (!claims) return fail(401, 'unauthorized');
    const q = parseQuery(params);
    if (!q) return fail(400, 'bad_request');
    const player = { playerId: claims.playerId, name: claims.name, tag: claims.tag };
    const db = this.db;
    if (!db) return { status: 200, body: { player, season: null, mode: q.mode, total: 0, standing: null, leaderboard: false } };
    try {
      const season: Season | null = q.season === null ? await currentSeason(db) : await seasonById(db, q.season);
      if (!season) return fail(404, 'no_season');
      const { total, standing } = await playerStanding(db, season.id, q.mode, claims.playerId);
      return { status: 200, body: { player, season, mode: q.mode, total, standing: standing satisfies Standing | null, leaderboard: true } };
    } catch (err) {
      console.error('[meta] me failed:', err instanceof Error ? err.message : err);
      return fail(503, 'unavailable');
    }
  }

  /** GET /api/status: the menu banner, maintenance and the live rules (public, in memory). */
  status(ip: string): ApiResult {
    const key = ipKey(ip);
    if (!this.limits.read.take(key)) return fail(429, 'rate_limited', { 'Retry-After': String(this.limits.read.retryAfter(key)) });
    return { status: 200, body: publicStatus() };
  }

  /** Forget cached leaderboard pages (after the admin hides or shows a player). */
  clearCache(): void {
    this.cache.clear();
  }

  // ---- CORS ---------------------------------------------------------------

  /**
   * ALLOWED_ORIGINS when set; otherwise same origin only in production and
   * anything in dev. A request without an Origin header (same-origin GET,
   * curl, the game server's own tools) is not a browser cross-site call.
   */
  originAllowed(origin: string | undefined, host: string | undefined): boolean {
    if (!origin) return true;
    if (this.config.allowedOrigins) return this.config.allowedOrigins.includes(origin);
    if (!this.config.production) return true;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
}

function parseQuery(params: URLSearchParams): { season: number | null; mode: ModeFilter; sort: SortKey } | null {
  const s = params.get('season');
  const season = s === null || s === '' || s === 'current' ? null : /^\d{1,4}$/.test(s) ? Number(s) : NaN;
  if (Number.isNaN(season)) return null;
  const sort = (params.get('sort') || 'score') as SortKey;
  const mode = (params.get('mode') || 'all') as ModeFilter;
  if (!SORTS.includes(sort) || !MODES.includes(mode)) return null;
  return { season, mode, sort };
}
