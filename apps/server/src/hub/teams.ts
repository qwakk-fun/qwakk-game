/**
 * Teams in the hub are parties (party/PartyRoom.ts): an accepted invite puts
 * the invited duck into the inviter's party, or the hub opens a new party
 * for the two of them (the server creates the party room; the inviter joins
 * it first and leads, then the invited duck gets the code). Codes go only to
 * the two ducks involved, from the server, after it checked the invite; the
 * party registry is read by the verified player id, never by anything a
 * client said.
 *
 * Team markers: ducks of one party (2 or more members) carry the same small
 * per-room number, so clients can ring their teammates.
 */
import { HUB } from '@qwakk/shared/hub';
import { PARTY } from '@qwakk/shared';
import type { PartyRegistry } from '../party/registry.ts';

/** A new party the hub opened, waiting for its leader to join it before the others get the code. */
interface Link {
  code: string;
  leaderId: string;
  /** Session ids waiting for the code, with their player ids. */
  members: { sessionId: string; playerId: string }[];
  until: number;
}

export type LinkResult =
  /** Send these sessions this party code now. */
  | { kind: 'send'; code: string; to: string[] }
  | { kind: 'full' }
  | { kind: 'teammates' };

export class HubTeams {
  private readonly registry: PartyRegistry;
  private readonly links: Link[] = [];
  /** Party code to the room's marker number. */
  private readonly markers = new Map<string, number>();
  private nextMarker = 1;

  constructor(registry: PartyRegistry) {
    this.registry = registry;
  }

  /**
   * Plan the party for an accepted invite: the inviter's party when it has
   * one ("send" the code to the invited duck), or null when a new party has
   * to be opened (then call `opened` with its code).
   */
  plan(inviterId: string, inviteeId: string, inviteeSession: string): LinkResult | null {
    const party = this.registry.partyOf(inviterId);
    if (party) {
      if (party.members.includes(inviteeId)) return { kind: 'teammates' };
      if (party.members.length + this.waiting(party.id) >= PARTY.maxSize) return { kind: 'full' };
      return { kind: 'send', code: party.id, to: [inviteeSession] };
    }
    // The inviter's own new party is still being linked: the invited duck waits with it.
    const link = this.links.find((l) => l.leaderId === inviterId);
    if (link) {
      if (link.members.length + 1 >= PARTY.maxSize) return { kind: 'full' };
      if (!link.members.some((m) => m.playerId === inviteeId)) link.members.push({ sessionId: inviteeSession, playerId: inviteeId });
      return { kind: 'send', code: link.code, to: [] };
    }
    return null;
  }

  /** The hub opened party `code` for accepted invites: the leader gets the code now, the invited ducks once the leader is in. */
  opened(code: string, leaderId: string, members: { sessionId: string; playerId: string }[], now: number): void {
    this.links.push({ code, leaderId, members: [...members], until: now + HUB.partyLinkMs });
  }

  private waiting(code: string): number {
    return this.links.find((l) => l.code === code)?.members.length ?? 0;
  }

  /** Is a new party being linked for this leader? */
  linking(leaderId: string): boolean {
    return this.links.some((l) => l.leaderId === leaderId);
  }

  /**
   * Linked parties whose leader has joined (send the code to the waiting
   * ducks) and the ones that ran out of time (tell them it failed).
   */
  poll(now: number): { ready: { code: string; leaderId: string; to: string[] }[]; failed: { leaderId: string; to: string[] }[] } {
    const ready: { code: string; leaderId: string; to: string[] }[] = [];
    const failed: { leaderId: string; to: string[] }[] = [];
    for (let i = this.links.length - 1; i >= 0; i--) {
      const l = this.links[i]!;
      if (this.registry.partyOf(l.leaderId)?.id === l.code) {
        ready.push({ code: l.code, leaderId: l.leaderId, to: l.members.map((m) => m.sessionId) });
        this.links.splice(i, 1);
      } else if (now > l.until) {
        failed.push({ leaderId: l.leaderId, to: l.members.map((m) => m.sessionId) });
        this.links.splice(i, 1);
      }
    }
    return { ready, failed };
  }

  /** A duck left the hub: it no longer waits for a code. */
  forget(sessionId: string): void {
    for (const l of this.links) l.members = l.members.filter((m) => m.sessionId !== sessionId);
  }

  /** The marker of this player (0: no team of 2 or more). Unused codes free their numbers. */
  markerOf(playerId: string | null): number {
    const p = playerId ? this.registry.partyOf(playerId) : null;
    if (!p || p.members.length < 2) return 0;
    let m = this.markers.get(p.id);
    if (m === undefined) {
      const used = new Set(this.markers.values());
      for (let k = 0; k < 255 && used.has(this.nextMarker); k++) this.nextMarker = (this.nextMarker % 255) + 1;
      m = this.nextMarker;
      this.nextMarker = (this.nextMarker % 255) + 1;
      this.markers.set(p.id, m);
    }
    return m;
  }

  /** Drop the marker numbers of parties none of these players is in any more. */
  sweep(playerIds: readonly (string | null)[]): void {
    const live = new Set<string>();
    for (const id of playerIds) {
      const p = id ? this.registry.partyOf(id) : null;
      if (p) live.add(p.id);
    }
    for (const code of [...this.markers.keys()]) if (!live.has(code)) this.markers.delete(code);
  }
}
