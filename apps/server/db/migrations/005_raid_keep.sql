-- Hunt Season v2 moves to Pond Keep (10 waves instead of the 15 of Kavren),
-- so a duck's personal best starts fresh there: a best of 12 waves on Kavren
-- could never be beaten in a 10 wave run. Same columns as raid_bests (004),
-- which stays as it is (no longer written). Written only by the game server
-- at the end of a run (meta/raid.ts recordRaid). In-game stats: no names, no
-- IPs. See docs/hunt-season.md and docs/privacy-notes.md.

create table raid_keep_bests (
  player_id    uuid primary key references players (id) on delete cascade,
  best_wave    smallint not null check (best_wave >= 0),
  best_ms      integer not null check (best_ms >= 0),
  runs         integer not null default 0 check (runs >= 0),
  wins         integer not null default 0 check (wins >= 0),
  updated_at   timestamptz not null default now()
);
