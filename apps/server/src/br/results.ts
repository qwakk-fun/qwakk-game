/**
 * Battle royale results for the leaderboard: one row per duck with its
 * team's place (solo: every duck is its own team, so the places are unique).
 * A team that went out keeps the place it had at that moment (teams still in
 * then, plus one); the winners are 1. Should a match be recorded with teams
 * still standing (the last human left before the end), they share the places
 * above the fallen, best kills first, so a missing place never counts as a win.
 */
import type { Seat } from '../arena.ts';
import type { BattleRoyale } from './battleRoyale.ts';

export interface ResultRow {
  seat: Seat;
  placement: number;
  kills: number;
  damage: number;
  survivedMs: number;
  /** Died in this match (a winner who fell before the end counts). */
  died: boolean;
}

export interface BrResults {
  rows: ResultRow[];
  /** Teams in the match (the field the places are out of). */
  field: number;
}

export function brResults(m: BattleRoyale): BrResults {
  const seats = [...m.seats.values()];
  const teamOf = (s: Seat): number => s.team || -s.pid;
  const teams = new Map<number, Seat[]>();
  for (const s of seats) {
    const list = teams.get(teamOf(s)) ?? [];
    list.push(s);
    teams.set(teamOf(s), list);
  }
  const field = teams.size;
  const placeOf = new Map<number, number>();
  const taken = new Set<number>();
  for (const [t, list] of teams) {
    const p = list.map((s) => m.placement.get(s.id) ?? 0).find((x) => x > 0);
    if (p) {
      placeOf.set(t, p);
      taken.add(p);
    }
  }
  const free: number[] = [];
  for (let p = 1; p <= field; p++) if (!taken.has(p)) free.push(p);
  const sum = (list: Seat[], f: (s: Seat) => number): number => list.reduce((n, s) => n + f(s), 0);
  const unplaced = [...teams.entries()]
    .filter(([t]) => !placeOf.has(t))
    .sort(([, a], [, b]) => sum(b, (s) => s.kills) - sum(a, (s) => s.kills) || sum(b, (s) => s.dealt) - sum(a, (s) => s.dealt));
  unplaced.forEach(([t], i) => placeOf.set(t, free[i] ?? field));
  const rows = seats.map((s) => {
    const r = m.resultOf(s);
    return { seat: s, placement: placeOf.get(teamOf(s)) ?? field, kills: r.kills, damage: r.dealt, survivedMs: Math.round(r.survivedMs), died: s.sim.alive === 0 };
  });
  return { rows, field };
}
