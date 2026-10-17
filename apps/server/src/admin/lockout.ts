/**
 * Login lockout, in memory (one server instance; addresses are never stored).
 *
 *   Per address: 5 failed logins within 15 minutes lock it for 15 minutes;
 *   each lock after that in the same day doubles, up to 24 hours.
 *   Global: more than 20 failed logins from all addresses within 10 minutes
 *   lock every login for 1 minute, doubling while failures go on, up to 30
 *   minutes (an attack spread over many addresses). The owner waits it out.
 *
 * A successful login clears its address's failures.
 */
import { ipKey } from '../meta/ip.ts';

export const LOCKOUT = {
  ipFailures: 5,
  ipWindowMs: 15 * 60_000,
  ipLockMs: 15 * 60_000,
  ipLockMaxMs: 24 * 3600_000,
  globalFailures: 20,
  globalWindowMs: 10 * 60_000,
  globalLockMs: 60_000,
  globalLockMaxMs: 30 * 60_000,
  maxKeys: 10_000,
} as const;

interface IpState {
  failures: number[];
  lockedUntil: number;
  locks: number;
  lastLockAt: number;
}

export class LoginLockout {
  private readonly ips = new Map<string, IpState>();
  private global: number[] = [];
  private globalUntil = 0;
  private globalLocks = 0;

  /** Ms until this address may try again (0: now). Covers the global lock too. */
  retryAfterMs(ip: string, now = Date.now()): number {
    const s = this.ips.get(ipKey(ip));
    return Math.max(0, (s?.lockedUntil ?? 0) - now, this.globalUntil - now);
  }

  failure(ip: string, now = Date.now()): void {
    const key = ipKey(ip);
    let s = this.ips.get(key);
    if (!s) {
      if (this.ips.size >= LOCKOUT.maxKeys) this.prune(now);
      s = { failures: [], lockedUntil: 0, locks: 0, lastLockAt: 0 };
      this.ips.set(key, s);
    }
    s.failures = s.failures.filter((t) => now - t < LOCKOUT.ipWindowMs);
    s.failures.push(now);
    if (s.failures.length >= LOCKOUT.ipFailures) {
      if (now - s.lastLockAt > 24 * 3600_000) s.locks = 0;
      s.lockedUntil = now + Math.min(LOCKOUT.ipLockMaxMs, LOCKOUT.ipLockMs * 2 ** s.locks);
      s.locks++;
      s.lastLockAt = now;
      s.failures = [];
    }
    this.global = this.global.filter((t) => now - t < LOCKOUT.globalWindowMs);
    this.global.push(now);
    if (this.global.length > LOCKOUT.globalFailures) {
      if (this.globalUntil < now - LOCKOUT.globalWindowMs) this.globalLocks = 0;
      this.globalUntil = now + Math.min(LOCKOUT.globalLockMaxMs, LOCKOUT.globalLockMs * 2 ** this.globalLocks);
      this.globalLocks++;
      this.global = [];
    }
  }

  success(ip: string): void {
    const s = this.ips.get(ipKey(ip));
    if (s) s.failures = [];
  }

  private prune(now: number): void {
    for (const [k, s] of this.ips) if (s.lockedUntil < now && s.failures.every((t) => now - t >= LOCKOUT.ipWindowMs)) this.ips.delete(k);
    if (this.ips.size >= LOCKOUT.maxKeys) this.ips.clear();
  }
}
