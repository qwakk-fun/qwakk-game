/**
 * A party: up to PARTY.maxSize friends grouped in the menu before a match.
 * One Colyseus room per party, private (never listed, never found by join or
 * Quick Play), with the party code as its room id, so friends join it by
 * code or by the share link (`joinById`). The matchmaking guard limits party
 * creation and joins by code per IP (brute-forcing codes is slow).
 *
 * No schema state: each member gets the party as a small message (names,
 * tags, who leads, who is in a match), never player ids or tokens. The
 * leader joins a game room the normal way, then tells the party (PartyMsg.Go);
 * the party checks the leader really holds a seat there and sends the room id
 * to the members in the menu, who join it. The game room puts the party on
 * one team (battle royale) or makes them allies (deathmatch) from the
 * registry, by verified player id.
 */
import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { PARTY } from '@qwakk/shared';
import { PartyMsg, type PartyGo, type PartyView } from '@qwakk/shared/lobby';
import { verifySession } from '../meta/index.ts';
import { parties, type PartyHandle } from './registry.ts';

/** Close code for a member dropped because the same player joined another party (or another tab joined this one). */
export const PARTY_KICKED = 4001;

interface Member {
  sessionId: string;
  playerId: string;
  name: string;
  tag: string;
  /** Not signed in (Deathmatch only): shown to the party, checked by the battle royale guard. */
  guest: boolean;
}

type PartyAuth = { playerId: string; name: string; tag: string; account: boolean };

/** Codes of the parties open in this process (a new code never repeats one). */
const openCodes = new Set<string>();

/** A random party code (PARTY.codeLength letters of PARTY.codeAlphabet), unused in this process. */
export function newPartyCode(): string {
  const abc = PARTY.codeAlphabet;
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(PARTY.codeLength));
    let code = '';
    // 256 is not a multiple of the alphabet: redraw the few biased bytes instead of a modulo bias.
    for (const b of bytes) code += abc[b % abc.length];
    if (bytes.some((b) => b >= 256 - (256 % abc.length))) continue;
    if (!openCodes.has(code)) return code;
  }
}

const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export class PartyRoom extends Room {
  override maxClients: number = PARTY.maxSize;
  override maxMessagesPerSecond = 10;
  /** Members in join order: the first one leads. */
  private readonly members: Member[] = [];
  private handle!: PartyHandle;

  override onCreate(): void {
    const code = newPartyCode();
    openCodes.add(code);
    // Our own id (only settable during creation): the code friends type.
    this.roomId = code;
    // Never listed and never picked by join / joinOrCreate: joined by code only.
    void this.setPrivate(true, false);
    this.handle = {
      id: code,
      memberIds: () => this.members.map((m) => m.playerId),
      kick: (playerId) => this.drop(playerId, 'joined another party'),
      changed: () => this.sendViews(),
    };
    this.onMessage(PartyMsg.Go, (client, msg: unknown) => this.go(client, msg));
  }

  override async onAuth(_client: Client, options: { token?: unknown } = {}, _context?: AuthContext): Promise<PartyAuth> {
    const token = typeof options.token === 'string' ? options.token : undefined;
    const who = await verifySession(token);
    if (!who) throw new ServerError(4401, 'invalid session');
    return { playerId: who.playerId, name: who.name, tag: who.tag, account: who.account };
  }

  override onJoin(client: Client, _options: unknown, auth?: PartyAuth): void {
    if (!auth) {
      client.leave(4401, 'invalid session');
      return;
    }
    // The same player again (another tab): the newer one stays.
    this.drop(auth.playerId, 'joined from another tab', false);
    this.members.push({ sessionId: client.sessionId, playerId: auth.playerId, name: auth.name, tag: auth.tag, guest: !auth.account });
    parties.attach(auth.playerId, this.handle);
    parties.setGuest(auth.playerId, !auth.account);
    this.sendViews();
  }

  override onLeave(client: Client): void {
    const i = this.members.findIndex((m) => m.sessionId === client.sessionId);
    if (i < 0) return;
    const [m] = this.members.splice(i, 1);
    if (m && !this.members.some((x) => x.playerId === m.playerId)) parties.detach(m.playerId, this.handle);
    this.sendViews();
  }

  override onDispose(): void {
    openCodes.delete(this.roomId);
    for (const m of this.members) parties.detach(m.playerId, this.handle);
    this.members.length = 0;
  }

  /** Drop a member by player id (and close its connection). */
  private drop(playerId: string, reason: string, notify = true): void {
    const i = this.members.findIndex((m) => m.playerId === playerId);
    if (i < 0) return;
    const [m] = this.members.splice(i, 1);
    if (m) this.clients.getById(m.sessionId)?.leave(PARTY_KICKED, reason);
    if (notify) this.sendViews();
  }

  /**
   * The leader went to a game room: send the members in the menu after it.
   * Only the leader may, only to a room it holds a seat in right now
   * (registry), so a party cannot be sent anywhere else.
   */
  private go(client: Client, msg: unknown): void {
    const leader = this.members[0];
    if (!leader || leader.sessionId !== client.sessionId) return;
    if (!msg || typeof msg !== 'object') return;
    const { mode, roomId } = msg as Partial<PartyGo>;
    if ((mode !== 'br' && mode !== 'dm' && mode !== 'raid') || typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) return;
    if (!parties.isPlaying(leader.playerId, roomId)) return;
    const go: PartyGo = { mode, roomId };
    for (const m of this.members.slice(1)) {
      if (!parties.isPlaying(m.playerId)) this.clients.getById(m.sessionId)?.send(PartyMsg.Go, go);
    }
  }

  /** Each member gets the party as it sees it (`you`), without ids. */
  private sendViews(): void {
    for (const client of this.clients) {
      const view: PartyView = {
        code: this.roomId,
        members: this.members.map((m, i) => ({ name: m.name, tag: m.tag, leader: i === 0, busy: parties.isPlaying(m.playerId), you: m.sessionId === client.sessionId, guest: m.guest })),
      };
      client.send(PartyMsg.View, view);
    }
  }

  /** Tests. */
  get size(): number {
    return this.members.length;
  }
}
