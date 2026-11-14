/**
 * Account rows in PostgreSQL (migration 003_accounts.sql): accounts, their
 * logins, sessions, news consent log and characters (player rows with an
 * account and a slot). Plain queries; the rules (validation, limits, who may
 * do what) live in service.ts.
 */
import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { CHARACTER_SLOTS, LEGAL_VERSION, MARKETING_TEXT_VERSION, type AccountView, type CharacterView } from '@qwakk/shared/accounts';
import { randomTag } from '../token.ts';
import { ACCOUNT_SESSION_MS } from './tokens.ts';
import { duckPassOf } from '../duckPass/store.ts';

type Db = Sql | TransactionSql;

/** Sessions an account keeps at once (devices); the oldest go first. */
export const MAX_SESSIONS = 20;
/** What a deleted duck's name becomes in the match history it leaves behind. */
export const DELETED_NAME = 'deleted';
const TAG_TRIES = 24;

interface CharacterRow {
  id: string;
  slot: number;
  name: string;
  tag: number;
  look: number;
  level: number;
  xp: string | number;
  /** Hunt Season personal best of the push (v3) (left join raid_push_bests; null without a run). */
  best_wave?: number | null;
  best_ms?: number | null;
  raid_runs?: number | null;
  raid_wins?: number | null;
  /** The katana it wears (left join duck_equipped; null: the starter, or no progression yet). */
  katana?: string | null;
}

const toCharacter = (r: CharacterRow): CharacterView => ({
  id: r.id, slot: r.slot, name: r.name, tag: String(r.tag), look: r.look, level: r.level, xp: Number(r.xp),
  raidBest: r.best_wave !== null && r.best_wave !== undefined ? { wave: r.best_wave, ms: r.best_ms ?? 0, runs: r.raid_runs ?? 0, wins: r.raid_wins ?? 0 } : null,
  katana: r.katana ?? null,
});

export async function accountIdByEmail(db: Db, email: string): Promise<string | null> {
  const [r] = await db<{ account_id: string }[]>`select account_id from account_logins where method = 'email' and subject = ${email}`;
  return r?.account_id ?? null;
}

/** A new account for a verified address, with its email login and the first news choice. */
export async function createAccount(db: Sql, email: string, marketing: boolean): Promise<string> {
  const id = randomUUID();
  await db.begin(async (tx) => {
    await tx`
      insert into accounts (id, legal_version, legal_accepted_at, age_confirmed_at, marketing_opt_in, marketing_updated_at)
      values (${id}, ${LEGAL_VERSION}, now(), now(), ${marketing}, now())`;
    await tx`insert into account_logins (account_id, method, subject, last_used_at) values (${id}, 'email', ${email}, now())`;
    await tx`insert into marketing_consents (account_id, opt_in, text_version, source) values (${id}, ${marketing}, ${MARKETING_TEXT_VERSION}, 'signup')`;
  });
  return id;
}

export async function touchLogin(db: Db, accountId: string, method: 'email' | 'qorex'): Promise<void> {
  await db`update accounts set last_login_at = now() where id = ${accountId}`;
  await db`update account_logins set last_used_at = now() where account_id = ${accountId} and method = ${method}`;
}

export async function createSession(db: Sql, accountId: string, nowMs = Date.now()): Promise<{ id: string; expiresAt: number }> {
  const id = randomUUID();
  const expiresAt = nowMs + ACCOUNT_SESSION_MS;
  await db`delete from account_sessions where account_id = ${accountId} and expires_at < now()`;
  await db`insert into account_sessions (id, account_id, expires_at) values (${id}, ${accountId}, ${new Date(expiresAt)})`;
  await db`
    delete from account_sessions where id in (
      select id from account_sessions where account_id = ${accountId} order by last_used_at desc offset ${MAX_SESSIONS})`;
  return { id, expiresAt };
}

/** The row behind a session token, if it is still there and unexpired (and marks it used). */
export async function useSession(db: Db, sessionId: string, accountId: string): Promise<{ expiresAt: number } | null> {
  const [r] = await db<{ expires_at: Date }[]>`
    update account_sessions set last_used_at = now()
    where id = ${sessionId} and account_id = ${accountId} and expires_at > now()
    returning expires_at`;
  return r ? { expiresAt: r.expires_at.getTime() } : null;
}

export async function extendSession(db: Db, sessionId: string, nowMs = Date.now()): Promise<number> {
  const expiresAt = nowMs + ACCOUNT_SESSION_MS;
  await db`update account_sessions set expires_at = ${new Date(expiresAt)} where id = ${sessionId}`;
  return expiresAt;
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db`delete from account_sessions where id = ${sessionId}`;
}

export async function listCharacters(db: Db, accountId: string): Promise<CharacterView[]> {
  const rows = await db<CharacterRow[]>`
    select p.id, p.slot, p.name, p.tag, p.look, p.level, p.xp, b.best_wave, b.best_ms, b.runs as raid_runs, b.wins as raid_wins, e.item_id as katana
    from players p left join raid_push_bests b on b.player_id = p.id left join duck_equipped e on e.player_id = p.id and e.slot = 'katana' where p.account_id = ${accountId} order by p.slot`;
  return rows.map(toCharacter);
}

export async function characterOf(db: Db, accountId: string, playerId: string): Promise<CharacterView | null> {
  const [r] = await db<CharacterRow[]>`
    select p.id, p.slot, p.name, p.tag, p.look, p.level, p.xp, b.best_wave, b.best_ms, b.runs as raid_runs, b.wins as raid_wins, e.item_id as katana
    from players p left join raid_push_bests b on b.player_id = p.id left join duck_equipped e on e.player_id = p.id and e.slot = 'katana' where p.id = ${playerId} and p.account_id = ${accountId}`;
  return r ? toCharacter(r) : null;
}

export async function loadAccount(db: Db, accountId: string): Promise<AccountView | null> {
  const [a] = await db<{ email: string | null; marketing_opt_in: boolean; created_at: Date; legal_version: string; last_character_id: string | null }[]>`
    select l.subject as email, a.marketing_opt_in, a.created_at, a.legal_version, a.last_character_id
    from accounts a left join account_logins l on l.account_id = a.id and l.method = 'email'
    where a.id = ${accountId}`;
  if (!a) return null;
  return {
    email: a.email ?? '',
    marketing: a.marketing_opt_in,
    createdAt: a.created_at.toISOString(),
    legalVersion: a.legal_version,
    lastCharacterId: a.last_character_id,
    characters: await listCharacters(db, accountId),
    slots: CHARACTER_SLOTS,
    duckPass: await duckPassOf(db, accountId),
  };
}

function isUniqueClash(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === '23505' && e.constraint_name === constraint;
}

function freeSlot(taken: number[], wanted: number | null): number | null {
  if (wanted !== null) return taken.includes(wanted) ? null : wanted;
  for (let s = 0; s < CHARACTER_SLOTS; s++) if (!taken.includes(s)) return s;
  return null;
}

export type CreateResult = { ok: true; character: CharacterView } | { ok: false; reason: 'slots_full' | 'slot_taken' | 'name_full' };

/** A new duck in the wanted (or the first free) slot, with a #tag free under its name. */
export async function createCharacter(db: Sql, accountId: string, name: string, look: number, wanted: number | null): Promise<CreateResult> {
  const taken = (await db<{ slot: number }[]>`select slot from players where account_id = ${accountId}`).map((r) => r.slot);
  if (taken.length >= CHARACTER_SLOTS) return { ok: false, reason: 'slots_full' };
  const slot = freeSlot(taken, wanted);
  if (slot === null) return { ok: false, reason: 'slot_taken' };
  const id = randomUUID();
  for (let i = 0; i < TAG_TRIES; i++) {
    const tag = randomTag();
    try {
      const [r] = await db<CharacterRow[]>`
        insert into players (id, name, tag, account_id, slot, look) values (${id}, ${name}, ${tag}, ${accountId}, ${slot}, ${look})
        returning id, slot, name, tag, look, level, xp`;
      return { ok: true, character: toCharacter(r!) };
    } catch (err) {
      if (isUniqueClash(err, 'players_account_slot')) return { ok: false, reason: 'slot_taken' };
      if (!isUniqueClash(err, 'players_name_tag')) throw err;
    }
  }
  return { ok: false, reason: 'name_full' };
}

export type ClaimResult = { ok: true; character: CharacterView } | { ok: false; reason: 'no_guest' | 'slots_full' };

/** A guest's duck (an existing player row without an account) moves into the account, stats and all. */
export async function claimGuest(db: Sql, accountId: string, playerId: string, look: number): Promise<ClaimResult> {
  return db.begin(async (tx) => {
    const [guest] = await tx<{ account_id: string | null }[]>`select account_id from players where id = ${playerId} for update`;
    if (!guest || guest.account_id !== null) return { ok: false, reason: 'no_guest' } as const;
    // Lock the account's ducks so two claims or creates cannot take the same slot.
    const taken = (await tx<{ slot: number }[]>`select slot from players where account_id = ${accountId} for update`).map((r) => r.slot);
    const slot = freeSlot(taken, null);
    if (slot === null) return { ok: false, reason: 'slots_full' } as const;
    const [r] = await tx<CharacterRow[]>`
      update players set account_id = ${accountId}, slot = ${slot}, look = ${look}, last_seen = now()
      where id = ${playerId} and account_id is null
      returning id, slot, name, tag, look, level, xp`;
    return r ? ({ ok: true, character: toCharacter(r) } as const) : ({ ok: false, reason: 'no_guest' } as const);
  });
}

/** Is this player row a guest that has an account now (claimed)? */
export async function isClaimed(db: Db, playerId: string): Promise<boolean> {
  const [r] = await db<{ claimed: boolean }[]>`select account_id is not null as claimed from players where id = ${playerId}`;
  return r?.claimed === true;
}

/**
 * Remove ducks: their match rows stay for the match history with no link and
 * no name (player_id set null by the foreign key, name replaced here), and
 * leave the leaderboard; leaderboard_hidden rows for them go too.
 */
async function removePlayers(tx: TransactionSql, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx`update match_players set name = ${DELETED_NAME} where player_id in ${tx(ids)}`;
  await tx`delete from leaderboard_hidden where player_id in ${tx(ids)}`;
  await tx`delete from players where id in ${tx(ids)}`;
}

export async function deleteCharacter(db: Sql, accountId: string, playerId: string): Promise<boolean> {
  return db.begin(async (tx) => {
    const [r] = await tx<{ id: string }[]>`select id from players where id = ${playerId} and account_id = ${accountId} for update`;
    if (!r) return false;
    await removePlayers(tx, [r.id]);
    await tx`update accounts set last_character_id = null where id = ${accountId} and last_character_id = ${playerId}`;
    return true;
  });
}

export async function setMarketing(db: Sql, accountId: string, optIn: boolean): Promise<void> {
  await db.begin(async (tx) => {
    await tx`update accounts set marketing_opt_in = ${optIn}, marketing_updated_at = now() where id = ${accountId}`;
    await tx`insert into marketing_consents (account_id, opt_in, text_version, source) values (${accountId}, ${optIn}, ${MARKETING_TEXT_VERSION}, 'account')`;
  });
}

export async function acceptLegal(db: Db, accountId: string): Promise<void> {
  await db`update accounts set legal_version = ${LEGAL_VERSION}, legal_accepted_at = now() where id = ${accountId}`;
}

export async function setLastCharacter(db: Db, accountId: string, playerId: string): Promise<void> {
  await db`update accounts set last_character_id = ${playerId} where id = ${accountId}`;
  await db`update players set last_seen = now() where id = ${playerId}`;
}

/** Delete the account and everything of it. Returns its ducks' player ids (their sessions get revoked). */
export async function deleteAccount(db: Sql, accountId: string, email: string): Promise<string[]> {
  return db.begin(async (tx) => {
    const ids = (await tx<{ id: string }[]>`select id from players where account_id = ${accountId} for update`).map((r) => r.id);
    await removePlayers(tx, ids);
    // Logins, sessions and the news consent log go with it (on delete cascade).
    await tx`delete from accounts where id = ${accountId}`;
    await tx`delete from login_codes where email = ${email}`;
    return ids;
  });
}

/** Counts for the admin dashboard and tests. */
export async function accountCount(db: Db): Promise<number> {
  const [r] = await db<{ n: number }[]>`select count(*)::int as n from accounts`;
  return r?.n ?? 0;
}
