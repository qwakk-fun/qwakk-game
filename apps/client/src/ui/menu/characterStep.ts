/**
 * Step 2 of the join flow: pick a duck from the catalog (characters.ts). A
 * radio group of cards (portrait, name, line); arrows move the pick like any
 * radio group. The stage (stage.ts) shows the picked duck big, in 3D, and
 * swaps the model when the pick changes.
 */
import { CHARACTERS, characterById, characterCopy, saveCharacter, type Character, type CharacterId } from './characters.ts';
import { COPY } from './copy.ts';
import { asset, h } from './dom.ts';
import { icon } from './icons.ts';

const C = COPY.characters;

export class CharacterStep {
  readonly el: HTMLElement;
  private readonly cards = new Map<CharacterId, HTMLButtonElement>();
  private readonly onPick: (c: Character) => void;
  private current: CharacterId;
  private disabled = false;
  private readonly remember: boolean;

  /** `remember`: keep the pick in this browser (the guest's duck); the create-a-duck form does not. */
  constructor(initial: CharacterId, onPick: (c: Character) => void, remember = true) {
    this.current = initial;
    this.onPick = onPick;
    this.remember = remember;
    this.el = h('div', { class: 'qm-chars', role: 'radiogroup', 'aria-label': C.label });
    for (const c of CHARACTERS) {
      const text = characterCopy(c.id);
      const card = h(
        'button',
        { type: 'button', role: 'radio', class: 'qm-char', 'data-character': c.id, style: `--qm-char-accent: ${c.accent}` },
        h('span', { class: 'qm-char-portrait', 'aria-hidden': 'true' }, h('img', { src: asset(c.portrait), alt: '', width: 96, height: 96, decoding: 'async', loading: 'lazy' })),
        h('span', { class: 'qm-char-text' }, h('span', { class: 'qm-char-name' }, text.name), h('span', { class: 'qm-char-blurb' }, text.blurb)),
        h('span', { class: 'qm-char-check', 'aria-hidden': 'true' }, icon('check')),
      );
      card.addEventListener('click', () => this.pick(c.id));
      this.cards.set(c.id, card);
      this.el.append(card);
    }
    this.el.addEventListener('keydown', (e) => {
      const ids = [...this.cards.keys()];
      const i = ids.indexOf(this.current);
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step || i < 0 || this.disabled) return;
      e.preventDefault();
      const next = ids[(i + step + ids.length) % ids.length]!;
      this.pick(next);
      this.cards.get(next)?.focus();
    });
    this.render();
  }

  get selected(): Character {
    return characterById(this.current) ?? CHARACTERS[0]!;
  }

  setDisabled(on: boolean): void {
    this.disabled = on;
    for (const card of this.cards.values()) card.disabled = on;
  }

  private pick(id: CharacterId): void {
    if (this.disabled) return;
    const changed = id !== this.current;
    this.current = id;
    if (this.remember) saveCharacter(id);
    this.render();
    if (changed) this.onPick(this.selected);
  }

  private render(): void {
    for (const [id, card] of this.cards) {
      const on = id === this.current;
      card.setAttribute('aria-checked', on ? 'true' : 'false');
      card.tabIndex = on ? 0 : -1;
      card.classList.toggle('is-on', on);
    }
  }
}
