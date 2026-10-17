/** Leaderboard tab: mode and sort pickers, the top 100 table and your own standing. */
import { ApiError, fetchLeaderboard, fetchMe, type Standing } from './api.ts';
import { COPY } from './copy.ts';
import { h } from './dom.ts';
import { loadIdentity } from './identity.ts';

type Mode = keyof typeof COPY.leaderboard.modes;
type Sort = keyof typeof COPY.leaderboard.sorts;

const L = COPY.leaderboard;

function segmented<T extends string>(label: string, options: Record<T, string>, current: T, onPick: (v: T) => void): HTMLElement {
  const group = h('div', { class: 'qm-seg', role: 'radiogroup', 'aria-label': label });
  const buttons: HTMLButtonElement[] = [];
  for (const [value, text] of Object.entries(options) as [T, string][]) {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': value === current ? 'true' : 'false', tabindex: value === current ? 0 : -1 }, text);
    b.addEventListener('click', () => {
      for (const x of buttons) {
        x.setAttribute('aria-checked', x === b ? 'true' : 'false');
        x.tabIndex = x === b ? 0 : -1;
      }
      onPick(value);
    });
    buttons.push(b);
    group.append(b);
  }
  group.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]!;
    next.focus();
    next.click();
  });
  return group;
}

export class LeaderboardPanel {
  readonly el: HTMLElement;
  private mode: Mode = 'all';
  private sort: Sort = 'score';
  private readonly body: HTMLElement;
  private readonly me: HTMLElement;
  private seq = 0;

  constructor() {
    this.body = h('div', { class: 'qm-lb-body', 'aria-live': 'polite' });
    this.me = h('p', { class: 'qm-lb-me' });
    this.el = h(
      'div',
      { class: 'qm-panel-inner qm-lb' },
      h('div', { class: 'qm-panel-head' }, h('h2', {}, L.heading), h('p', { class: 'qm-sub' }, L.sub)),
      h(
        'div',
        { class: 'qm-lb-controls' },
        segmented(COPY.modes.label, L.modes, this.mode, (m) => {
          this.mode = m;
          void this.load();
        }),
        segmented(COPY.aria.sortBy, L.sorts, this.sort, (s) => {
          this.sort = s;
          void this.load();
        }),
      ),
      this.me,
      this.body,
      h('p', { class: 'qm-fine' }, L.scoring),
    );
  }

  async load(): Promise<void> {
    const seq = ++this.seq;
    this.body.replaceChildren(h('p', { class: 'qm-lb-msg' }, h('span', { class: 'qm-spin', 'aria-hidden': 'true' }), L.loading));
    const id = loadIdentity();
    const mine = id.token ? fetchMe(id.token, this.mode).catch(() => null) : Promise.resolve(null);
    try {
      const data = await fetchLeaderboard(this.mode, this.sort);
      if (seq !== this.seq) return;
      this.body.replaceChildren(data.rows.length ? this.table(data.rows, id.name, id.tag) : h('p', { class: 'qm-lb-msg' }, this.sort === 'kd' && data.total > 0 ? L.ratioNote : L.empty));
    } catch (err) {
      if (seq !== this.seq) return;
      const msg = err instanceof ApiError && err.code === 'unavailable' ? L.unavailable : L.unreachable;
      const retry = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-btn-sm' }, L.retry);
      retry.addEventListener('click', () => void this.load());
      this.body.replaceChildren(h('div', { class: 'qm-lb-msg' }, h('p', {}, msg), retry));
    }
    const me = await mine;
    if (seq !== this.seq) return;
    this.me.textContent = me?.leaderboard ? (me.standing ? L.youPoints(me.standing.rank, me.total, me.standing.score) : L.youUnranked) : '';
  }

  private table(rows: Standing[], myName?: string, myTag?: string): HTMLElement {
    const c = L.cols;
    const head = h('tr', {}, ...[c.rank, c.duck, c.score, c.wins, c.kills, c.kd, c.matches, c.avgPlace].map((t, i) => h('th', { scope: 'col', class: i > 1 ? 'num' : undefined }, t)));
    const tbody = h('tbody');
    for (const r of rows) {
      const isMe = r.name.toLowerCase() === myName?.toLowerCase() && r.tag === myTag;
      const sorted = this.sort;
      tbody.append(
        h(
          'tr',
          { class: [isMe ? 'me' : '', r.rank <= 3 ? `top top${r.rank}` : ''].join(' ').trim() || undefined },
          h('td', { class: 'rank' }, r.rank),
          h('td', { class: 'duck' }, r.name, h('span', { class: 'tag' }, `#${r.tag}`), isMe ? h('span', { class: 'qm-you' }, L.youChip) : null),
          h('td', { class: `num${sorted === 'score' ? ' hot' : ''}` }, r.score),
          h('td', { class: `num${sorted === 'wins' ? ' hot' : ''}` }, r.wins),
          h('td', { class: `num${sorted === 'kills' ? ' hot' : ''}` }, r.kills),
          h('td', { class: `num${sorted === 'kd' ? ' hot' : ''}` }, r.kd.toFixed(2)),
          h('td', { class: 'num' }, r.matches),
          h('td', { class: 'num' }, r.avgPlace.toFixed(1)),
        ),
      );
    }
    return h('div', { class: 'qm-table-wrap', tabindex: 0, role: 'region', 'aria-label': L.heading }, h('table', { class: 'qm-table' }, h('thead', {}, head), tbody));
  }
}
