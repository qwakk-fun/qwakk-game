/**
 * Moderation: find a player (database), ban or unban, hide or show on the
 * leaderboard; the active bans; IP blocks (server memory only); the extra
 * blocked name words. Kicking happens in a room's player list (dashboard).
 */
import { get, post } from '../api.ts';
import { COPY } from '../copy.ts';
import { clear, h } from '../dom.ts';
import type { Ban, BlockedWord, HiddenPlayer, IpBlock, PlayerRow } from '../types.ts';
import { button, card, confirmDialog, errorText, labeled, toast, when, type Page } from '../ui.ts';
import { banDialog } from './banDialog.ts';

const M = COPY.moderation;

const nameOf = (name: string | null, tag: string | null, id: string): string => (name ? `${name}${tag ? `#${tag}` : ''}` : `${M.unknownName} ${id.slice(0, 8)}`);

export function moderationPage(): Page {
  const results = h('div', { class: 'list' });
  const bansEl = h('div', { class: 'list' });
  const hiddenEl = h('div', { class: 'list' });
  const ipEl = h('div', { class: 'list' });
  const wordsEl = h('div', { class: 'list' });

  async function act(path: string, body: unknown, ask: string | null, after: () => Promise<void>): Promise<void> {
    if (ask && !(await confirmDialog(ask, { danger: true }))) return;
    try {
      await post(path, body);
      toast(COPY.saved);
      await after();
    } catch (err) {
      toast(errorText(err), true);
    }
  }

  // ---- search ----
  const q = h('input', { type: 'search', placeholder: M.searchPlaceholder, maxlength: 40, autocomplete: 'off' });
  let lastQuery = '';
  async function search(): Promise<void> {
    lastQuery = q.value.trim();
    if (!lastQuery) return;
    try {
      const { players } = await get<{ players: PlayerRow[] }>(`players?q=${encodeURIComponent(lastQuery)}`);
      if (players.length === 0) return clear(results, h('p', { class: 'muted' }, M.noResults));
      clear(results, ...players.map((p) => playerItem(p)));
    } catch (err) {
      clear(results, h('p', { class: 'error' }, errorText(err)));
    }
  }
  const refreshAll = async (): Promise<void> => {
    await Promise.all([lastQuery ? search() : Promise.resolve(), loadBans(), loadHidden()]);
  };
  function playerItem(p: PlayerRow): HTMLElement {
    const who = `${p.name}#${p.tag}`;
    return h(
      'div',
      { class: 'item' },
      h('div', { class: 'item-main' }, h('strong', {}, who), p.banned ? h('span', { class: 'badge is-bad' }, M.banned) : null, p.hidden ? h('span', { class: 'badge' }, M.hidden) : null, h('span', { class: 'muted mono small' }, `${p.playerId} · ${M.lastSeen(when(p.lastSeen))}${p.level ? ` · Lv ${p.level}` : ''}${p.feathers !== null && p.feathers !== undefined ? ` · ${p.feathers} Tüy` : ''}`)),
      h(
        'div',
        { class: 'item-actions' },
        p.hidden ? button(M.unhide, () => void act('leaderboard/unhide', { playerId: p.playerId }, null, refreshAll)) : button(M.hide, () => void act('leaderboard/hide', { playerId: p.playerId, reason: '' }, M.hideConfirm(who), refreshAll)),
        p.banned ? button(M.unban, () => void act('bans/remove', { playerId: p.playerId }, M.unbanConfirm(who), refreshAll)) : button(M.ban, () => void banDialog(p.playerId, who).then((ok) => { if (ok) void refreshAll(); }), 'danger'),
      ),
    );
  }
  const searchForm = h('form', { class: 'inline-form' }, q, h('button', { type: 'submit', class: 'btn btn-primary' }, M.search));
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void search();
  });

  // ---- bans ----
  async function loadBans(): Promise<void> {
    try {
      const { bans } = await get<{ bans: Ban[] }>('bans');
      if (bans.length === 0) return clear(bansEl, h('p', { class: 'muted' }, M.noBans));
      clear(
        bansEl,
        ...bans.map((b) => {
          const who = nameOf(b.name, b.tag, b.playerId);
          return h(
            'div',
            { class: 'item' },
            h('div', { class: 'item-main' }, h('strong', {}, who), h('span', { class: 'muted small' }, [b.reason, b.expiresAt ? M.until(when(b.expiresAt)) : M.forever].filter(Boolean).join(' · '))),
            h('div', { class: 'item-actions' }, button(M.unban, () => void act('bans/remove', { playerId: b.playerId }, M.unbanConfirm(who), refreshAll))),
          );
        }),
      );
    } catch (err) {
      clear(bansEl, h('p', { class: 'error' }, errorText(err)));
    }
  }

  // ---- hidden from the leaderboard ----
  async function loadHidden(): Promise<void> {
    try {
      const { hidden } = await get<{ hidden: HiddenPlayer[] }>('leaderboard/hidden');
      if (hidden.length === 0) return clear(hiddenEl, h('p', { class: 'muted' }, M.noHidden));
      clear(
        hiddenEl,
        ...hidden.map((x) =>
          h(
            'div',
            { class: 'item' },
            h('div', { class: 'item-main' }, h('strong', {}, nameOf(x.name, x.tag, x.playerId)), x.reason ? h('span', { class: 'muted small' }, x.reason) : null),
            h('div', { class: 'item-actions' }, button(M.unhide, () => void act('leaderboard/unhide', { playerId: x.playerId }, null, refreshAll))),
          ),
        ),
      );
    } catch (err) {
      clear(hiddenEl, h('p', { class: 'error' }, errorText(err)));
    }
  }

  // ---- IP blocks ----
  const ipInput = h('input', { type: 'text', placeholder: M.ipPlaceholder, maxlength: 64, autocomplete: 'off', inputmode: 'decimal' });
  const ipMinutes = h('input', { type: 'number', min: 1, max: 1440, value: '60', inputmode: 'numeric', 'aria-label': M.minutes });
  async function loadIp(): Promise<void> {
    try {
      const { blocks } = await get<{ blocks: IpBlock[] }>('ipblocks');
      if (blocks.length === 0) return clear(ipEl, h('p', { class: 'muted' }, M.noIp));
      clear(
        ipEl,
        ...blocks.map((b) =>
          h(
            'div',
            { class: 'item' },
            h('div', { class: 'item-main' }, h('strong', { class: 'mono' }, b.masked), h('span', { class: 'muted small' }, `${b.label} · ${M.until(when(b.until))}`)),
            h('div', { class: 'item-actions' }, button(M.unblock, () => void act('ipblocks/remove', { id: b.id }, null, loadIp))),
          ),
        ),
      );
    } catch (err) {
      clear(ipEl, h('p', { class: 'error' }, errorText(err)));
    }
  }
  const ipForm = h('form', { class: 'inline-form' }, ipInput, labeled(M.minutes, ipMinutes), h('button', { type: 'submit', class: 'btn btn-danger' }, M.block));
  ipForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void act('ipblocks/add', { ip: ipInput.value.trim(), minutes: Number(ipMinutes.value) }, null, async () => {
      ipInput.value = '';
      await loadIp();
    });
  });

  // ---- blocked words ----
  const word = h('input', { type: 'text', placeholder: M.wordPlaceholder, maxlength: 24, autocomplete: 'off', pattern: '[a-zA-Z]{3,24}' });
  const whole = h('input', { type: 'checkbox' });
  async function loadWords(): Promise<void> {
    try {
      const { words } = await get<{ words: BlockedWord[] }>('names');
      if (words.length === 0) return clear(wordsEl, h('p', { class: 'muted' }, M.noWords));
      clear(
        wordsEl,
        ...words.map((w) =>
          h(
            'div',
            { class: 'item' },
            h('div', { class: 'item-main' }, h('strong', { class: 'mono' }, w.word), h('span', { class: 'badge' }, w.whole ? M.wholeTag : M.anyTag)),
            h('div', { class: 'item-actions' }, button(M.remove, () => void act('names/remove', { word: w.word }, null, loadWords))),
          ),
        ),
      );
    } catch (err) {
      clear(wordsEl, h('p', { class: 'error' }, errorText(err)));
    }
  }
  const wordForm = h('form', { class: 'inline-form' }, word, h('label', { class: 'check' }, whole, M.whole), h('button', { type: 'submit', class: 'btn btn-primary' }, M.add));
  wordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void act('names/add', { word: word.value.trim().toLowerCase(), whole: whole.checked }, null, async () => {
      word.value = '';
      await loadWords();
    });
  });

  const el = h(
    'div',
    { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', {}, M.title)),
    h('div', { class: 'grid-2' }, card(M.searchTitle, searchForm, results), card(M.bansTitle, bansEl), card(M.hiddenTitle, hiddenEl), card(M.ipTitle, ipForm, ipEl), card(M.namesTitle, h('p', { class: 'muted small' }, M.namesSub), wordForm, wordsEl)),
  );
  void loadBans();
  void loadHidden();
  void loadIp();
  void loadWords();
  return { el };
}
