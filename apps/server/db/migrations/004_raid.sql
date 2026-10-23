-- Hunt Season (the co-op PvE mode): finished runs, each duck's part in them
-- and each duck's personal best. Written only by the game server at the end
-- of a run (meta/raid.ts recordRaid), in the same transaction that adds the
-- run's XP to players.xp and players.level (existing columns from 003).
-- Additive only. In-game stats: no names (the duck row has them), no IPs.
-- See docs/hunt-season.md and docs/privacy-notes.md.

create table raid_runs (
  id             bigint generated always as identity primary key,
  -- The game server's run id (the room id); unique, so a retried write never grants XP twice.
  run_key        text not null unique check (length(run_key) between 1 and 128),
  map_id         text not null,
  started_at     timestamptz not null,
  ended_at       timestamptz not null,
  waves_cleared  smallint not null check (waves_cleared between 0 and 99),
  won            boolean not null,
  duck_count     smallint not null check (duck_count between 1 and 8),
  recorded_at    timestamptz not null default now()
);

-- One row per account duck in a run. A deleted duck's rows stay without a link (player_id set null).
create table raid_run_players (
  run_id         bigint not null references raid_runs (id) on delete cascade,
  slot           smallint not null,
  player_id      uuid references players (id) on delete set null,
  waves_cleared  smallint not null check (waves_cleared >= 0),
  kills          smallint not null check (kills >= 0),
  boss_kills     smallint not null check (boss_kills >= 0),
  revives        smallint not null check (revives >= 0),
  xp             integer not null check (xp >= 0),
  primary key (run_id, slot)
);
create index raid_run_players_player on raid_run_players (player_id) where player_id is not null;

-- A duck's best run: the most waves cleared, and the shortest time it took to clear that many.
create table raid_bests (
  player_id    uuid primary key references players (id) on delete cascade,
  best_wave    smallint not null check (best_wave >= 0),
  best_ms      integer not null check (best_ms >= 0),
  runs         integer not null default 0 check (runs >= 0),
  wins         integer not null default 0 check (wins >= 0),
  updated_at   timestamptz not null default now()
);
