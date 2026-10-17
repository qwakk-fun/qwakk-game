/**
 * Leaderboard reads over the `leaderboard_stats` view (bots excluded, and
 * players the admin hid: `leaderboard_hidden`).
 * `rank` is always the position by season score; `sort` only orders the list.
 * K/D and average placement sorts need at least MIN_MATCHES_FOR_RATIOS matches,
 * so one lucky game does not top a ratio board.
 */
import type { Sql } from 'postgres';
import { kdRatio } from './score.ts';

export const SORTS = ['score', 'wins', 'kills', 'kd', 'matches', 'avgPlace'] as const;
export type SortKey = (typeof SORTS)[number];
export const MODES = ['all', 'br', 'dm'] as const;
export type ModeFilter = (typeof MODES)[number];
export const MIN_MATCHES_FOR_RATIOS = 5;
export const TOP_N = 100;

export interface Season {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string | null;
}

export interface Standing {
  rank: number;
  name: string;
  tag: string;
  score: number;
  wins: number;
  kills: number;
  deaths: number;
  kd: number;
  matches: number;
  avgPlace: number;
  damage: number;
}

interface Raw {
  rank: number;
  total: number;
  name: string;
  tag: number;
  points: number;
  wins: number;
  kills: number;
  deaths: number;
  matches: number;
  placement_sum: number;
  damage: number;
}

function toStanding(r: Raw): Standing {
  return {
    rank: r.rank,
    name: r.name,
    tag: String(r.tag),
    score: r.points,
    wins: r.wins,
    kills: r.kills,
    deaths: r.deaths,
    kd: kdRatio(r.kills, r.deaths),
    matches: r.matches,
    avgPlace: r.matches > 0 ? Math.round((r.placement_sum / r.matches) * 10) / 10 : 0,
    damage: r.damage,
  };
}

function seasonRow(r: { id: number; name: string; starts_at: Date; ends_at: Date | null }): Season {
  return { id: r.id, name: r.name, startsAt: r.starts_at.toISOString(), endsAt: r.ends_at ? r.ends_at.toISOString() : null };
}

export async function currentSeason(sql: Sql): Promise<Season | null> {
  const [r] = await sql<{ id: number; name: string; starts_at: Date; ends_at: Date | null }[]>`
    select id, name, starts_at, ends_at from seasons
    where starts_at <= now() and (ends_at is null or ends_at > now())
    order by starts_at desc limit 1`;
  return r ? seasonRow(r) : null;
}

export async function seasonById(sql: Sql, id: number): Promise<Season | null> {
  const [r] = await sql<{ id: number; name: string; starts_at: Date; ends_at: Date | null }[]>`
    select id, name, starts_at, ends_at from seasons where id = ${id}`;
  return r ? seasonRow(r) : null;
}

function ranked(sql: Sql, seasonId: number, mode: ModeFilter) {
  return sql`
    with agg as (
      select player_id,
        sum(matches)::int as matches, sum(wins)::int as wins, sum(kills)::int as kills,
        sum(deaths)::int as deaths, sum(damage)::float8 as damage,
        sum(placement_sum)::int as placement_sum, sum(points)::int as points
      from leaderboard_stats
      where season_id = ${seasonId} and (${mode}::text = 'all' or mode = ${mode}::text)
        and player_id not in (select player_id from leaderboard_hidden)
      group by player_id
    ), ranked as (
      select agg.*,
        (rank() over (order by points desc, wins desc, kills desc))::int as rank,
        (count(*) over ())::int as total
      from agg
    )`;
}

function orderFor(sql: Sql, sort: SortKey) {
  switch (sort) {
    case 'wins':
      return sql`order by r.wins desc, r.points desc, p.created_at`;
    case 'kills':
      return sql`order by r.kills desc, r.points desc, p.created_at`;
    case 'kd':
      return sql`where r.matches >= ${MIN_MATCHES_FOR_RATIOS} order by (r.kills::float8 / greatest(r.deaths, 1)) desc, r.kills desc, p.created_at`;
    case 'matches':
      return sql`order by r.matches desc, r.points desc, p.created_at`;
    case 'avgPlace':
      return sql`where r.matches >= ${MIN_MATCHES_FOR_RATIOS} order by (r.placement_sum::float8 / r.matches) asc, r.matches desc, p.created_at`;
    default:
      return sql`order by r.rank, p.created_at`;
  }
}

export async function topPlayers(sql: Sql, seasonId: number, mode: ModeFilter, sort: SortKey, limit = TOP_N): Promise<{ total: number; rows: Standing[] }> {
  const rows = await sql<Raw[]>`
    ${ranked(sql, seasonId, mode)}
    select r.*, p.name, p.tag from ranked r join players p on p.id = r.player_id
    ${orderFor(sql, sort)}
    limit ${limit}`;
  // total counts every ranked player, also when the ratio filters hide some.
  const total = rows[0]?.total ?? (await countRanked(sql, seasonId, mode));
  return { total, rows: rows.map(toStanding) };
}

export async function playerStanding(sql: Sql, seasonId: number, mode: ModeFilter, playerId: string): Promise<{ total: number; standing: Standing | null }> {
  const rows = await sql<Raw[]>`
    ${ranked(sql, seasonId, mode)}
    select r.*, p.name, p.tag
    from ranked r join players p on p.id = r.player_id
    where r.player_id = ${playerId}`;
  const r = rows[0];
  if (r) return { total: r.total, standing: toStanding(r) };
  return { total: await countRanked(sql, seasonId, mode), standing: null };
}

async function countRanked(sql: Sql, seasonId: number, mode: ModeFilter): Promise<number> {
  const [t] = await sql<{ n: number }[]>`
    select count(distinct player_id)::int as n from leaderboard_stats
    where season_id = ${seasonId} and (${mode}::text = 'all' or mode = ${mode}::text)
      and player_id not in (select player_id from leaderboard_hidden)`;
  return t?.n ?? 0;
}
