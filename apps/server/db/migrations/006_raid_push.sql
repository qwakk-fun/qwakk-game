-- Hunt Season v3 (the push: katanas, hordes of minions and four objectives
-- across Pond Keep's field instead of ten waves). Each duck's part of a run
-- also counts the minions it bagged and the combo bonus the server added up
-- (both feed the XP, recomputed from these numbers by the game server), and
-- a duck's personal best starts fresh: a best of 10 waves could never be
-- beaten in a run of 4 objectives. Same columns as raid_keep_bests (005),
-- which stays as it is (no longer written). Written only by the game server
-- at the end of a run (meta/raid.ts recordRaid). In-game stats: no names, no
-- IPs. See docs/hunt-season.md and docs/privacy-notes.md.

alter table raid_run_players add column minion_kills integer not null default 0 check (minion_kills >= 0);
alter table raid_run_players add column combo_xp integer not null default 0 check (combo_xp >= 0);

create table raid_push_bests (
  player_id    uuid primary key references players (id) on delete cascade,
  best_wave    smallint not null check (best_wave >= 0),
  best_ms      integer not null check (best_ms >= 0),
  runs         integer not null default 0 check (runs >= 0),
  wins         integer not null default 0 check (wins >= 0),
  updated_at   timestamptz not null default now()
);
