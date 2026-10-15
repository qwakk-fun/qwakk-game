/**
 * A throwaway database on the local test Postgres (docker compose, port 5439).
 * TEST_DATABASE_URL overrides the server URL. When it cannot be reached, the
 * DB tests are skipped with a message instead of failing.
 */
import postgres from 'postgres';

export const BASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://qwakk_game:qwakk_game_local@localhost:5439/qwakk_game';

export async function dbReachable(): Promise<boolean> {
  const sql = postgres(BASE_URL, { max: 1, connect_timeout: 2, onnotice: () => {} });
  try {
    await sql`select 1`;
    return true;
  } catch {
    // Straight to stderr: Vitest drops console output of files whose tests are all skipped.
    process.stderr.write(`\n[test] PostgreSQL not reachable at ${BASE_URL.replace(/:[^:@/]+@/, ':***@')}; skipping DB tests. Start it with: docker compose up -d postgres\n`);
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/** Create an empty database; returns its URL and a drop function. */
export async function freshDatabase(label: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `qwakk_test_${label}_${process.pid}_${Date.now().toString(36)}`;
  const admin = postgres(BASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  const u = new URL(BASE_URL);
  u.pathname = `/${name}`;
  return {
    url: u.toString(),
    drop: async () => {
      const a = postgres(BASE_URL, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}
