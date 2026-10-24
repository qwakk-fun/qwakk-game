-- Hunt Season progression (docs/progression.md): a duck's Tüy (Feathers)
-- balance and its ledger, the gear it owns and wears, its skill tree and how
-- many times it reset the tree. Tüy is an in-game soft currency earned only
-- by playing Hunt Season: never sold for real money, never tradeable, never
-- a token. Grants are written only by the game server at the end of a run
-- (meta/raid.ts recordRaid, in the run's transaction, once per run id);
-- purchases, equips, tree spends and respecs only through the checked
-- /api/duck routes (meta/progression/), each in one transaction with the
-- duck's progress row locked. Every row belongs to one duck (players.id) and
-- goes with it (on delete cascade): deleting a duck or an account deletes
-- all of this. Additive only: existing ducks get their rows on first use
-- (the starter katana, a zero balance). No IPs, no names.
-- See docs/privacy-notes.md.

create table duck_progress (
  player_id        uuid primary key references players (id) on delete cascade,
  feathers         integer not null default 0 check (feathers >= 0),
  -- Every Tüy ever granted (support and balance checks).
  feathers_earned  bigint not null default 0 check (feathers_earned >= 0),
  respecs          smallint not null default 0 check (respecs >= 0),
  -- The UTC day of the last first-run-of-the-day bonus.
  daily_bonus_on   date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Every change to a balance, append only (support and audit): a run's grant,
-- the daily bonus, a purchase, a respec, an admin grant. `idem_key` makes a
-- retried purchase or respec a no-op.
create table feather_ledger (
  id             bigint generated always as identity primary key,
  player_id      uuid not null references players (id) on delete cascade,
  delta          integer not null,
  balance_after  integer not null check (balance_after >= 0),
  reason         text not null check (reason in ('run', 'daily', 'buy', 'respec', 'admin')),
  -- The run id, the item id, or the admin audit target.
  ref            text check (length(ref) <= 128),
  idem_key       text check (length(idem_key) between 8 and 64),
  at             timestamptz not null default now()
);
create index feather_ledger_player on feather_ledger (player_id, id desc);
create unique index feather_ledger_idem on feather_ledger (player_id, idem_key) where idem_key is not null;
-- A run grants once per duck (the run id is unique in raid_runs too).
create unique index feather_ledger_run on feather_ledger (player_id, ref) where reason in ('run', 'daily');

-- Gear a duck owns: one row per item (an item is bought once).
create table duck_items (
  player_id    uuid not null references players (id) on delete cascade,
  item_id      text not null check (length(item_id) between 1 and 32),
  source       text not null check (source in ('starter', 'shop', 'admin')),
  acquired_at  timestamptz not null default now(),
  primary key (player_id, item_id)
);

-- What a duck wears, per slot (katana, armor; helmet and charm later). Only owned items.
create table duck_equipped (
  player_id  uuid not null references players (id) on delete cascade,
  slot       text not null check (slot in ('katana', 'armor', 'helmet', 'charm')),
  item_id    text not null,
  primary key (player_id, slot),
  foreign key (player_id, item_id) references duck_items (player_id, item_id) on delete cascade
);

-- The skill tree: a rank per node.
create table duck_tree (
  player_id  uuid not null references players (id) on delete cascade,
  node_id    text not null check (length(node_id) between 1 and 32),
  rank       smallint not null check (rank between 1 and 9),
  primary key (player_id, node_id)
);
