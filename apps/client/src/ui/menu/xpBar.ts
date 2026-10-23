/**
 * A duck's level and XP bar (the character select's plates and the Play
 * tab's duck card), from its total XP with the shared level curve
 * (`@qwakk/shared/progress`, pure: no game code in the menu). Hunt Season is
 * where XP comes from; the server grants it, the menu only shows it.
 */
import { levelProgress } from '@qwakk/shared/progress';
import type { CharacterView } from '@qwakk/shared/accounts';
import { COPY } from './copy.ts';
import { h } from './dom.ts';

/** The level a duck is at: from its XP (the stored level follows it). */
export function duckLevel(duck: CharacterView): number {
  return Math.max(duck.level, levelProgress(duck.xp).level);
}

export function xpBar(duck: CharacterView, withBest = true): HTMLElement {
  const p = levelProgress(duck.xp);
  const fill = h('span', { class: 'qm-xp-fill', style: `width: ${Math.round(p.share * 100)}%` });
  const bar = h('span', { class: 'qm-xp-bar', role: 'progressbar', 'aria-label': COPY.raid.xpLabel(p.level), 'aria-valuemin': 0, 'aria-valuemax': p.need || 1, 'aria-valuenow': p.need ? p.into : 1 }, fill);
  const text = h('span', { class: 'qm-xp-text' }, p.need ? COPY.raid.xp(p.into, p.need) : COPY.raid.maxLevel);
  const best = withBest && duck.raidBest && duck.raidBest.wave > 0 ? h('span', { class: 'qm-xp-best' }, COPY.raid.best(duck.raidBest.wave)) : null;
  return h('span', { class: 'qm-xp' }, bar, text, best);
}
