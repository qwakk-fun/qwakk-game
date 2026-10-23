/**
 * The Play tab's party box. Out of a party: Create party, or a code (or a
 * pasted link) and Join. In a party: the code, Copy link, who is in it
 * (name#tag, the leader, you, who is in a match) and Leave. A view only: the
 * menu (menu.ts) owns the connection and the rules.
 */
import { PARTY, type PartyView } from '@qwakk/shared/lobby';
import { COPY } from './copy.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

export interface PartyPanelHooks {
  create(): void;
  join(code: string): void;
  leave(): void;
  copyLink(): void;
}

const P = COPY.party;

export class PartyPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly hooks: PartyPanelHooks;
  private view: PartyView | null = null;
  private busy = false;
  private codeValue = '';

  constructor(hooks: PartyPanelHooks) {
    this.hooks = hooks;
    this.body = h('div', { class: 'qm-party-body' });
    this.msg = h('p', { class: 'qm-party-msg', role: 'status', 'aria-live': 'polite', hidden: true });
    this.el = h(
      'section',
      { class: 'qm-card qm-party', 'aria-labelledby': 'qm-party-h' },
      h('div', { class: 'qm-card-head' }, h('span', { class: 'qm-card-icon', 'aria-hidden': 'true' }, icon('users')), h('div', { class: 'qm-rooms-titles' }, h('h2', { id: 'qm-party-h' }, P.heading), h('p', { class: 'qm-rooms-rule' }, P.sub))),
      this.body,
      this.msg,
    );
    this.render();
  }

  /** The party as the server last sent it (null: not in one). */
  set(view: PartyView | null): void {
    this.view = view;
    this.render();
  }

  setBusy(on: boolean): void {
    if (on === this.busy) return;
    this.busy = on;
    this.render();
  }

  /** A line under the box (null clears it); `error` styles it as a problem. */
  message(text: string | null, error = false): void {
    this.msg.hidden = !text;
    this.msg.textContent = text ?? '';
    this.msg.classList.toggle('is-error', error);
  }

  private render(): void {
    const v = this.view;
    if (!v) {
      const input = h('input', {
        class: 'qm-input qm-party-code',
        type: 'text',
        spellcheck: 'false',
        autocomplete: 'off',
        autocapitalize: 'characters',
        enterkeyhint: 'go',
        maxlength: 200,
        placeholder: P.codePlaceholder,
        'aria-label': P.codeLabel,
      });
      input.value = this.codeValue;
      input.addEventListener('input', () => (this.codeValue = input.value));
      const join = h('button', { type: 'submit', class: 'qm-btn qm-btn-sm qm-btn-yellow qm-rooms-join' }, P.join);
      const form = h('form', { class: 'qm-party-join', novalidate: true }, input, join);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!this.busy) this.hooks.join(input.value);
      });
      const create = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-btn-sm qm-party-create' }, icon('plus'), P.create);
      create.addEventListener('click', () => !this.busy && this.hooks.create());
      create.disabled = this.busy;
      join.disabled = this.busy;
      input.disabled = this.busy;
      this.body.replaceChildren(h('div', { class: 'qm-party-start' }, create, h('p', { class: 'qm-party-or' }, h('span', {}, P.or)), form));
      return;
    }
    const me = v.members.find((m) => m.you);
    const copy = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-btn-sm qm-party-copy' }, icon('link'), P.copy);
    copy.addEventListener('click', () => this.hooks.copyLink());
    const leave = h('button', { type: 'button', class: 'qm-btn qm-btn-quiet qm-btn-sm qm-party-leave' }, icon('leave'), P.leave);
    leave.addEventListener('click', () => this.hooks.leave());
    const list = h(
      'ul',
      { class: 'qm-party-list', 'aria-label': P.heading },
      ...v.members.map((m) =>
        h(
          'li',
          { class: `qm-party-member${m.you ? ' is-you' : ''}${m.busy ? ' is-busy' : ''}${m.leader ? ' is-leader' : ''}` },
          h('span', { class: 'qm-party-avatar', 'aria-hidden': 'true' }, m.leader ? icon('crown') : (m.name[0] ?? '?').toUpperCase()),
          h('span', { class: 'qm-party-name' }, m.name, h('span', { class: 'qm-room-id' }, m.tag ? `#${m.tag}` : '')),
          h(
            'span',
            { class: 'qm-party-chips' },
            m.leader ? h('span', { class: 'qm-party-chip is-leader' }, P.leader) : null,
            m.you ? h('span', { class: 'qm-party-chip' }, P.you) : null,
            m.busy ? h('span', { class: 'qm-party-chip is-busy' }, P.busy) : null,
            m.guest ? h('span', { class: 'qm-party-chip is-guest' }, P.guest) : null,
          ),
        ),
      ),
    );
    this.body.replaceChildren(
      h(
        'div',
        { class: 'qm-party-head' },
        h('div', { class: 'qm-party-codebox' }, h('span', { class: 'qm-party-label' }, P.codeLabel), h('span', { class: 'qm-party-codetext', 'data-code': v.code }, v.code)),
        h('span', { class: 'qm-party-count' }, P.count(v.members.length, PARTY.maxSize)),
        copy,
      ),
      list,
      h('p', { class: 'qm-rooms-rule qm-party-hint' }, me?.leader ? P.leaderHint(v.members.length) : P.memberHint),
      leave,
    );
  }
}
