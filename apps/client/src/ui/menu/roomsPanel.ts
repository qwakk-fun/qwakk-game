/**
 * The Play tab's live list of battle royale rooms: label and short id, ducks
 * in / capacity, stage (needs N more, countdown, in progress), Join, and a
 * Create room button. Connected while the menu is up (start/stop); retries
 * on its own with a backoff when the connection drops. The same connection
 * feeds the deathmatch rooms list (dmRoomsList.ts, its own section `dmEl`).
 * The mode picker (Solo, Duo, Squad) sets the team size of a room you create
 * and what Quick Play looks for; modes too small for your party are off, and
 * rooms whose teams cannot take your party cannot be joined.
 */
import { BR_ROOM_CAP, shortRoomId, START_RULE, TEAM_SIZES, teamSizeFor, teamSizeOf, type RoomListing } from '@qwakk/shared/lobby';
import { gameServer } from './api.ts';
import { COPY } from './copy.ts';
import { h } from './dom.ts';
import { DmRoomsList } from './dmRoomsList.ts';
import type { LobbyConnection, LobbyEntry } from './lobbyClient.ts';

export interface RoomsHooks {
  join(roomId: string): void;
  create(): void;
  /** Join a deathmatch room by id. */
  joinDm(roomId: string): void;
}

const R = COPY.rooms;
const M = COPY.modes;

function stageText(l: RoomListing): string {
  if (l.stage === 'waiting') return R.waiting(l.need);
  if (l.stage === 'countdown') return R.countdown(l.left);
  return l.stage === 'playing' ? R.playing : R.ended;
}

export class RoomsPanel {
  readonly el: HTMLElement;
  /** The deathmatch rooms section. */
  readonly dmEl: HTMLElement;
  private readonly dm: DmRoomsList;
  private readonly listEl: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly createBtn: HTMLButtonElement;
  private readonly hooks: RoomsHooks;
  private conn: LobbyConnection | null = null;
  private running = false;
  private busy = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 2000;
  private rooms: LobbyEntry[] = [];
  /** A list arrived on the current connection. */
  private live = false;
  /** Bumped on every start/stop, so a late connect from an old run closes itself. */
  private generation = 0;
  private readonly modeButtons = new Map<number, HTMLButtonElement>();
  private modePick = 1;
  private partySize = 1;

  constructor(hooks: RoomsHooks) {
    this.hooks = hooks;
    this.dm = new DmRoomsList((id) => this.hooks.joinDm(id));
    this.dmEl = this.dm.el;
    this.createBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-btn-sm qm-rooms-create' }, R.create);
    this.createBtn.addEventListener('click', () => this.hooks.create());
    const modes = h('div', { class: 'qm-modes', role: 'radiogroup', 'aria-label': M.label });
    for (const t of TEAM_SIZES) {
      const b = h('button', { type: 'button', class: 'qm-mode', role: 'radio', 'data-team': t }, M.names[t] ?? `${t}`);
      b.addEventListener('click', () => {
        if (t < this.partySize) return;
        this.modePick = t;
        this.render();
      });
      this.modeButtons.set(t, b);
      modes.append(b);
    }
    this.listEl = h('ul', { class: 'qm-rooms-list', 'aria-label': R.heading });
    this.msg = h('p', { class: 'qm-rooms-msg', role: 'status', 'aria-live': 'polite' });
    this.el = h(
      'section',
      { class: 'qm-rooms', 'aria-labelledby': 'qm-rooms-h' },
      h('div', { class: 'qm-rooms-head' }, h('div', {}, h('h2', { id: 'qm-rooms-h' }, R.heading), h('p', { class: 'qm-rooms-rule' }, R.rule(START_RULE.minHumans, START_RULE.countdownSeconds))), h('div', { class: 'qm-rooms-actions' }, modes, this.createBtn)),
      this.msg,
      this.listEl,
    );
    this.render();
  }

  /** Connect (menu shown). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation++;
    this.retryMs = 2000;
    void this.connect();
  }

  /** Disconnect (menu hidden, the game is on). */
  stop(): void {
    this.running = false;
    this.live = false;
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.conn?.close();
    this.conn = null;
  }

  setBusy(on: boolean): void {
    this.busy = on;
    this.dm.setBusy(on);
    this.render();
  }

  /** The team size picked for Create room and Quick Play (never smaller than the party). */
  get mode(): number {
    return Math.max(this.modePick, teamSizeFor(this.partySize));
  }

  /** The live battle royale rooms (empty while not connected) and whether the list is live. */
  get list(): { live: boolean; rooms: readonly LobbyEntry[] } {
    return { live: this.live, rooms: this.rooms };
  }

  /** Your party's size (1 without one): smaller modes switch off, the pick moves up. */
  setPartySize(n: number): void {
    const size = Math.max(1, n);
    if (size === this.partySize) return;
    this.partySize = size;
    if (this.modePick < size) this.modePick = teamSizeFor(size);
    this.render();
  }

  private async connect(): Promise<void> {
    const gen = this.generation;
    this.showMsg(R.connecting);
    try {
      const { connectLobby } = await import('./lobbyClient.ts');
      const conn = await connectLobby(
        gameServer(),
        (rooms) => {
          if (gen !== this.generation) return;
          this.live = true;
          this.rooms = rooms.filter((r) => r.listing.mode !== 'dm');
          this.dm.update(rooms.filter((r) => r.listing.mode === 'dm'));
          this.retryMs = 2000;
          this.render();
        },
        () => {
          if (gen !== this.generation) return;
          this.conn = null;
          this.offline();
        },
      );
      if (gen !== this.generation) {
        conn.close();
        return;
      }
      this.conn = conn;
    } catch (err) {
      if (gen !== this.generation) return;
      console.warn('[menu] room list unavailable', err);
      this.offline();
    }
  }

  private offline(): void {
    this.live = false;
    this.rooms = [];
    this.dm.update([]);
    this.render();
    const retry = h('button', { type: 'button', class: 'qm-link' }, R.retry);
    retry.addEventListener('click', () => {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      void this.connect();
    });
    this.msg.replaceChildren(h('span', {}, `${R.offline} `), retry);
    this.msg.hidden = false;
    if (!this.running) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running) void this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 15_000);
  }

  private showMsg(text: string): void {
    this.msg.textContent = text;
    this.msg.hidden = false;
  }

  private render(): void {
    // Every room this server opens is listed: a new one cannot be created until one closes.
    const atCap = this.live && this.rooms.length >= BR_ROOM_CAP;
    this.createBtn.disabled = this.busy || atCap;
    if (this.live) {
      const anyOpen = this.rooms.some((r) => !r.locked && (r.listing.stage === 'waiting' || r.listing.stage === 'countdown'));
      if (this.rooms.length === 0) this.showMsg(R.empty);
      else if (atCap && !anyOpen) this.showMsg(R.brBusy);
      else this.msg.hidden = true;
    }
    this.listEl.replaceChildren(...this.rooms.map((r) => this.row(r)));
    this.listEl.hidden = this.rooms.length === 0;
    for (const [t, b] of this.modeButtons) {
      const on = t === this.mode;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.classList.toggle('is-on', on);
      b.disabled = this.busy || t < this.partySize;
      b.title = t < this.partySize ? M.tooSmall : '';
    }
  }

  private row(r: LobbyEntry): HTMLElement {
    const l = r.listing;
    const full = l.humans >= l.cap;
    const team = teamSizeOf(l.team);
    // Your whole party must fit on one team there.
    const fits = team >= this.partySize && (l.fit ?? team) >= this.partySize;
    const open = !r.locked && !full && (l.stage === 'waiting' || l.stage === 'countdown');
    const join = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-rooms-join', 'aria-label': R.joinLabel(l.label) }, full && !r.locked ? R.full : open && !fits ? R.noFit : R.join);
    join.disabled = !open || !fits || this.busy;
    join.addEventListener('click', () => this.hooks.join(r.roomId));
    return h(
      'li',
      { class: `qm-room is-${l.stage}`, 'data-room': r.roomId },
      h('div', { class: 'qm-room-name' }, h('span', { class: 'qm-room-label' }, l.label), h('span', { class: 'qm-room-mode' }, M.names[team] ?? ''), h('span', { class: 'qm-room-id' }, `#${shortRoomId(r.roomId)}`)),
      h('span', { class: 'qm-room-count', 'aria-label': R.ducksLabel(l.humans, l.cap) }, R.ducks(l.humans, l.cap)),
      h('span', { class: 'qm-room-stage' }, stageText(l)),
      join,
    );
  }
}
