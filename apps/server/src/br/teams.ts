/**
 * Battle royale teams: who plays on which team, and the seats a team holds
 * for party members who follow their leader into the room. Pure bookkeeping
 * (no network, no sim), unit tested on its own.
 *
 *   - BR.players / size teams (solo: 16 teams of 1, duo: 8 of 2, squad: 4 of 4)
 *   - a party is one team: its first member to arrive picks a team with room
 *     for every member who may follow (online, not in another match) and
 *     holds their seats for PARTY.reserveSeconds; the others land on it
 *   - a duck on its own fills the fullest team that still has a free seat
 *     (strangers make a team; held seats are never taken)
 *   - when the match starts the holds go; bots fill every empty seat
 */

/** Who wants a seat: a party (its id and the members who may follow) or a duck on its own. */
export interface TeamGroup {
  playerId: string | null;
  partyId: string | null;
  /** Other party members (player ids) to hold seats for. */
  followers: string[];
}

export type TeamRefusal = 'party-too-big' | 'no-team';

export class TeamBook {
  readonly size: number;
  readonly count: number;
  private readonly seats: Set<string>[];
  private readonly teamOfSeat = new Map<string, number>();
  private readonly partyTeam = new Map<string, number>();
  /** Per team: held seats, player id to the tick the hold runs out. */
  private readonly holds: Map<string, number>[];

  constructor(players: number, size: number) {
    this.size = Math.max(1, Math.floor(size));
    this.count = Math.max(1, Math.floor(players / this.size));
    this.seats = Array.from({ length: this.count }, () => new Set<string>());
    this.holds = Array.from({ length: this.count }, () => new Map<string, number>());
  }

  /** Team of a seat (1-based), 0 when it has none. */
  teamOf(seatId: string): number {
    return this.teamOfSeat.get(seatId) ?? 0;
  }

  members(team: number): string[] {
    return [...(this.seats[team - 1] ?? [])];
  }

  /** Seats still open in a team (members and live holds are taken). */
  free(team: number, tick: number): number {
    return this.size - (this.seats[team - 1]?.size ?? this.size) - this.held(team, tick);
  }

  private held(team: number, tick: number): number {
    let n = 0;
    for (const until of this.holds[team - 1]?.values() ?? []) if (until > tick) n++;
    return n;
  }

  /** The most ducks one team can still take (the lobby listing's `fit`). */
  fit(tick: number): number {
    let best = 0;
    for (let t = 1; t <= this.count; t++) best = Math.max(best, this.free(t, tick));
    return best;
  }

  /** Teams with at least one seat taken. */
  get used(): number {
    return this.seats.filter((s) => s.size > 0).length;
  }

  /** The team this group would get now, or why not. Nothing changes. */
  place(g: TeamGroup, tick: number): number | TeamRefusal {
    if (g.partyId) {
      const t = this.partyTeam.get(g.partyId);
      if (t !== undefined) {
        const until = g.playerId ? this.holds[t - 1]?.get(g.playerId) : undefined;
        if ((until !== undefined && until > tick) || this.free(t, tick) > 0) return t;
        return 'no-team';
      }
    }
    const need = 1 + (g.partyId ? g.followers.length : 0);
    if (need > this.size) return 'party-too-big';
    // The fullest team that still fits the group: strangers team up before new teams open.
    let best = 0;
    let bestFill = -1;
    for (let t = 1; t <= this.count; t++) {
      if (this.free(t, tick) < need) continue;
      const fill = this.seats[t - 1]!.size + this.held(t, tick);
      if (fill > bestFill) {
        best = t;
        bestFill = fill;
      }
    }
    return best > 0 ? best : 'no-team';
  }

  /** Seat `seatId` on `team`; a party's first arrival holds seats for its followers until `holdUntil`. */
  assign(seatId: string, team: number, g: TeamGroup | null, holdUntil: number): void {
    this.remove(seatId);
    this.seats[team - 1]?.add(seatId);
    this.teamOfSeat.set(seatId, team);
    const holds = this.holds[team - 1];
    if (!g || !holds) return;
    if (g.playerId) holds.delete(g.playerId);
    if (g.partyId && !this.partyTeam.has(g.partyId)) {
      this.partyTeam.set(g.partyId, team);
      for (const p of g.followers) holds.set(p, holdUntil);
    }
  }

  /** A seat left (warm-up): its place is free again; a team nobody holds forgets its party. */
  remove(seatId: string): void {
    const t = this.teamOfSeat.get(seatId);
    if (t === undefined) return;
    this.teamOfSeat.delete(seatId);
    this.seats[t - 1]?.delete(seatId);
    if (this.seats[t - 1]?.size === 0 && this.holds[t - 1]?.size === 0) {
      for (const [party, team] of this.partyTeam) if (team === t) this.partyTeam.delete(party);
    }
  }

  /** Drop holds that ran out (and every hold once the match starts: `all`). */
  expire(tick: number, all = false): void {
    for (let t = 1; t <= this.count; t++) {
      const holds = this.holds[t - 1]!;
      for (const [p, until] of holds) if (all || until <= tick) holds.delete(p);
      if (holds.size === 0 && this.seats[t - 1]!.size === 0) for (const [party, team] of this.partyTeam) if (team === t) this.partyTeam.delete(party);
    }
  }
}
