/**
 * Guest player rows: name changes keep the player id, and each name gets a
 * #tag that no one else with the same name (case-insensitive) holds. A row
 * that moved into an account (a claimed guest, accounts/store.ts) is never
 * touched here again: the guest path answers `claimed`.
 */
import { createHmac } from 'node:crypto';
import type { Sql } from 'postgres';
import { randomTag } from './token.ts';

const TAG_TRIES = 24;

export type UpsertResult = { ok: true; tag: string } | { ok: false; reason: 'name_full' | 'claimed' };

function isNameTagClash(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === '23505' && e.constraint_name === 'players_name_tag';
}

/**
 * Create the player or rename it. Keeps the current tag when the name stays
 * the same (ignoring case) or the old tag is free under the new name, else
 * draws random tags until one is free.
 */
export async function upsertPlayer(sql: Sql, playerId: string, name: string): Promise<UpsertResult> {
  const [current] = await sql<{ name: string; tag: number; account_id: string | null }[]>`select name, tag, account_id from players where id = ${playerId}`;
  if (current?.account_id) return { ok: false, reason: 'claimed' };
  const tries: number[] = [];
  if (current) tries.push(current.tag);
  while (tries.length < TAG_TRIES) tries.push(randomTag());
  for (const tag of tries) {
    try {
      const rows = await sql`
        insert into players (id, name, tag) values (${playerId}, ${name}, ${tag})
        on conflict (id) do update set name = excluded.name, tag = excluded.tag, last_seen = now()
        where players.account_id is null
        returning id`;
      // No row back: it moved into an account between the read and the write.
      if (rows.length === 0) return { ok: false, reason: 'claimed' };
      return { ok: true, tag: String(tag) };
    } catch (err) {
      if (!isNameTagClash(err)) throw err;
    }
  }
  return { ok: false, reason: 'name_full' };
}

/** Without a database: a stable tag per player and name, unchecked for clashes (dev, or the database down). */
export function offlineTag(secret: string, playerId: string, name: string): string {
  const h = createHmac('sha256', secret).update(`qwakk:tag:${playerId}:${name.toLowerCase()}`).digest();
  return String(1000 + (h.readUInt32BE(0) % 9000));
}
