/**
 * Match results from the game server into PostgreSQL. The only writer of
 * leaderboard data is the game server itself; nothing here is reachable from
 * a client.
 */
import type { Sql } from 'postgres';
import { matchPoints } from './score.ts';
import { isUuid } from './token.ts';

export interface MatchResult {
  matchId: string;
  mode: 'br' | 'dm';
  mapId: string;
  startedAt: number;
  endedAt: number;
  players: Array<{
    playerId: string | null;
    name: string;
    isBot: boolean;
    placement: number;
    kills: number;
    damage: number;
    survivedMs: number;
    /** Optional. Default: battle royale 1 unless the player won, deathmatch 0. Pass it for deathmatch so K/D is right. */
    deaths?: number;
  }>;
}

export interface MatchRow {
  slot: number;
  player_id: string | null;
  name: string;
  is_bot: boolean;
  placement: number;
  kills: number;
  deaths: number;
  damage: number;
  survived_ms: number;
  points: number;
}

export interface NormalizedMatch {
  key: string;
  mode: 'br' | 'dm';
  mapId: string;
  startedAt: Date;
  endedAt: Date;
  humanCount: number;
  rows: MatchRow[];
}

const MAX_PLAYERS = 128;
const DAY_MS = 24 * 3600 * 1000;

function int(v: unknown, min: number, max: number, fallback = min): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Validate and clamp a result. Null when it is not a usable match. */
export function normalizeMatch(r: MatchResult, nowMs = Date.now()): NormalizedMatch | null {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.matchId !== 'string' || r.matchId.length === 0 || r.matchId.length > 128) return null;
  if (r.mode !== 'br' && r.mode !== 'dm') return null;
  if (typeof r.mapId !== 'string' || r.mapId.length === 0 || r.mapId.length > 64) return null;
  if (!Number.isFinite(r.startedAt) || !Number.isFinite(r.endedAt) || r.endedAt < r.startedAt) return null;
  if (r.endedAt > nowMs + 3600_000 || r.endedAt - r.startedAt > DAY_MS) return null;
  if (!Array.isArray(r.players) || r.players.length === 0 || r.players.length > MAX_PLAYERS) return null;
  const field = r.players.length;
  const rows: MatchRow[] = r.players.map((p, slot) => {
    const isBot = p.isBot === true;
    const placement = int(p.placement, 1, field);
    const kills = int(p.kills, 0, 9999);
    const deathsDefault = r.mode === 'br' ? (placement > 1 ? 1 : 0) : 0;
    return {
      slot,
      player_id: !isBot && isUuid(p.playerId) ? p.playerId : null,
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name.slice(0, 32) : 'Duck',
      is_bot: isBot,
      placement,
      kills,
      deaths: int(p.deaths, 0, 9999, deathsDefault),
      damage: int(p.damage, 0, 10_000_000),
      survived_ms: int(p.survivedMs, 0, DAY_MS),
      points: isBot ? 0 : matchPoints(r.mode, placement, field, kills),
    };
  });
  return {
    key: r.matchId,
    mode: r.mode,
    mapId: r.mapId,
    startedAt: new Date(r.startedAt),
    endedAt: new Date(r.endedAt),
    humanCount: rows.filter((x) => !x.is_bot).length,
    rows,
  };
}

/** Write one match. Returns false when it was already recorded (same matchId) or no season is open. */
export async function insertMatch(sql: Sql, m: NormalizedMatch): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [season] = await tx<{ id: number }[]>`
      select id from seasons where starts_at <= now() and (ends_at is null or ends_at > now())
      order by starts_at desc limit 1`;
    if (!season) {
      console.warn('[meta] no open season, match not recorded');
      return false;
    }
    const inserted = await tx<{ id: string }[]>`
      insert into matches (match_key, season_id, mode, map_id, started_at, ended_at, player_count, human_count)
      values (${m.key}, ${season.id}, ${m.mode}, ${m.mapId}, ${m.startedAt}, ${m.endedAt}, ${m.rows.length}, ${m.humanCount})
      on conflict (match_key) do nothing
      returning id`;
    const matchId = inserted[0]?.id;
    if (matchId === undefined) return false;

    // Sessions minted while the database was down point at players with no
    // row yet: record those as unranked instead of failing the whole match.
    const ids = [...new Set(m.rows.map((x) => x.player_id).filter((x): x is string => x !== null))];
    const known = new Set<string>();
    if (ids.length > 0) {
      for (const r of await tx<{ id: string }[]>`select id from players where id in ${tx(ids)}`) known.add(r.id);
    }
    const rows = m.rows.map((x) => ({ ...x, match_id: matchId, player_id: x.player_id && known.has(x.player_id) ? x.player_id : null }));
    await tx`insert into match_players ${tx(rows, 'match_id', 'slot', 'player_id', 'name', 'is_bot', 'placement', 'kills', 'deaths', 'damage', 'survived_ms', 'points')}`;
    if (known.size > 0) await tx`update players set last_seen = now() where id in ${tx([...known])}`;
    return true;
  });
}
