/**
 * Duck Pass rows (migration 008_duck_pass.sql): the wallet is the account's
 * `qorex` login (account_logins), the proof is a duck_passes row. Plain
 * queries; the rules live in service.ts.
 */
import type { Sql, TransactionSql } from 'postgres';
import type { DuckPassView } from '@qwakk/shared/duck-pass';
import { characterOf } from '../accounts/store.ts';
import { currentSeason } from '../leaderboard.ts';

type Db = Sql | TransactionSql;

export type LinkResult = 'ok' | 'linked' | 'taken' | 'proof_used';

/** What the Duck Pass rules need from the database (a fake in the unit tests). */
export interface DuckPassStore {
  duckPassOf(db: Sql, accountId: string): Promise<DuckPassView | null>;
  /** The account that has this wallet as its `qorex` login, if any. */
  walletOwner(db: Sql, address: string): Promise<string | null>;
  /** The #tag of one of the account's ducks, or null when it is not its duck. */
  duckTag(db: Sql, accountId: string, duckId: string): Promise<string | null>;
  /** The current leaderboard season as `s<id>`. */
  season(db: Sql): Promise<string>;
  link(db: Sql, accountId: string, address: string, txHash: string, season: string): Promise<LinkResult>;
  unlink(db: Sql, accountId: string): Promise<boolean>;
}

export async function duckPassOf(db: Db, accountId: string): Promise<DuckPassView | null> {
  const [r] = await db<{ address: string; tx_hash: string; season: string; created_at: Date }[]>`
    select l.subject as address, d.tx_hash, d.season, d.created_at
    from duck_passes d join account_logins l on l.account_id = d.account_id and l.method = 'qorex'
    where d.account_id = ${accountId}`;
  return r ? { address: r.address, txHash: r.tx_hash, season: r.season, linkedAt: r.created_at.toISOString() } : null;
}

function clash(err: unknown): string | null {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === '23505' ? (e.constraint_name ?? '') : null;
}

export const pgDuckPassStore: DuckPassStore = {
  duckPassOf,
  async walletOwner(db, address) {
    const [r] = await db<{ account_id: string }[]>`select account_id from account_logins where method = 'qorex' and subject = ${address}`;
    return r?.account_id ?? null;
  },
  async duckTag(db, accountId, duckId) {
    return (await characterOf(db, accountId, duckId))?.tag ?? null;
  },
  async season(db) {
    return `s${(await currentSeason(db))?.id ?? 1}`;
  },
  async link(db, accountId, address, txHash, season) {
    try {
      await db.begin(async (tx) => {
        await tx`insert into account_logins (account_id, method, subject, last_used_at) values (${accountId}, 'qorex', ${address}, now())`;
        await tx`insert into duck_passes (account_id, tx_hash, season) values (${accountId}, ${txHash}, ${season})`;
      });
      return 'ok';
    } catch (err) {
      const c = clash(err);
      if (c === null) throw err;
      if (c === 'account_logins_method_subject_key') return 'taken';
      if (c === 'duck_passes_tx_hash_key') return 'proof_used';
      // account_logins_one_per_method or duck_passes_pkey: this account already has a wallet.
      return 'linked';
    }
  },
  async unlink(db, accountId) {
    return db.begin(async (tx) => {
      await tx`delete from duck_passes where account_id = ${accountId}`;
      const gone = await tx`delete from account_logins where account_id = ${accountId} and method = 'qorex'`;
      return gone.count > 0;
    });
  },
};
