/**
 * Plain SQL migrations: `apps/server/db/migrations/NNN_name.sql`, applied in
 * file-name order at server start. Applied names (and a checksum) live in the
 * `schema_migrations` table. The whole run is one transaction under an
 * advisory lock, so two servers starting together cannot both apply a file,
 * and a failing migration leaves the database untouched.
 *
 * Never edit an applied migration: add a new file. An edited one is reported
 * (checksum mismatch) but not re-run.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
const LOCK_ID = 7_212_026; // any constant; shared by every game server

export interface MigrationFile {
  name: string;
  sql: string;
}

export async function readMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => /^\d+_[\w-]+\.sql$/.test(n)).sort();
  return Promise.all(names.map(async (name) => ({ name, sql: await readFile(`${dir.replace(/\/?$/, '/')}${name}`, 'utf8') })));
}

const checksum = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Apply pending migrations. Returns the names applied in this run. */
export async function migrate(sql: Sql, files: MigrationFile[]): Promise<string[]> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK_ID})`;
    await tx`create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`;
    const rows = await tx<{ name: string; checksum: string }[]>`select name, checksum from schema_migrations`;
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    const done: string[] = [];
    for (const f of files) {
      const sum = checksum(f.sql);
      const prev = applied.get(f.name);
      if (prev !== undefined) {
        if (prev !== sum) console.warn(`[meta] migration ${f.name} changed after it was applied; add a new migration instead`);
        continue;
      }
      await tx.unsafe(f.sql).simple();
      await tx`insert into schema_migrations (name, checksum) values (${f.name}, ${sum})`;
      done.push(f.name);
    }
    return done;
  });
}
