/**
 * Guest player rows: name changes keep the player id, and each name gets a
 * #tag that no one else with the same name (case-insensitive) holds.
 */
import { createHmac } from 'node:crypto';
import type { Sql } from 'postgres';
import { randomTag } from './token.ts';

const TAG_TRIES = 24;

export type UpsertResult = { ok: true; tag: string } | { ok: false; reason: 'name_full' };

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
  const [current] = await sql<{ name: string; tag: number }[]>`select name, tag from players where id = ${playerId}`;
  const tries: number[] = [];
  if (current) tries.push(current.tag);
  while (tries.length < TAG_TRIES) tries.push(randomTag());
  for (const tag of tries) {
    try {
      await sql`
        insert into players (id, name, tag) values (${playerId}, ${name}, ${tag})
        on conflict (id) do update set name = excluded.name, tag = excluded.tag, last_seen = now()`;
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
