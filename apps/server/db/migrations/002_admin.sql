-- Admin panel: runtime settings, the admin audit log, bans, players hidden
-- from the leaderboard and extra blocked name words. Written only by the game
-- server (apps/server/src/admin/store.ts). No IP addresses are stored here:
-- IP blocks live in server memory only.

-- Settings that differ from the defaults (the constants). A reset deletes the row.
create table admin_settings (
  key         text primary key check (key ~ '^[a-zA-Z0-9_.]{1,64}$'),
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Every change made in the admin panel: who, when, what, old and new value.
create table admin_audit (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      text not null,
  action     text not null,
  target     text not null default '',
  old_value  jsonb,
  new_value  jsonb
);
create index admin_audit_at on admin_audit (at desc);

-- Banned guests, by player id (the id the device token carries).
create table bans (
  player_id   uuid primary key,
  reason      text not null default '',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  created_by  text not null,
  check (expires_at is null or expires_at > created_at)
);

-- Players kept off the leaderboard (their matches stay recorded).
create table leaderboard_hidden (
  player_id   uuid primary key,
  reason      text not null default '',
  created_at  timestamptz not null default now(),
  created_by  text not null
);

-- Blocked name words added at runtime, on top of blocked-names.json.
create table blocked_names (
  word        text primary key check (word ~ '^[a-z]{3,24}$'),
  whole       boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  text not null
);
