/**
 * The Play tab's deathmatch rooms: the three static rooms (DM_ROOMS) with
 * their live human count from the lobby ("Kavren 3/32") and a Join button.
 * The rooms always exist, so they are listed (and joinable by id) even while
 * the live list is not connected; the count then shows as unknown.
 */
import { DM_ROOM_CATALOG, DM_ROOMS, DM_RULE } from '@qwakk/shared/lobby';
import { COPY } from './copy.ts';
import { h } from './dom.ts';
import type { LobbyEntry } from './lobbyClient.ts';

const D = COPY.dmRooms;

export class DmRoomsList {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly join: (roomId: string) => void;
  private live = new Map<string, LobbyEntry>();
  private busy = false;
  /** The rooms the server keeps open and their size (GET /api/status; the defaults until it answers). */
  private open: readonly string[] = DM_ROOMS.map((r) => r.id);
  private players: number = DM_RULE.players;
  private cap: number = DM_RULE.cap;
  private readonly ruleEl: HTMLElement;
  private readonly emptyEl: HTMLElement;

  constructor(join: (roomId: string) => void) {
    this.join = join;
    this.list = h('ul', { class: 'qm-rooms-list qm-dm-list', 'aria-label': D.heading });
    this.ruleEl = h('p', { class: 'qm-rooms-rule' }, D.rule(DM_RULE.players));
    this.emptyEl = h('p', { class: 'qm-rooms-msg', hidden: true }, D.none);
    this.el = h(
      'section',
      { class: 'qm-rooms qm-dm-rooms', 'aria-labelledby': 'qm-dm-rooms-h' },
      h('div', { class: 'qm-rooms-head' }, h('div', { class: 'qm-rooms-titles' }, h('h3', { id: 'qm-dm-rooms-h' }, D.heading), this.ruleEl)),
      this.emptyEl,
      this.list,
    );
    this.render();
  }

  /** Live entries from the lobby (deathmatch rooms only); an empty list means not connected. */
  update(entries: readonly LobbyEntry[]): void {
    this.live = new Map(entries.map((e) => [e.roomId, e]));
    this.render();
  }

  setBusy(on: boolean): void {
    this.busy = on;
    this.render();
  }

  /** The server's live rules: which rooms are open, ducks per room, humans per room. */
  setRules(open: readonly string[], players: number, cap: number): void {
    this.open = open;
    this.players = players;
    this.cap = cap;
    this.ruleEl.textContent = D.rule(players);
    this.render();
  }

  private render(): void {
    // The live list knows best (a room opened or closed a moment ago); without it, the server's rules.
    const ids = this.live.size > 0 ? new Set(this.live.keys()) : new Set(this.open);
    const rooms = DM_ROOM_CATALOG.filter((r) => ids.has(r.id));
    this.list.replaceChildren(...rooms.map((r) => this.row(r.id, r.label)));
    this.emptyEl.hidden = rooms.length > 0;
  }

  private row(id: string, fallbackLabel: string): HTMLElement {
    const e = this.live.get(id);
    const label = e?.listing.label || fallbackLabel;
    const cap = e?.listing.cap ?? this.cap;
    const humans = e?.listing.humans;
    const full = humans !== undefined && humans >= cap;
    const join = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-rooms-join', 'aria-label': D.joinLabel(label) }, full ? D.full : D.join);
    join.disabled = full || this.busy;
    join.addEventListener('click', () => this.join(id));
    const count = humans === undefined ? `${D.unknown}/${cap}` : D.ducks(humans, cap);
    return h(
      'li',
      { class: `qm-room qm-dm-room${humans ? ' has-players' : ''}`, 'data-room': id },
      h('span', { class: 'qm-room-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'qm-room-name' }, h('span', { class: 'qm-room-label' }, label)),
      h('div', { class: 'qm-room-meta' }, h('span', { class: 'qm-room-count', 'aria-label': humans === undefined ? label : D.ducksLabel(humans, cap) }, count)),
      join,
    );
  }
}
