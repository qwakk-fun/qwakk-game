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
 * The limits in use. Joins: a burst of 10, then one every 4 s (a household
 * behind one address can still play). Sessions: a burst of 8, then one every
 * 20 s. Leaderboard and profile reads: a burst of 40, then 2 per second.
 */
export const LIMITS = {
  join: { capacity: 10, refillPerSec: 1 / 4 },
  session: { capacity: 8, refillPerSec: 1 / 20 },
  read: { capacity: 40, refillPerSec: 2 },
} as const satisfies Record<string, BucketOptions>;
