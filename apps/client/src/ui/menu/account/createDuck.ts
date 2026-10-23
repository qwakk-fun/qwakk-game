/**
 * Hatch a new duck: a name (the same rules as guests, checked again by the
 * server; the #tag is drawn by the server), a look from the character
 * catalog, and a big preview of it (the menu's 3D duck, the portrait first).
 */
import type { CharacterView } from '@qwakk/shared/accounts';
import { CharacterStep } from '../characterStep.ts';
import { CHARACTERS, characterCopy, gameId, type Character } from '../characters.ts';
import { COPY } from '../copy.ts';
import { asset, h } from '../dom.ts';
import { HeroSlot, type HeroModule } from '../heroSlot.ts';
import { NAME_RE, suggestName } from '../identity.ts';
import { errorText } from '../nameStep.ts';
import { createDuck } from './accountApi.ts';

const CR = COPY.create;

export interface CreateHooks {
  token(): string | null;
  created(duck: CharacterView): void;
  back(): void;
}

export class CreateDuck {
  readonly el: HTMLElement;
  private readonly hooks: CreateHooks;
  private readonly input: HTMLInputElement;
  private readonly msg: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private readonly looks: CharacterStep;
  private readonly hero: HeroSlot;
  private readonly img: HTMLImageElement;
  private readonly lookName: HTMLElement;
  private slot: number | undefined;
  private busy = false;
  /** The 3D preview runs only while the form is open. */
  private shown = false;

  constructor(hooks: CreateHooks, loadHero?: () => Promise<HeroModule>) {
    this.hooks = hooks;
    const first = CHARACTERS[0]!;
    this.img = h('img', { src: asset(first.portrait), alt: '', width: 600, height: 600, decoding: 'async' });
    const figure = h('div', { class: 'qm-art-duck qd-create-duck' }, this.img);
    this.hero = new HeroSlot(figure, loadHero, first.id);
    this.lookName = h('span', { class: 'qd-create-look' });
    this.input = h('input', {
      id: 'qd-name',
      class: 'qm-input',
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'done',
      maxlength: 16,
      placeholder: COPY.namePlaceholder,
      'aria-describedby': 'qd-name-hint',
    });
    this.msg = h('p', { class: 'qa-msg', role: 'status', 'aria-live': 'polite' });
    this.submit = h('button', { type: 'submit', class: 'qm-btn qm-btn-yellow qd-hatch' }, CR.submit);
    const back = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost' }, COPY.auth.back);
    back.addEventListener('click', () => this.hooks.back());
    this.looks = new CharacterStep(first.id, (c) => this.preview(c), false);
    const form = h(
      'form',
      { class: 'qm-card qd-create-form', novalidate: true },
      h('h2', { class: 'qd-create-title' }, CR.title),
      h('label', { class: 'qa-label', for: 'qd-name' }, CR.nameLabel),
      this.input,
      h('p', { id: 'qd-name-hint', class: 'qm-fine' }, CR.nameHint),
      h('p', { class: 'qm-fine' }, CR.tagNote),
      h('h3', { class: 'qa-label' }, CR.lookLabel),
      this.looks.el,
      h('div', { class: 'qd-create-actions' }, this.submit, back),
      this.msg,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.hatch();
    });
    this.input.addEventListener('input', () => {
      const v = this.input.value.trim();
      this.say(NAME_RE.test(v) || v === '' ? '' : COPY.errors.name_format!, true);
    });
    this.el = h(
      'div',
      { class: 'qd-create' },
      h('div', { class: 'qd-create-stage', 'aria-hidden': 'true' }, h('div', { class: 'qm-stage-glow' }), h('div', { class: 'qm-stage-figure' }, h('div', { class: 'qm-stage-floor' }), figure), this.lookName),
      form,
    );
    this.preview(first);
  }

  /** Open the form for a slot (or the first free one). */
  open(slot?: number): void {
    this.slot = slot;
    this.input.value = suggestName();
    this.say('');
    this.submit.disabled = false;
    this.shown = true;
    this.hero.setCharacter(this.looks.selected.id);
    this.hero.start();
    if (!matchMedia('(pointer: coarse)').matches) this.input.focus({ preventScroll: true });
  }

  /** Free the 3D preview. */
  close(): void {
    this.shown = false;
    this.hero.stop();
  }

  private preview(c: Character): void {
    this.el.style.setProperty('--qm-char-accent', c.accent);
    this.img.src = asset(c.portrait);
    this.lookName.textContent = characterCopy(c.id).name;
    if (this.shown) this.hero.setCharacter(c.id);
  }

  private say(text: string, error = false): void {
    this.msg.textContent = text;
    this.msg.classList.toggle('is-error', error && text !== '');
  }

  private async hatch(): Promise<void> {
    if (this.busy) return;
    const name = this.input.value.trim();
    if (!NAME_RE.test(name)) {
      this.say(COPY.errors.name_format!, true);
      this.input.focus();
      return;
    }
    const token = this.hooks.token();
    if (!token) return;
    this.busy = true;
    this.submit.disabled = true;
    this.msg.replaceChildren(h('span', { class: 'qm-spin', 'aria-hidden': 'true' }), h('span', {}, CR.hatching));
    try {
      const { character } = await createDuck(token, name, gameId(this.looks.selected.id), this.slot);
      this.say(CR.done(`${character.name}#${character.tag}`));
      this.hooks.created(character);
    } catch (err) {
      this.say(errorText(err), true);
    } finally {
      this.busy = false;
      this.submit.disabled = false;
    }
  }
}
