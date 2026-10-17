/**
 * Banned player ids, in memory for the session checks (meta verifySession and
 * createSession read `isBanned`). The admin store loads them from the
 * database (`bans`) at start and keeps this in step with every change. A ban
 * blocks the player id, which is what the device token carries, so the same
 * browser cannot get a new session either.
 */

export interface Ban {
  playerId: string;
  reason: string;
  /** ms since epoch; null: no end. */
  expiresAt: number | null;
  createdAt: number;
}

const bans = new Map<string, Ban>();

export function isBanned(playerId: string | null | undefined, now = Date.now()): boolean {
  if (!playerId) return false;
  const b = bans.get(playerId);
  if (!b) return false;
  if (b.expiresAt !== null && b.expiresAt <= now) {
    bans.delete(playerId);
    return false;
  }
  return true;
}

export function putBan(b: Ban): void {
  bans.set(b.playerId, b);
}

export function dropBan(playerId: string): boolean {
  return bans.delete(playerId);
}

export function replaceBans(list: readonly Ban[]): void {
  bans.clear();
  for (const b of list) bans.set(b.playerId, b);
}

/** Active bans, newest first. */
export function listBans(now = Date.now()): Ban[] {
  return [...bans.values()].filter((b) => b.expiresAt === null || b.expiresAt > now).sort((a, b) => b.createdAt - a.createdAt);
}
