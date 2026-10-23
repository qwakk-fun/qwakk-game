/**
 * The menu's tabs (Play, Leaderboard, Settings, How to play, Account): a tab list with
 * icons and the panels it shows. Arrow keys, Home and End move between tabs.
 * On phones held upright the CSS docks the list at the bottom like an app bar.
 */
import { COPY } from './copy.ts';
import { h } from './dom.ts';
import { icon, type IconName } from './icons.ts';

export type Tab = 'play' | 'leaderboard' | 'settings' | 'howto' | 'account';

const ICON: Record<Tab, IconName> = { play: 'play', leaderboard: 'trophy', settings: 'sliders', howto: 'help', account: 'user' };

export class Tabs {
  readonly bar: HTMLElement;
  readonly main: HTMLElement;
  private readonly tabs = new Map<Tab, { button: HTMLButtonElement; panel: HTMLElement }>();
  private readonly onSelect: (tab: Tab) => void;

  constructor(panels: [Tab, HTMLElement][], onSelect: (tab: Tab) => void) {
    this.onSelect = onSelect;
    this.bar = h('nav', { class: 'qm-tabs', role: 'tablist', 'aria-label': COPY.aria.tabs });
    this.main = h('main', { class: 'qm-main' });
    for (const [tab, content] of panels) {
      const button = h('button', { type: 'button', role: 'tab', id: `qm-tab-${tab}`, 'aria-controls': `qm-panel-${tab}` }, icon(ICON[tab]), h('span', { class: 'qm-tab-label' }, COPY.tabs[tab]));
      const panel = h('section', { id: `qm-panel-${tab}`, class: `qm-panel qm-panel-${tab}`, role: 'tabpanel', 'aria-labelledby': `qm-tab-${tab}`, tabindex: tab === 'play' ? undefined : -1 }, content);
      button.addEventListener('click', () => this.select(tab));
      this.tabs.set(tab, { button, panel });
      this.bar.append(button);
      this.main.append(panel);
    }
    this.bar.addEventListener('keydown', (e) => {
      const order = [...this.tabs.keys()];
      const i = order.findIndex((t) => this.tabs.get(t)!.button === document.activeElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % order.length;
      else if (e.key === 'ArrowLeft') j = (i + order.length - 1) % order.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = order.length - 1;
      if (j < 0) return;
      e.preventDefault();
      this.select(order[j]!);
      this.tabs.get(order[j]!)!.button.focus();
    });
  }

  select(tab: Tab): void {
    for (const [t, { button, panel }] of this.tabs) {
      const on = t === tab;
      button.setAttribute('aria-selected', on ? 'true' : 'false');
      button.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    }
    this.onSelect(tab);
  }
}
