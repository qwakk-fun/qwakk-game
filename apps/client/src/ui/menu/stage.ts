/**
 * The Play tab's stage: the picked duck big (the portrait image paints first,
 * then the 3D duck that aims at the cursor fades in over it, heroSlot.ts) on a
 * lit platform, with a name plate: the duck's name and yours with your #tag.
 * Decorative for screen readers: the steps say the same in words.
 */
import type { Character } from './characters.ts';
import { characterCopy } from './characters.ts';
import { COPY } from './copy.ts';
import { asset, h } from './dom.ts';
import { HeroSlot, type HeroModule } from './heroSlot.ts';

export class Stage {
  readonly el: HTMLElement;
  readonly hero: HeroSlot;
  private readonly img: HTMLImageElement;
  private readonly charName: HTMLElement;
  private readonly player: HTMLElement;
  private readonly playerTag: HTMLElement;

  constructor(character: Character, loadHero?: () => Promise<HeroModule>) {
    this.img = h('img', { src: asset(character.portrait), alt: '', width: 800, height: 800, decoding: 'async', fetchpriority: 'high' });
    const duck = h('div', { class: 'qm-art-duck' }, this.img);
    this.hero = new HeroSlot(duck, loadHero, character.id);
    this.charName = h('span', { class: 'qm-plate-char' });
    this.player = h('span', { class: 'qm-plate-name' });
    this.playerTag = h('span', { class: 'qm-plate-tag' });
    this.el = h(
      'div',
      { class: 'qm-stage', 'aria-hidden': 'true' },
      h('div', { class: 'qm-stage-rings' }),
      h('div', { class: 'qm-stage-glow' }),
      h('div', { class: 'qm-stage-figure' }, h('div', { class: 'qm-stage-floor' }), duck),
      h('div', { class: 'qm-plate' }, h('span', { class: 'qm-plate-kicker' }, COPY.characters.preview), this.charName, h('span', { class: 'qm-plate-player' }, this.player, this.playerTag)),
    );
    this.setCharacter(character);
  }

  setCharacter(c: Character): void {
    this.el.style.setProperty('--qm-char-accent', c.accent);
    this.charName.textContent = characterCopy(c.id).name;
    const src = asset(c.portrait);
    if (this.img.getAttribute('src') !== src) this.img.src = src;
    this.hero.setCharacter(c.id);
  }

  /** Your name and #tag on the plate (null tag: not given yet). */
  setPlayer(name: string, tag: string | null): void {
    this.player.textContent = name || COPY.namePlaceholder;
    this.playerTag.textContent = tag ?? '';
  }
}
