-- Accounts: email sign-in with one-time codes, account sessions and up to
-- four characters per account. A character is a row of `players` (the same
-- identity the leaderboard and match rows use) with an account and a slot;
-- guests keep account_id and slot null. Additive only: existing guest
-- players and the admin tables are untouched. Written only by the game
-- server (apps/server/src/meta/accounts/). See docs/accounts.md and
-- docs/privacy-notes.md.

create table accounts (
  id                    uuid primary key,
  created_at            timestamptz not null default now(),
  last_login_at         timestamptz not null default now(),
  -- The terms and privacy version accepted at sign-up, and when (with the 16+ statement).
  legal_version         text not null check (length(legal_version) between 1 and 32),
  legal_accepted_at     timestamptz not null,
  age_confirmed_at      timestamptz not null,
  -- Marketing email opt-in now (unchecked by default, changed only by the
  -- player); every choice is also logged in marketing_consents.
  marketing_opt_in      boolean not null default false,
  marketing_updated_at  timestamptz not null default now(),
  -- The character picked last (highlighted on a new device).
  last_character_id     uuid
);

-- Every news email choice, append only: yes or no, when, and which wording
-- of the opt-in was shown (MARKETING_TEXT_VERSION). A withdrawal adds a row,
-- it never overwrites the earlier yes. Deleted with the account.
create table marketing_consents (
  id            bigint generated always as identity primary key,
  account_id    uuid not null references accounts (id) on delete cascade,
  opt_in        boolean not null,
  text_version  text not null check (length(text_version) between 1 and 32),
  source        text not null check (source in ('signup', 'account')),
  at            timestamptz not null default now()
);
create index marketing_consents_account on marketing_consents (account_id, at desc);

-- How an account signs in. One account can have several methods: 'email'
-- now (subject: the normalised address, also where we write to the player),
-- 'qorex' later (subject: a qor1 address proven by a wallet signature).
create table account_logins (
  id            bigint generated always as identity primary key,
  account_id    uuid not null references accounts (id) on delete cascade,
  method        text not null check (method in ('email', 'qorex')),
  subject       text not null check (length(subject) between 3 and 254),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  unique (method, subject)
);
create index account_logins_account on account_logins (account_id);
-- At most one login per method and account (one email, later one wallet).
create unique index account_logins_one_per_method on account_logins (account_id, method);

-- Signed-in devices. The account session token names a row; logout deletes
-- it, account deletion deletes them all. No IP address or user agent.
create table account_sessions (
  id            uuid primary key,
  account_id    uuid not null references accounts (id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index account_sessions_account on account_sessions (account_id);

-- One-time codes, one active code per address. Only an HMAC of the code is
-- stored; rows expire after 10 minutes and are deleted on use.
create table login_codes (
  email       text primary key check (length(email) between 3 and 254),
  purpose     text not null check (purpose in ('login', 'delete')),
  code_hash   text not null,
  salt        text not null,
  attempts    smallint not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index login_codes_expires on login_codes (expires_at);

-- Characters: the account and slot (0 to 3) of a player row, its look (the
-- shared character catalog id) and its progress. Level and XP are cosmetic
-- progress only (phase 2 fills them); they never change gameplay.
alter table players add column account_id uuid references accounts (id) on delete cascade;
alter table players add column slot smallint check (slot between 0 and 3);
alter table players add column look smallint not null default 0 check (look between 0 and 255);
alter table players add column xp bigint not null default 0 check (xp >= 0);
alter table players add column level smallint not null default 1 check (level >= 1);
alter table players add constraint players_account_slot_pair check ((account_id is null) = (slot is null));
create unique index players_account_slot on players (account_id, slot) where account_id is not null;
