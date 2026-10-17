/**
 * The menu's news line and the server's live rules (GET /api/status): a
 * banner from the server operators, the maintenance note, and the numbers
 * the room lists show (rooms at once, the start rule, open deathmatch rooms,
 * team modes). Read when the menu opens and once a minute while it is up.
 * The text is the server's (plain text, never HTML); the fallback lines are
 * in copy.ts.
 */
import type { LiveRules, ServerStatus } from '@qwakk/shared/lobby';
import { fetchStatus } from './api.ts';
import { COPY } from './copy.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

const POLL_MS = 60_000;

export class StatusBar {
  readonly el: HTMLElement;
  private readonly text: HTMLElement;
  private readonly onRules: (rules: LiveRules, maintenance: boolean) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;

  constructor(onRules: (rules: LiveRules, maintenance: boolean) => void) {
    this.onRules = onRules;
    this.text = h('span', { class: 'qm-notice-text' });
    this.el = h('div', { class: 'qm-notice', role: 'status', 'aria-label': COPY.notice.label, hidden: true }, h('span', { class: 'qm-notice-icon', 'aria-hidden': 'true' }, icon('radio')), this.text);
  }

  start(): void {
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
  }

  stop(): void {
    this.seq++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async refresh(): Promise<void> {
    const seq = ++this.seq;
    let s: ServerStatus;
    try {
      s = await fetchStatus();
    } catch {
      return; // Unreachable: keep what the menu shows (the defaults).
    }
    if (seq !== this.seq || !s || typeof s !== 'object') return;
    this.render(s);
    if (s.rules) this.onRules(s.rules, s.maintenance === true);
  }

  private render(s: ServerStatus): void {
    const line = s.maintenance ? (s.maintenanceMessage || COPY.notice.maintenance) : s.banner;
    this.el.classList.toggle('is-maintenance', s.maintenance === true);
    this.el.hidden = !line;
    this.text.textContent = line ?? '';
  }
}
