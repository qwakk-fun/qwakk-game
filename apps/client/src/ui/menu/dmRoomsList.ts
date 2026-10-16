/**
 * The Play tab's deathmatch rooms: the three static rooms (DM_ROOMS) with
 * their live human count from the lobby ("Istanbul 3/32") and a Join button.
 * The rooms always exist, so they are listed (and joinable by id) even while
 * the live list is not connected; the count then shows as unknown.
 */
import { DM_ROOMS, DM_RULE } from '@qwakk/shared/lobby';
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

  constructor(join: (roomId: string) => void) {
    this.join = join;
    this.list = h('ul', { class: 'qm-rooms-list qm-dm-list', 'aria-label': D.heading });
    this.el = h(
      'section',
      { class: 'qm-rooms qm-dm-rooms', 'aria-labelledby': 'qm-dm-rooms-h' },
      h('div', { class: 'qm-rooms-head' }, h('div', {}, h('h2', { id: 'qm-dm-rooms-h' }, D.heading), h('p', { class: 'qm-rooms-rule' }, D.rule(DM_RULE.players)))),
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

  private render(): void {
    this.list.replaceChildren(...DM_ROOMS.map((r) => this.row(r.id, r.label)));
  }

  private row(id: string, fallbackLabel: string): HTMLElement {
    const e = this.live.get(id);
    const label = e?.listing.label || fallbackLabel;
    const cap = e?.listing.cap ?? DM_RULE.cap;
    const humans = e?.listing.humans;
    const full = humans !== undefined && humans >= cap;
    const join = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-rooms-join', 'aria-label': D.joinLabel(label) }, full ? D.full : D.join);
    join.disabled = full || this.busy;
    join.addEventListener('click', () => this.join(id));
    const count = humans === undefined ? `${D.unknown}/${cap}` : D.ducks(humans, cap);
    return h(
      'li',
      { class: `qm-room qm-dm-room${humans ? ' has-players' : ''}`, 'data-room': id },
      h('div', { class: 'qm-room-name' }, h('span', { class: 'qm-room-label' }, label)),
      h('span', { class: 'qm-room-count', 'aria-label': humans === undefined ? label : D.ducksLabel(humans, cap) }, count),
      join,
    );
  }
}
