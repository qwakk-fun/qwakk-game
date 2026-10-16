/**
 * Who is in which party, and who is in a match right now: the one place the
 * game rooms and the party rooms meet. Process memory only (one server
 * instance); nothing here is ever sent to a client as is. Game rooms look a
 * joining player up by the player id from its verified session, never by
 * anything the client says, so a client cannot claim a party or a team.
 */

/** What a party room exposes to the registry. */
export interface PartyHandle {
  /** The party code (also the party room's id). */
  readonly id: string;
  /** Player ids of the members connected now, the leader first. */
  memberIds(): string[];
  /** The same player joined another party: drop it here. */
  kick(playerId: string): void;
  /** A member started or finished a match: refresh the members' view. */
  changed(): void;
}

export interface PartyInfo {
  id: string;
  leaderId: string;
  /** Every connected member, the leader first. */
  members: string[];
}

export class PartyRegistry {
  private readonly byPlayer = new Map<string, PartyHandle>();
  /** Game rooms each player holds a seat in (a second tab may be in another room). */
  private readonly playing = new Map<string, Set<string>>();

  /** `playerId` joined `party`; a membership in another party ends. */
  attach(playerId: string, party: PartyHandle): void {
    const old = this.byPlayer.get(playerId);
    this.byPlayer.set(playerId, party);
    if (old && old !== party) old.kick(playerId);
  }

  /** `playerId` left `party` (a later membership elsewhere is kept). */
  detach(playerId: string, party: PartyHandle): void {
    if (this.byPlayer.get(playerId) === party) this.byPlayer.delete(playerId);
  }

  partyOf(playerId: string | null | undefined): PartyInfo | null {
    if (!playerId) return null;
    const p = this.byPlayer.get(playerId);
    if (!p) return null;
    const members = p.memberIds();
    if (!members.includes(playerId)) return null;
    return { id: p.id, leaderId: members[0] ?? playerId, members };
  }

  /** A game room seated this player (`roomId`) or let it go (`seated` false). */
  setPlaying(playerId: string | null | undefined, roomId: string, seated: boolean): void {
    if (!playerId) return;
    let rooms = this.playing.get(playerId);
    if (seated) {
      if (!rooms) this.playing.set(playerId, (rooms = new Set()));
      rooms.add(roomId);
    } else if (rooms) {
      rooms.delete(roomId);
      if (rooms.size === 0) this.playing.delete(playerId);
    }
    this.byPlayer.get(playerId)?.changed();
  }

  /** Is this player in a match right now (any room, or this one)? */
  isPlaying(playerId: string, roomId?: string): boolean {
    const rooms = this.playing.get(playerId);
    if (!rooms) return false;
    return roomId === undefined ? rooms.size > 0 : rooms.has(roomId);
  }

  /** Tests. */
  clear(): void {
    this.byPlayer.clear();
    this.playing.clear();
  }
}

/** The process-wide registry. */
export const parties = new PartyRegistry();
