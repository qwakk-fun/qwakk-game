/**
 * The party side of the menu: create, join by code or share link, leave, copy
 * the link, and the party room's updates. Owns the connection (partyClient.ts,
 * loaded on demand) and feeds the box (partyPanel.ts); the menu hears about
 * changes through the hooks and decides what they mean for Play.
 */
import { LOBBY_ERROR, partyCodeOf, type PartyGo, type PartyView } from '@qwakk/shared/lobby';
import { ApiError, gameServer } from './api.ts';
import { COPY } from './copy.ts';
import type { PartyConnection } from './partyClient.ts';
import { PartyPanel } from './partyPanel.ts';
import type { GameMode } from './types.ts';

/** The party connection closes with this when the same player joined another party (server PartyRoom.PARTY_KICKED). */
const PARTY_KICKED = 4001;

const P = COPY.party;

export interface PartyControllerHooks {
  /** A session token (the name must be valid): a token, undefined (dev without the meta API), or null (no: a message is up). */
  token(): Promise<string | null | undefined>;
  /** The party view changed (joined, left, members). */
  changed(): void;
  /** The leader went into a room: follow, if the menu is up and idle. */
  follow(g: PartyGo, leaderName: string): void;
  /** The menu is starting a match (the party box stays locked meanwhile). */
  busy(): boolean;
}

export class PartyController {
  readonly panel: PartyPanel;
  private readonly hooks: PartyControllerHooks;
  private conn: PartyConnection | null = null;
  private current: PartyView | null = null;

  constructor(hooks: PartyControllerHooks) {
    this.hooks = hooks;
    this.panel = new PartyPanel({
      create: () => void this.create(),
      join: (code) => void this.join(code),
      leave: () => this.leave(),
      copyLink: () => void this.copyLink(),
    });
  }

  /** The party as the server last sent it (null: not in one). */
  get view(): PartyView | null {
    return this.current;
  }

  /** A party member who is not the leader waits for the leader: no Play, no room picks. */
  get followsLeader(): boolean {
    const v = this.current;
    return !!v && v.members.length > 1 && !v.members.find((m) => m.you)?.leader;
  }

  /** Ducks that would come along: the party members not in a match (you included), or 1. */
  get size(): number {
    const v = this.current;
    return v ? Math.max(1, v.members.filter((m) => m.you || !m.busy).length) : 1;
  }

  /** After the leader joined a room: tell the party, so the members in the menu follow. */
  went(mode: GameMode, roomId: string): void {
    const v = this.current;
    if (this.conn && v && v.members.length > 1 && v.members.find((m) => m.you)?.leader) this.conn.went({ mode, roomId });
  }

  private set(view: PartyView | null): void {
    this.current = view;
    this.panel.set(view);
    this.hooks.changed();
  }

  private connHooks() {
    return {
      view: (v: PartyView) => this.set(v),
      go: (g: PartyGo) => this.hooks.follow(g, this.current?.members[0]?.name ?? ''),
      dropped: (code: number) => {
        this.conn = null;
        this.set(null);
        this.panel.message(code === PARTY_KICKED ? P.moved : P.closed, code !== PARTY_KICKED);
      },
    };
  }

  async create(): Promise<void> {
    if (this.conn) return;
    this.panel.setBusy(true);
    this.panel.message(P.creating);
    try {
      const token = await this.hooks.token();
      if (token === null) return;
      const { createParty } = await import('./partyClient.ts');
      this.conn = await createParty(gameServer(), token, this.connHooks());
      this.panel.message(null);
    } catch (err) {
      console.warn('[menu] party create failed', err);
      const code = (err as { code?: number } | null)?.code ?? 0;
      this.panel.message(code === LOBBY_ERROR.createLimited ? P.limited : P.failed, true);
    } finally {
      this.panel.setBusy(this.hooks.busy());
    }
  }

  async join(raw: string): Promise<void> {
    const code = partyCodeOf(raw);
    if (!code) {
      this.panel.message(P.badCode, true);
      return;
    }
    if (this.conn?.code === code) return;
    this.panel.setBusy(true);
    this.panel.message(P.joining);
    try {
      const token = await this.hooks.token();
      if (token === null) return;
      const { joinParty } = await import('./partyClient.ts');
      const conn = await joinParty(gameServer(), code, token, this.connHooks());
      this.conn?.leave();
      this.conn = conn;
      this.panel.message(null);
    } catch (err) {
      console.warn('[menu] party join failed', err);
      const c = (err as { code?: number } | null)?.code ?? 0;
      this.panel.message(c === 522 ? P.notFound : c === LOBBY_ERROR.joinLimited ? P.limited : P.failed, true);
    } finally {
      this.panel.setBusy(this.hooks.busy());
    }
  }

  leave(): void {
    this.conn?.leave();
    this.conn = null;
    this.panel.message(null);
    this.set(null);
  }

  private async copyLink(): Promise<void> {
    const code = this.current?.code;
    if (!code) return;
    const link = `${location.origin}${location.pathname}?party=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      this.panel.message(P.copied);
    } catch {
      this.panel.message(P.copyFailed, true);
    }
  }
}

/** Dev without the meta API: the server hands out a guest identity, so a party works without a token. */
export function devWithoutApi(err: unknown): boolean {
  return import.meta.env.DEV && err instanceof ApiError && err.code === 'unreachable';
}
