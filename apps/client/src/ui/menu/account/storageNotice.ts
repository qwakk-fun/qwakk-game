/**
 * The storage notice (docs/legal/cookies.md): the game keeps only what it
 * needs in local storage, so the banner only informs. One OK button and a
 * link; OK remembers the legal version (`qwakk.storage-notice`) and the
 * banner comes back only when the notice changes. It never blocks play.
 */
import { LEGAL_VERSION } from '@qwakk/shared/accounts';
import { COPY, LINKS } from '../copy.ts';
import { h } from '../dom.ts';

const KEY = 'qwakk.storage-notice';

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === LEGAL_VERSION;
  } catch {
    return false;
  }
}

/** Show the banner once (per notice version) inside `host`. */
export function showStorageNotice(host: HTMLElement): void {
  if (seen() || host.querySelector('.qm-storage')) return;
  const ok = h('button', { type: 'button', class: 'qm-btn qm-btn-yellow qm-btn-sm' }, COPY.storage.ok);
  const el = h(
    'aside',
    { class: 'qm-storage', role: 'region', 'aria-label': COPY.storage.label },
    h('p', {}, COPY.storage.text, ' ', h('a', { href: LINKS.cookies, target: '_blank', rel: 'noopener' }, COPY.storage.link)),
    ok,
  );
  ok.addEventListener('click', () => {
    try {
      localStorage.setItem(KEY, LEGAL_VERSION);
    } catch {
      /* blocked: it comes back next visit */
    }
    el.remove();
  });
  host.append(el);
}
