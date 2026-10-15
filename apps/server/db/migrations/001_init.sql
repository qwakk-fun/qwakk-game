-- Qwakk game meta: guest players, matches, seasons and the leaderboard.
-- Written only by the game server. Applied by apps/server/src/meta/migrate.ts.

create table seasons (
  id         integer primary key,
  name       text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  check (ends_at is null or ends_at > starts_at)
);

-- Season 1 starts when this migration runs.
insert into seasons (id, name, starts_at) values (1, 'Season 1', now());

-- Guest identities. The id comes from the server-signed device token.
create table players (
  id          uuid primary key,
  name        text not null check (name ~ '^[A-Za-z0-9_]{3,16}$'),
  tag         smallint not null check (tag between 1000 and 9999),
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
-- One #tag per name, case-insensitive (Duck#1234 and duck#1234 are the same).
create unique index players_name_tag on players (lower(name), tag);

create table matches (
  id            bigint generated always as identity primary key,
  -- The game server's match id; unique, so a retried write never counts twice.
  match_key     text not null unique,
  season_id     integer not null references seasons (id),
  mode          text not null check (mode in ('br', 'dm')),
  map_id        text not null,
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  player_count  integer not null,
  human_count   integer not null,
  recorded_at   timestamptz not null default now()
);
create index matches_season_mode on matches (season_id, mode);

-- One row per participant, bots included (player_id null, is_bot true).
create table match_players (
  match_id     bigint not null references matches (id) on delete cascade,
  slot         smallint not null,
  player_id    uuid references players (id) on delete set null,
  name         text not null,
  is_bot       boolean not null,
  placement    smallint not null check (placement >= 1),
  kills        smallint not null check (kills >= 0),
  deaths       smallint not null check (deaths >= 0),
  damage       integer not null check (damage >= 0),
  survived_ms  integer not null check (survived_ms >= 0),
  points       integer not null,
  primary key (match_id, slot)
);
create index match_players_player on match_players (player_id) where player_id is not null;

-- Per season, mode and player totals. Bots and unranked guests are excluded.
-- The API sums these rows across modes and ranks them (see leaderboard.ts).
create view leaderboard_stats as
select
  m.season_id,
  m.mode,
  mp.player_id,
  count(*)::int                                   as matches,
  (count(*) filter (where mp.placement = 1))::int as wins,
  sum(mp.kills)::int                              as kills,
  sum(mp.deaths)::int                             as deaths,
  sum(mp.damage)::bigint                          as damage,
  sum(mp.placement)::int                          as placement_sum,
  sum(mp.points)::int                             as points,
  max(m.ended_at)                                 as last_match_at
from match_players mp
join matches m on m.id = mp.match_id
where not mp.is_bot and mp.player_id is not null
group by m.season_id, m.mode, mp.player_id;
