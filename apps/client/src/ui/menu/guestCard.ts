/**
 * A guest's duck before Duck Plaza: the nickname with its server-assigned
 * #tag (nameStep.ts) and the look (characterStep.ts), then "Enter Duck
 * Plaza". Shown the first time a browser plays as a guest, and from the menu
 * sheet's "Change name or duck"; a guest with a saved name walks straight
 * into the plaza.
 */
import { CharacterStep } from './characterStep.ts';
import { characterById, loadCharacter } from './characters.ts';
import { COPY } from './copy.ts';
import { asset, h } from './dom.ts';
import { icon } from './icons.ts';
import { NameStep } from './nameStep.ts';

const G = COPY.guestCard;

export class GuestCard {
  readonly el: HTMLElement;
  readonly name: NameStep;
  readonly look: CharacterStep;
  private readonly enterBtn: HTMLButtonElement;
  private readonly onEnter: () => void;

  constructor(hooks: { enter(): void; signIn(): void }) {
    this.onEnter = hooks.enter;
    this.name = new NameStep(() => undefined);
    this.look = new CharacterStep((characterById(loadCharacter()) ?? characterById('classic')!).id, () => undefined);
    this.enterBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-yellow qm-guest-enter' }, G.enter, h('span', { 'aria-hidden': 'true' }, ' →'));
    this.enterBtn.addEventListener('click', () => this.onEnter());
    const signIn = h('button', { type: 'button', class: 'qm-btn qm-btn-quiet qm-btn-sm' }, icon('user'), G.signIn);
    signIn.addEventListener('click', () => hooks.signIn());
    this.el = h(
      'section',
      { class: 'qm-guest', 'aria-labelledby': 'qm-guest-title', hidden: true },
      h(
        'div',
        { class: 'qm-card qm-guest-card' },
        h('div', { class: 'qa-auth-top' }, h('span', { class: 'qa-auth-brand' }, h('img', { src: asset('ui/brand-mark.svg'), alt: '', width: 40, height: 40 }), h('span', {}, 'Qwakk'))),
        h('h1', { id: 'qm-guest-title', class: 'qm-guest-title' }, G.title),
        h('p', { class: 'qa-sub' }, G.sub),
        h('h2', { class: 'qm-guest-step' }, COPY.steps.name),
        this.name.el,
        h('h2', { class: 'qm-guest-step' }, COPY.steps.character),
        this.look.el,
        h('div', { class: 'qm-guest-actions' }, this.enterBtn, signIn),
        h('p', { class: 'qm-fine' }, G.note),
      ),
    );
    // Enter anywhere on the card (the name field too) walks in: caught before the name form's own
    // submit, so the name is saved once (one session request, one guest).
    this.el.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Enter' || e.isComposing || (e.target as HTMLElement).tagName === 'BUTTON') return;
        e.preventDefault();
        e.stopPropagation();
        if (!this.enterBtn.disabled) this.onEnter();
      },
      true,
    );
  }

  show(): void {
    this.el.hidden = false;
    this.setBusy(false);
  }

  hide(): void {
    this.el.hidden = true;
  }

  setBusy(on: boolean): void {
    this.enterBtn.disabled = on;
    this.name.setDisabled(on);
    this.look.setDisabled(on);
  }
}
