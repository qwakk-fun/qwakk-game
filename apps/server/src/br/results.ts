/**
 * Battle royale results for the leaderboard: one row per duck with a correct,
 * unique placement. A duck that died or left keeps the place it had at that
 * moment (alive count then); the winner is 1. Should a match be recorded with
 * ducks still standing (it is not today, but never let a missing place count
 * as a win), they share the places above the fallen, best kills first.
 */
import type { Seat } from '../arena.ts';
import type { BattleRoyale } from './battleRoyale.ts';

export interface ResultRow {
  seat: Seat;
  placement: number;
  kills: number;
  damage: number;
  survivedMs: number;
}

export function brResults(m: BattleRoyale): ResultRow[] {
  const seats = [...m.seats.values()];
  const placed = new Set<number>();
  for (const s of seats) {
    const p = m.placement.get(s.id);
    if (p) placed.add(p);
  }
  // Ducks without a place (still alive when recorded): the free places from the top, best kills first.
  const free: number[] = [];
  for (let p = 1; p <= seats.length; p++) if (!placed.has(p)) free.push(p);
  const unplaced = seats.filter((s) => !m.placement.get(s.id)).sort((a, b) => b.kills - a.kills || b.dealt - a.dealt);
  const fallback = new Map<string, number>();
  unplaced.forEach((s, i) => fallback.set(s.id, free[i] ?? seats.length));
  return seats.map((s) => {
    const r = m.resultOf(s);
    return { seat: s, placement: m.placement.get(s.id) ?? fallback.get(s.id) ?? seats.length, kills: r.kills, damage: r.dealt, survivedMs: Math.round(r.survivedMs) };
  });
}
