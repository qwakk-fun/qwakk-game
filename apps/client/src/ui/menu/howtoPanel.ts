/** How to play tab: the rules in one line, the keys and the touch controls (phones and tablets see theirs first). */
import { isTouchOnly } from '../../input/touch/device.ts';
import { COPY } from './copy.ts';
import { h } from './dom.ts';

const H = COPY.howto;

export function howtoPanel(): HTMLElement {
  const keyboard = h(
    'section',
    { class: 'qm-card qm-howto-keys' },
    h('dl', { class: 'qm-keys' }, ...H.keys.flatMap(([k, v]) => [h('dt', {}, ...k.split(' ').map((part) => (part === '/' ? ' / ' : h('kbd', {}, part)))), h('dd', {}, v)])),
  );
  const touch = h(
    'section',
    { class: 'qm-card qm-howto-touch' },
    h('div', { class: 'qm-panel-head' }, h('h3', {}, H.touchHeading), h('p', { class: 'qm-sub' }, H.touchIntro)),
    h('dl', { class: 'qm-keys qm-keys-touch' }, ...H.touch.flatMap(([k, v]) => [h('dt', {}, ...k.split(' / ').flatMap((part, i) => (i > 0 ? [' / ', h('kbd', {}, part)] : [h('kbd', {}, part)]))), h('dd', {}, v)])),
  );
  return h(
    'div',
    { class: 'qm-panel-inner qm-howto' },
    h('div', { class: 'qm-panel-head' }, h('h2', {}, H.heading), h('p', { class: 'qm-sub' }, H.intro)),
    ...(isTouchOnly() ? [touch, keyboard] : [keyboard, touch]),
    h('p', { class: 'qm-fine' }, H.fair),
  );
}
