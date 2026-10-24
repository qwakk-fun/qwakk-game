/**
 * The menu sheet over Duck Plaza (Esc, or the touch pause button): every
 * function the old main menu had, in one small card. Play (a plain list of
 * the modes, for accessibility and for devices where the plaza cannot draw;
 * the same rules as the portals), Team (the party box: code, link, leave),
 * Leaderboard, Settings, How to play and Account (switch duck, log out, or
 * sign in and change the guest's name). Pure DOM, no game imports.
 */
import { COPY, LINKS } from './copy.ts';
import { h } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import type { GameMode } from './types.ts';

export type SheetTab = 'play' | 'team' | 'leaderboard' | 'settings' | 'howto' | 'account';

const S = COPY.sheet;
const TABS: [SheetTab, IconName, string][] = [
  ['play', 'play', S.modes],
  ['team', 'users', S.team],
  ['leaderboard', 'trophy', S.leaderboard],
  ['settings', 'sliders', S.settings],
  ['howto', 'help', S.howto],
  ['account', 'user', S.account],
];

export interface SheetHooks {
  resume(): void;
  play(mode: GameMode): void;
  tab(tab: SheetTab): void;
}

export interface SheetParts {
  status: HTMLElement;
  /** The live room lists (battle royale and deathmatch rooms), to pick a room by hand. */
  rooms: HTMLElement;
  result: HTMLElement;
  party: HTMLElement;
  leaderboard: HTMLElement;
  settings: HTMLElement;
  howto: HTMLElement;
  account: HTMLElement;
  language: HTMLElement;
  badge: HTMLElement;
}

export class HubSheet {
  readonly root: HTMLElement;
  private readonly hooks: SheetHooks;
  private readonly buttons = new Map<SheetTab, HTMLButtonElement>();
  private readonly panels = new Map<SheetTab, HTMLElement>();
  private readonly modeButtons = new Map<GameMode, HTMLButtonElement>();
  private readonly who: HTMLElement;
  private readonly downNote: HTMLElement;
  private readonly resumeBtn: HTMLButtonElement;
  private current: SheetTab = 'play';

  constructor(hooks: SheetHooks, parts: SheetParts) {
    this.hooks = hooks;
    this.who = h('span', { class: 'qm-sheet-who' });
    this.resumeBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-yellow qm-btn-sm qm-sheet-resume' }, COPY.sheet.resume);
    this.resumeBtn.addEventListener('click', () => hooks.resume());
    const bar = h('nav', { class: 'qm-sheet-tabs', role: 'tablist', 'aria-label': COPY.aria.tabs });
    const body = h('div', { class: 'qm-sheet-body' });
    this.downNote = h('p', { class: 'qm-sheet-down', hidden: true }, S.plazaDown);

    const modes = h('div', { class: 'qm-sheet-modes' });
    const R = COPY.hub.portals;
    for (const [mode, ic] of [['dm', 'target'], ['br', 'crown'], ['raid', 'tower']] as [GameMode, IconName][]) {
      const b = h('button', { type: 'button', class: 'qm-sheet-mode', 'data-mode': mode }, h('span', { class: 'qm-card-icon', 'aria-hidden': 'true' }, icon(ic)), h('span', { class: 'qm-sheet-mode-text' }, h('b', {}, R[mode].name), h('span', {}, R[mode].sub)), h('span', { class: 'qm-sheet-lock', hidden: true }, icon('lock'), COPY.hub.signIn));
      b.addEventListener('click', () => hooks.play(mode));
      this.modeButtons.set(mode, b);
      modes.append(b);
    }
    const keys = h('dl', { class: 'qm-keys qm-sheet-keys' }, ...S.plazaKeys.flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)]));

    const content: Record<SheetTab, HTMLElement> = {
      play: h('div', { class: 'qm-sheet-play' }, parts.status, parts.result, this.downNote, modes, h('p', { class: 'qm-fine' }, S.modesNote), parts.rooms),
      team: h('div', { class: 'qm-sheet-team' }, h('p', { class: 'qm-sub' }, S.teamNote), parts.party),
      leaderboard: parts.leaderboard,
      settings: h('div', {}, parts.settings, h('div', { class: 'qm-sheet-lang' }, parts.language)),
      howto: h('div', {}, h('section', { class: 'qm-card' }, h('h3', {}, COPY.hub.title), keys), parts.howto),
      account: parts.account,
    };
    for (const [tab, ic, label] of TABS) {
      const b = h('button', { type: 'button', role: 'tab', class: 'qm-sheet-tab', 'aria-selected': 'false' }, icon(ic), h('span', {}, label));
      b.addEventListener('click', () => this.select(tab));
      this.buttons.set(tab, b);
      bar.append(b);
      const panel = h('section', { class: `qm-sheet-panel qm-sheet-${tab}-panel`, role: 'tabpanel', hidden: true }, content[tab]);
      this.panels.set(tab, panel);
      body.append(panel);
    }
    const close = h('button', { type: 'button', class: 'qm-sheet-x', 'aria-label': COPY.sheet.resume }, '×');
    close.addEventListener('click', () => hooks.resume());
    const card = h(
      'div',
      { class: 'qm-sheet-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'qm-sheet-title' },
      h('header', { class: 'qm-sheet-head' }, h('h2', { id: 'qm-sheet-title' }, S.title), this.who, h('span', { class: 'qm-sheet-grow' }), parts.badge, this.resumeBtn, close),
      bar,
      body,
      h('footer', { class: 'qm-sheet-foot' }, h('a', { href: LINKS.home }, COPY.footer.home), h('a', { href: LINKS.terms }, COPY.footer.terms), h('a', { href: LINKS.privacy }, COPY.footer.privacy), h('a', { href: LINKS.cookies }, COPY.footer.storage)),
    );
    this.root = h('div', { id: 'hub-sheet', class: 'qm qm-sheet', hidden: true }, card);
    // A click on the dim backdrop goes back to the plaza.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) hooks.resume();
    });
    this.root.addEventListener('keydown', (e) => {
      // Esc closes a dialog first (account/dialog.ts), the sheet after.
      if (e.key === 'Escape' && !this.root.querySelector('.qa-dialog')) {
        e.preventDefault();
        e.stopPropagation();
        hooks.resume();
      }
    });
    this.select('play');
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(tab?: SheetTab): void {
    if (!this.root.isConnected) document.body.append(this.root);
    this.root.hidden = false;
    if (tab) this.select(tab);
    else this.select(this.current);
    this.resumeBtn.focus({ preventScroll: true });
  }

  close(): void {
    this.root.hidden = true;
  }

  select(tab: SheetTab): void {
    this.current = tab;
    for (const [t, b] of this.buttons) {
      b.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      this.panels.get(t)!.hidden = t !== tab;
    }
    this.hooks.tab(tab);
  }

  /** Who plays (shown in the head), the guest locks on the mode list, and whether the plaza is down. */
  set(who: string, guest: boolean, plazaDown: boolean): void {
    this.who.textContent = who;
    for (const mode of ['br', 'raid'] as GameMode[]) {
      const b = this.modeButtons.get(mode)!;
      b.classList.toggle('is-locked', guest);
      (b.querySelector('.qm-sheet-lock') as HTMLElement).hidden = !guest;
    }
    this.downNote.hidden = !plazaDown;
    this.resumeBtn.hidden = plazaDown;
  }

  setBusy(on: boolean): void {
    for (const b of this.modeButtons.values()) b.disabled = on;
  }
}
