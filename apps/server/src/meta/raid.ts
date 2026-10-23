/**
 * Hunt Season results into PostgreSQL (004_raid.sql): the run, each account
 * duck's part, its XP and level (players.xp, players.level) and its personal
 * best, in one transaction. Only the game server calls this, at the end of a
 * run (RaidRoom.recordResult); no HTTP route writes any of it. The run id is
 * unique, so a retried write never grants XP twice. Guests and dev identities
 * (no account row) get nothing.
 */
import type { Sql } from 'postgres';
import { LEVEL_CAP, levelOfXp, RAID, RAID_XP, raidXp } from '@qwakk/shared';
import { isUuid } from './token.ts';

export interface RaidRunResult {
  runId: string;
  mapId: string;
  startedAt: number;
  endedAt: number;
  /** Most waves any duck cleared (the run's result). */
  wavesCleared: number;
  won: boolean;
  /** Time to clear the last cleared wave (ms): the personal best time. */
  bestMs: number;
  players: Array<{
    playerId: string | null;
    name: string;
    wavesCleared: number;
    kills: number;
    bossKills: number;
    revives: number;
    /** What the room computed (shown at once); the stored grant is recomputed here from the same numbers. */
    xp: number;
    won: boolean;
  }>;
}

export interface RaidGrant {
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  bestWave: number;
  bestMs: number;
  newBest: boolean;
}

const int = (v: unknown, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(typeof v === 'number' && Number.isFinite(v) ? v : lo)));

/** Validate a run. Null when unusable. */
export function normalizeRaid(r: RaidRunResult, nowMs = Date.now()): RaidRunResult | null {
  if (!r || typeof r.runId !== 'string' || r.runId.length === 0 || r.runId.length > 128) return null;
  if (typeof r.mapId !== 'string' || r.mapId.length === 0 || r.mapId.length > 64) return null;
  if (!Number.isFinite(r.startedAt) || !Number.isFinite(r.endedAt) || r.endedAt < r.startedAt || r.endedAt > nowMs + 3600_000) return null;
  if (!Array.isArray(r.players) || r.players.length === 0 || r.players.length > RAID.maxDucks * 2) return null;
  return {
    ...r,
    wavesCleared: int(r.wavesCleared, 0, RAID.waves),
    bestMs: int(r.bestMs, 0, 24 * 3600_000),
    players: r.players.map((p) => {
      const row = { playerId: isUuid(p.playerId) ? p.playerId : null, name: String(p.name ?? '').slice(0, 32), wavesCleared: int(p.wavesCleared, 0, RAID.waves), kills: int(p.kills, 0, 9999), bossKills: int(p.bossKills, 0, 3), revives: int(p.revives, 0, 999), xp: 0, won: p.won === true };
      // The grant is recomputed from the numbers, so it always follows the shared formula.
      row.xp = Math.min(RAID_XP.maxPerRun, raidXp({ wavesCleared: row.wavesCleared, kills: row.kills, bossKills: row.bossKills, revives: row.revives, won: row.won }));
      return row;
    }),
  };
}

/** Write one run and grant its XP. Returns each granted duck's numbers by player id, or null when it was already recorded. */
export async function insertRaid(sql: Sql, r: RaidRunResult): Promise<Map<string, RaidGrant> | null> {
  return sql.begin(async (tx) => {
    const ducks = r.players.length;
    const inserted = await tx<{ id: string }[]>`
      insert into raid_runs (run_key, map_id, started_at, ended_at, waves_cleared, won, duck_count)
      values (${r.runId}, ${r.mapId}, ${new Date(r.startedAt)}, ${new Date(r.endedAt)}, ${r.wavesCleared}, ${r.won}, ${Math.min(8, ducks)})
      on conflict (run_key) do nothing
      returning id`;
    const runId = inserted[0]?.id;
    if (runId === undefined) return null;
    const out = new Map<string, RaidGrant>();
    const ids = [...new Set(r.players.map((p) => p.playerId).filter((x): x is string => x !== null))];
    // Account ducks only (guests have no account row), locked for the update.
    const rows = ids.length > 0 ? await tx<{ id: string; xp: string }[]>`select id, xp from players where id in ${tx(ids)} and account_id is not null for update` : [];
    const known = new Map(rows.map((x) => [x.id, Number(x.xp)]));
    let slot = 0;
    for (const p of r.players) {
      const id = p.playerId && known.has(p.playerId) ? p.playerId : null;
      await tx`insert into raid_run_players (run_id, slot, player_id, waves_cleared, kills, boss_kills, revives, xp)
        values (${runId}, ${slot++}, ${id}, ${p.wavesCleared}, ${p.kills}, ${p.bossKills}, ${p.revives}, ${id ? p.xp : 0})`;
      if (!id || out.has(id)) continue;
      const before = known.get(id) ?? 0;
      const after = before + p.xp;
      const level = Math.min(LEVEL_CAP, levelOfXp(after));
      await tx`update players set xp = ${after}, level = ${level}, last_seen = now() where id = ${id}`;
      const ms = r.bestMs;
      const [best] = await tx<{ best_wave: number; best_ms: number; was_wave: number | null; was_ms: number | null }[]>`
        with old as (select best_wave, best_ms from raid_bests where player_id = ${id})
        insert into raid_bests (player_id, best_wave, best_ms, runs, wins)
        values (${id}, ${p.wavesCleared}, ${ms}, 1, ${p.won ? 1 : 0})
        on conflict (player_id) do update set
          best_ms = case
            when excluded.best_wave > raid_bests.best_wave then excluded.best_ms
            when excluded.best_wave = raid_bests.best_wave then least(raid_bests.best_ms, excluded.best_ms)
            else raid_bests.best_ms end,
          best_wave = greatest(raid_bests.best_wave, excluded.best_wave),
          runs = raid_bests.runs + 1,
          wins = raid_bests.wins + excluded.wins,
          updated_at = now()
        returning best_wave, best_ms, (select best_wave from old) as was_wave, (select best_ms from old) as was_ms`;
      const newBest = !!best && p.wavesCleared > 0 && (best.was_wave === null || p.wavesCleared > best.was_wave || (p.wavesCleared === best.was_wave && ms < (best.was_ms ?? Infinity)));
      out.set(id, { xpBefore: before, xpAfter: after, levelBefore: levelOfXp(before), levelAfter: level, bestWave: best?.best_wave ?? p.wavesCleared, bestMs: best?.best_ms ?? ms, newBest });
    }
    return out;
  });
}
