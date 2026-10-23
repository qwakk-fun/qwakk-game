/**
 * Step 1 of the Play tab when signed in: the duck you play as (portrait,
 * name and #tag, look, level) with Switch duck. For a guest the same slot
 * holds the sign-in nudge (Battle Royale needs an account).
 */
import type { CharacterView } from '@qwakk/shared/accounts';
import { characterCopy, characterOfLook } from '../characters.ts';
import { COPY } from '../copy.ts';
import { asset, h } from '../dom.ts';
import { icon } from '../icons.ts';

export class ActiveDuck {
  readonly el: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly name: HTMLElement;
  private readonly meta: HTMLElement;

  constructor(onSwitch: () => void) {
    this.img = h('img', { src: asset('ui/duck-rifle.webp'), alt: '', width: 96, height: 96, decoding: 'async' });
    this.name = h('span', { class: 'qm-active-name' });
    this.meta = h('span', { class: 'qm-active-meta' });
    const sw = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-btn-sm qm-active-switch' }, icon('swap'), COPY.ducks.switch);
    sw.addEventListener('click', onSwitch);
    this.el = h('div', { class: 'qm-active' }, h('span', { class: 'qm-char-portrait qm-active-portrait', 'aria-hidden': 'true' }, this.img), h('span', { class: 'qm-active-text' }, this.name, this.meta), sw);
  }

  set(duck: CharacterView | null): void {
    if (!duck) {
      this.name.textContent = COPY.ducks.pickFirst;
      this.meta.textContent = '';
      return;
    }
    const look = characterOfLook(duck.look);
    this.el.style.setProperty('--qm-char-accent', look.accent);
    this.img.src = asset(look.portrait);
    this.name.replaceChildren(duck.name, h('span', { class: 'qm-active-tag' }, `#${duck.tag}`));
    this.meta.textContent = `${characterCopy(look.id).name} · ${COPY.ducks.level(duck.level)}`;
  }
}

/** The guest's nudge in the Play tab: Battle Royale needs an account. */
export function guestGate(onSignIn: () => void): HTMLElement {
  const btn = h('button', { type: 'button', class: 'qm-btn qm-btn-yellow qm-btn-sm qm-gate-signin' }, icon('user'), COPY.account.signIn);
  btn.addEventListener('click', onSignIn);
  return h('div', { class: 'qm-gate' }, h('span', { class: 'qm-card-icon', 'aria-hidden': 'true' }, icon('lock')), h('span', { class: 'qm-gate-text' }, h('span', { class: 'qm-gate-title' }, COPY.gate.brButton), h('span', { class: 'qm-fine' }, COPY.gate.brNote)), btn);
}
