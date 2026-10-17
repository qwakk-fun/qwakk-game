/** Audit log: every change made in the panel, newest first, with old and new values. */
import { get } from '../api.ts';
import { COPY } from '../copy.ts';
import { clear, h } from '../dom.ts';
import type { AuditEntry } from '../types.ts';
import { button, card, errorText, shortJson, when, type Page } from '../ui.ts';

const A = COPY.audit;
const PAGE = 50;

export function auditPage(): Page {
  const tbody = h('tbody');
  const note = h('div', {});
  const more = button(A.more, () => void load());
  more.hidden = true;
  let before: number | null = null;

  function change(e: AuditEntry): HTMLElement {
    const o = shortJson(e.old);
    const n = shortJson(e.new);
    if (!o && !n) return h('span', { class: 'muted' }, '');
    return h('span', { class: 'mono small' }, o ? h('span', { class: 'old' }, o) : null, o && n ? h('span', { class: 'arrow' }, ' -> ') : null, n ? h('span', { class: 'new' }, n) : null);
  }

  async function load(): Promise<void> {
    try {
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (before !== null) q.set('before', String(before));
      const { entries, persistent } = await get<{ entries: AuditEntry[]; persistent: boolean }>(`audit?${q}`);
      if (!persistent) clear(note, h('div', { class: 'banner is-warn' }, COPY.notSaved));
      if (before === null && entries.length === 0) tbody.append(h('tr', {}, h('td', { colspan: 4, class: 'muted' }, A.empty)));
      for (const e of entries)
        tbody.append(
          h(
            'tr',
            {},
            h('td', { 'data-label': A.cols.when, class: 'nowrap' }, when(e.at)),
            h('td', { 'data-label': A.cols.who, class: 'mono small' }, e.actor),
            h('td', { 'data-label': A.cols.what }, h('strong', {}, e.action), e.target ? h('div', { class: 'muted small' }, e.target) : null),
            h('td', { 'data-label': A.cols.change }, change(e)),
          ),
        );
      const last = entries[entries.length - 1];
      if (last) before = last.id;
      more.hidden = entries.length < PAGE;
    } catch (err) {
      clear(note, h('p', { class: 'error' }, errorText(err)));
    }
  }

  const table = h('table', { class: 'table stacked' }, h('thead', {}, h('tr', {}, h('th', {}, A.cols.when), h('th', {}, A.cols.who), h('th', {}, A.cols.what), h('th', {}, A.cols.change))), tbody);
  const el = h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h1', {}, A.title), h('span', { class: 'muted' }, A.sub)), note, card(null, table, more));
  void load();
  return { el };
}
