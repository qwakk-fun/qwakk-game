/**
 * The Play tab's live list of battle royale rooms: label and short id, ducks
 * in / capacity, stage (needs N more, countdown, in progress), Join, and a
 * Create room button. Connected while the menu is up (start/stop); retries
 * on its own with a backoff when the connection drops.
 */
import { shortRoomId, START_RULE, type RoomListing } from '@qwakk/shared/lobby';
import { gameServer } from './api.ts';
import { COPY } from './copy.ts';
import { h } from './dom.ts';
import type { LobbyConnection, LobbyEntry } from './lobbyClient.ts';

export interface RoomsHooks {
  join(roomId: string): void;
  create(): void;
}

const R = COPY.rooms;

function stageText(l: RoomListing): string {
  if (l.stage === 'waiting') return R.waiting(l.need);
  if (l.stage === 'countdown') return R.countdown(l.left);
  return l.stage === 'playing' ? R.playing : R.ended;
}

export class RoomsPanel {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
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

  constructor(hooks: RoomsHooks) {
    this.hooks = hooks;
    this.createBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-btn-sm qm-rooms-create' }, R.create);
    this.createBtn.addEventListener('click', () => this.hooks.create());
    this.list = h('ul', { class: 'qm-rooms-list', 'aria-label': R.heading });
    this.msg = h('p', { class: 'qm-rooms-msg', role: 'status', 'aria-live': 'polite' });
    this.el = h(
      'section',
      { class: 'qm-rooms', 'aria-labelledby': 'qm-rooms-h' },
      h('div', { class: 'qm-rooms-head' }, h('div', {}, h('h2', { id: 'qm-rooms-h' }, R.heading), h('p', { class: 'qm-rooms-rule' }, R.rule(START_RULE.minHumans, START_RULE.countdownSeconds))), this.createBtn),
      this.msg,
      this.list,
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
          this.rooms = rooms;
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
    this.createBtn.disabled = this.busy;
    if (this.live) {
      if (this.rooms.length === 0) this.showMsg(R.empty);
      else this.msg.hidden = true;
    }
    this.list.replaceChildren(...this.rooms.map((r) => this.row(r)));
    this.list.hidden = this.rooms.length === 0;
  }

  private row(r: LobbyEntry): HTMLElement {
    const l = r.listing;
    const full = l.humans >= l.cap;
    const open = !r.locked && !full && (l.stage === 'waiting' || l.stage === 'countdown');
    const join = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-rooms-join', 'aria-label': R.joinLabel(l.label) }, full && !r.locked ? R.full : R.join);
    join.disabled = !open || this.busy;
    join.addEventListener('click', () => this.hooks.join(r.roomId));
    return h(
      'li',
      { class: `qm-room is-${l.stage}`, 'data-room': r.roomId },
      h('div', { class: 'qm-room-name' }, h('span', { class: 'qm-room-label' }, l.label), h('span', { class: 'qm-room-id' }, `#${shortRoomId(r.roomId)}`)),
      h('span', { class: 'qm-room-count', 'aria-label': R.ducksLabel(l.humans, l.cap) }, R.ducks(l.humans, l.cap)),
      h('span', { class: 'qm-room-stage' }, stageText(l)),
      join,
    );
  }
}
