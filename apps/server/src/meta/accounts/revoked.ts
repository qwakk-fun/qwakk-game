/**
 * Game sessions (24 h, stateless) that must stop working before they expire:
 * a deleted duck and every duck of a deleted account (every session issued
 * up to now), and a guest's guest sessions once its duck moved into an
 * account (guest sessions only: its new account sessions stay good). Kept in
 * process memory (one server instance) for the longest session lifetime.
 * After a restart a deleted duck's leftover session may still join a room,
 * but its results record as unranked (insertMatch drops unknown player ids).
 */
import { SESSION_TTL_S } from '../token.ts';

const KEEP_MS = (SESSION_TTL_S + 3600) * 1000;
interface Revocation {
  /** When (ms): sessions issued up to then stop working. */
  at: number;
  /** Only its guest sessions (a claimed guest), not its account sessions. */
  guestOnly: boolean;
}

const revoked = new Map<string, Revocation>();

/** Every session of `playerId` issued up to now stops working (a deleted duck). */
export function revokeSessions(playerId: string, nowMs = Date.now()): void {
  revoked.set(playerId, { at: nowMs, guestOnly: false });
  if (revoked.size > 10_000) sweep(nowMs);
}

/** The guest sessions of `playerId` stop working (its duck moved into an account). */
export function revokeGuestSessions(playerId: string, nowMs = Date.now()): void {
  if (revoked.get(playerId)?.guestOnly === false) return;
  revoked.set(playerId, { at: nowMs, guestOnly: true });
  if (revoked.size > 10_000) sweep(nowMs);
}

/** Was this session (issued at `issuedAtMs`, whole seconds; `account` or guest) revoked? */
export function isRevoked(playerId: string, issuedAtMs: number, account: boolean, nowMs = Date.now()): boolean {
  const r = revoked.get(playerId);
  if (!r) return false;
  if (nowMs - r.at > KEEP_MS) {
    revoked.delete(playerId);
    return false;
  }
  if (r.guestOnly) return !account && issuedAtMs <= r.at;
  return issuedAtMs <= r.at;
}

function sweep(nowMs: number): void {
  for (const [id, r] of revoked) if (nowMs - r.at > KEEP_MS) revoked.delete(id);
}

/** Tests. */
export function clearRevoked(): void {
  revoked.clear();
}
