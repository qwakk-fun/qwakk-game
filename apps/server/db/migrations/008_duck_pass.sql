-- Duck Pass: a QoreX wallet linked to an account by one hybrid-signed proof
-- transaction on the QoreChain testnet (docs/accounts.md, Duck Pass). The
-- wallet itself is the account's `qorex` login (account_logins, method
-- 'qorex', subject = the qor1 address; 003 already allows it, one per account
-- and one account per address). This table keeps the proof: which transaction
-- linked it and in which season. Written only by the game server after it
-- checked the transaction on chain (apps/server/src/meta/duckPass/).
-- Deleted with the account, and on unlink. Additive only.

create table duck_passes (
  account_id  uuid primary key references accounts (id) on delete cascade,
  -- The proof transaction, upper-case hex. One proof links one account once.
  tx_hash     text not null unique check (tx_hash ~ '^[0-9A-F]{64}$'),
  -- The leaderboard season the proof names in its memo (s1, s2, ...).
  season      text not null check (season ~ '^s[0-9]{1,6}$'),
  created_at  timestamptz not null default now()
);
