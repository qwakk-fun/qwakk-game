/**
 * Per-key token buckets in memory (one process, nothing persisted).
 *
 * Each key holds up to `capacity` tokens and regains `refillPerSec`; a request
 * takes one or is refused. Full buckets are dropped by a lazy sweep, so memory
 * only holds IPs that were active recently. If the table still grows past
 * `maxKeys` (an address-spraying flood), it is cleared: limits fail open
 * rather than letting memory grow without bound.
 */
export interface BucketOptions {
  capacity: number;
  refillPerSec: number;
  maxKeys?: number;
}

interface Bucket {
  tokens: number;
  at: number;
}

const SWEEP_EVERY_MS = 60_000;

export class RateLimiter {
  readonly capacity: number;
  readonly refillPerSec: number;
  private readonly maxKeys: number;
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(opts: BucketOptions) {
    this.capacity = opts.capacity;
    this.refillPerSec = opts.refillPerSec;
    this.maxKeys = opts.maxKeys ?? 100_000;
  }

  /** Take one token for `key`. False means: over the limit, refuse. */
  take(key: string, now = Date.now()): boolean {
    if (now - this.lastSweep > SWEEP_EVERY_MS) this.sweep(now);
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.buckets.clear();
      b = { tokens: this.capacity, at: now };
      this.buckets.set(key, b);
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSec);
      b.at = now;
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Seconds until `key` has a token again (for Retry-After). */
  retryAfter(key: string, now = Date.now()): number {
    const b = this.buckets.get(key);
    if (!b) return 0;
    const tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSec);
    return tokens >= 1 ? 0 : Math.ceil((1 - tokens) / this.refillPerSec);
  }

  get size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    this.lastSweep = now;
    for (const [key, b] of this.buckets) {
      if (b.tokens + ((now - b.at) / 1000) * this.refillPerSec >= this.capacity) this.buckets.delete(key);
    }
  }
}

/**
 * Open connections per key (one process, nothing persisted): a cap on what is
 * open at once, not a rate. `open` counts one more or refuses; `close` gives
 * it back. A key is dropped when its count reaches 0, so memory only holds
 * addresses with a socket open right now.
 */
export class ConnectionCounter {
  readonly max: number;
  private readonly open = new Map<string, number>();

  constructor(max: number) {
    this.max = max;
  }

  /** Count one more open connection for `key`. False means: at the cap, refuse. */
  tryOpen(key: string): boolean {
    const n = this.open.get(key) ?? 0;
    if (n >= this.max) return false;
    this.open.set(key, n + 1);
    return true;
  }

  close(key: string): void {
    const n = (this.open.get(key) ?? 0) - 1;
    if (n > 0) this.open.set(key, n);
    else this.open.delete(key);
  }

  count(key: string): number {
    return this.open.get(key) ?? 0;
  }

  get size(): number {
    return this.open.size;
  }
}

/**
 * The limits in use. Joins: a burst of 10, then one every 4 s (a household
 * behind one address can still play). Sessions: a burst of 8, then one every
 * 20 s. Leaderboard and profile reads: a burst of 40, then 2 per second.
 * New game rooms: a burst of 3, then one a minute. Lobby (room list)
 * connections: a burst of 20, then one every 3 s (the menu reconnects after
 * every match). New parties: a burst of 4, then one every 30 s. Party joins
 * by code (right or wrong): a burst of 8, then one every 5 s, so guessing a
 * code (about 887 million) is hopeless. Open WebSockets (game rooms plus the lobby, see
 * `CONNECTIONS_PER_IP`) are capped separately.
 */
export const LIMITS = {
  join: { capacity: 10, refillPerSec: 1 / 4 },
  createRoom: { capacity: 3, refillPerSec: 1 / 60 },
  lobby: { capacity: 20, refillPerSec: 1 / 3 },
  partyCreate: { capacity: 4, refillPerSec: 1 / 30 },
  partyJoin: { capacity: 8, refillPerSec: 1 / 5 },
  session: { capacity: 8, refillPerSec: 1 / 20 },
  read: { capacity: 40, refillPerSec: 2 },
} as const satisfies Record<string, BucketOptions>;

/**
 * Most WebSockets one address (IPv6: one /64) may hold open at once: game
 * rooms and the lobby together. A browser tab holds one or two (the menu's
 * room list, then the room), and a dropped socket can linger a few seconds
 * until the server's ping notices, so 16 leaves room for a household or a
 * small LAN party behind one address while one script cannot fill the 96
 * deathmatch seats.
 */
export const CONNECTIONS_PER_IP = 16;
