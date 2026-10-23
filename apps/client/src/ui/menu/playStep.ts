/**
 * Step 3 of the join flow: the battle royale mode (Solo, Duo, Squad), Quick
 * Play (battle royale) and Deathmatch, the status line while a match loads or
 * an error, and on phones the note to turn the phone sideways.
 */
import { COPY } from './copy.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { TeamPicker } from './teamPicker.ts';
import type { GameMode } from './types.ts';

export class PlayStep {
  readonly el: HTMLElement;
  readonly team = new TeamPicker();
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly status: HTMLElement;
  private readonly leaderNote: HTMLElement;
  private readonly brTitle: HTMLElement;
  private readonly brSub: HTMLElement;
  private readonly brGo: HTMLElement;
  private guest = false;

  constructor(touchOnly: boolean, onPlay: (mode: GameMode) => void) {
    this.brTitle = h('span', { class: 'qm-btn-title' }, COPY.playBr);
    this.brSub = h('span', { class: 'qm-btn-sub' }, COPY.playBrSub);
    this.brGo = h('span', { class: 'qm-btn-go', 'aria-hidden': 'true' }, icon('arrow'));
    const br = h('button', { type: 'button', class: 'qm-btn qm-btn-play', 'data-mode': 'br' }, h('span', { class: 'qm-btn-text' }, this.brTitle, this.brSub), this.brGo);
    const dm = h(
      'button',
      { type: 'button', class: 'qm-btn qm-btn-secondary', 'data-mode': 'dm' },
      h('span', { class: 'qm-btn-icon', 'aria-hidden': 'true' }, icon('target')),
      h('span', { class: 'qm-btn-text' }, h('span', { class: 'qm-btn-title' }, COPY.playDm), h('span', { class: 'qm-btn-sub' }, COPY.playDmSub)),
    );
    for (const b of [br, dm]) {
      b.addEventListener('click', () => onPlay(b.dataset.mode as GameMode));
      this.buttons.push(b);
    }
    this.status = h('div', { class: 'qm-status', role: 'status', 'aria-live': 'polite' });
    this.leaderNote = h('p', { class: 'qm-lead-note', hidden: true }, icon('crown'), h('span', {}, COPY.steps.waitLeader));
    this.el = h(
      'div',
      { class: 'qm-play' },
      h('div', { class: 'qm-play-mode' }, h('span', { class: 'qm-play-mode-label' }, COPY.steps.playSub), this.team.el),
      h('div', { class: 'qm-play-buttons' }, br, dm),
      this.leaderNote,
      this.status,
      touchOnly ? h('p', { class: 'qm-mobile', role: 'note' }, icon('phone'), h('span', {}, COPY.touch.menuNote)) : null,
    );
  }

  /** The Quick Play button (focused when the menu opens on desktop). */
  get primary(): HTMLButtonElement {
    return this.buttons[0]!;
  }

  /**
   * A guest: Quick Play turns into "Sign in to play Battle Royale" (the menu
   * opens the sign-in screen when it is pressed) and the team modes rest.
   */
  setGuest(on: boolean): void {
    this.guest = on;
    const br = this.buttons[0]!;
    br.classList.toggle('is-locked', on);
    this.brTitle.textContent = on ? COPY.gate.brButton : COPY.playBr;
    this.brSub.textContent = on ? COPY.gate.brNote : COPY.playBrSub;
    this.brGo.replaceChildren(icon(on ? 'lock' : 'arrow'));
    this.team.setBusy(on);
  }

  /** Busy (a match is loading) or a party member waiting for the leader. */
  lock(busy: boolean, followsLeader: boolean): void {
    for (const b of this.buttons) b.disabled = busy || followsLeader;
    this.team.setBusy(busy || followsLeader || this.guest);
    this.leaderNote.hidden = !followsLeader;
  }

  /** A progress line with a spinner. */
  progress(text: string): void {
    this.status.replaceChildren(h('span', { class: 'qm-spin', 'aria-hidden': 'true' }), h('span', {}, text));
  }

  error(text: string): void {
    this.status.replaceChildren(h('p', { class: 'qm-error' }, text));
  }

  clear(): void {
    this.status.replaceChildren();
  }
}
