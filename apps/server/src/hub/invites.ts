/**
 * Team invites in the hub, as the server keeps them: who invited whom and
 * when, per-sender rate limits (a token bucket) and expiry. Pure (no room,
 * no network, times passed in), keyed by session id; the room turns pids from
 * client messages into session ids of seated ducks before it asks anything,
 * and nothing here ever goes to a client.
 */
import { HUB } from '@qwakk/shared/hub';

/** A token bucket: `burst` actions at once, one more every `refillMs`. */
export class Bucket {
  private tokens: number;
  private at: number;
  private readonly burst: number;
  private readonly refillMs: number;

  constructor(burst: number, refillMs: number, now: number) {
    this.burst = burst;
    this.refillMs = refillMs;
    this.tokens = burst;
    this.at = now;
  }

  take(now: number): boolean {
    const gained = Math.max(0, now - this.at) / this.refillMs;
    this.tokens = Math.min(this.burst, this.tokens + gained);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Rate limits per id (session), dropped when the duck leaves. */
export class Limiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly burst: number;
  private readonly refillMs: number;

  constructor(burst: number, refillMs: number) {
    this.burst = burst;
    this.refillMs = refillMs;
  }

  allow(id: string, now: number): boolean {
    let b = this.buckets.get(id);
    if (!b) this.buckets.set(id, (b = new Bucket(this.burst, this.refillMs, now)));
    return b.take(now);
  }

  forget(id: string): void {
    this.buckets.delete(id);
  }
}

export interface Invite {
  from: string;
  to: string;
  at: number;
}

export type InviteCheck = 'ok' | 'limited' | 'self' | 'busy' | 'again';

export class InviteBook {
  /** Open invites by invited session: one at a time per invited duck. */
  private readonly open = new Map<string, Invite>();
  /** The last invite from a sender to a target ("from|to"), for the same-target cool-down. */
  private readonly lastPair = new Map<string, number>();
  private readonly limits = new Limiter(HUB.invite.burst, HUB.invite.refillMs);

  /** May `from` invite `to` now? Records the invite when it may. */
  invite(from: string, to: string, now: number): InviteCheck {
    if (from === to) return 'self';
    const pair = `${from}|${to}`;
    const last = this.lastPair.get(pair);
    if (last !== undefined && now - last < HUB.invite.sameTargetMs) return 'again';
    const held = this.open.get(to);
    if (held && now - held.at < HUB.invite.ttlMs && held.from !== from) return 'busy';
    if (!this.limits.allow(from, now)) return 'limited';
    this.open.set(to, { from, to, at: now });
    this.lastPair.set(pair, now);
    return 'ok';
  }

  /**
   * The invited duck answers an invite from `from`: the invite if it is still
   * open (it is closed either way), else null (expired, never sent, or from
   * someone else).
   */
  answer(to: string, from: string, now: number): Invite | null {
    const inv = this.open.get(to);
    if (!inv || inv.from !== from) return null;
    this.open.delete(to);
    return now - inv.at <= HUB.invite.ttlMs ? inv : null;
  }

  /** Close invites past their time; returns them (the room tells the inviter). */
  expire(now: number): Invite[] {
    const out: Invite[] = [];
    for (const [to, inv] of this.open) {
      if (now - inv.at > HUB.invite.ttlMs) {
        this.open.delete(to);
        out.push(inv);
      }
    }
    for (const [pair, at] of this.lastPair) if (now - at > HUB.invite.sameTargetMs) this.lastPair.delete(pair);
    return out;
  }

  /** A duck left: its invites go, both ways. */
  forget(id: string): void {
    this.open.delete(id);
    for (const [to, inv] of this.open) if (inv.from === id) this.open.delete(to);
    this.limits.forget(id);
  }

  /** Open invites (tests). */
  get size(): number {
    return this.open.size;
  }
}
