/**
 * The admin app: a top bar with the pages (dashboard, settings, moderation,
 * notices, audit log) and log out, and the page under it. Hash routes, so a
 * reload stays on the page. Served only to a logged-in admin (the server
 * checks the session for the page, its files and every API call).
 */
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import './style.css';
import { get } from './api.ts';
import { COPY } from './copy.ts';
import { h } from './dom.ts';
import { auditPage } from './pages/audit.ts';
import { dashboardPage } from './pages/dashboard.ts';
import { moderationPage } from './pages/moderation.ts';
import { noticesPage } from './pages/notices.ts';
import { settingsPage } from './pages/settings.ts';
import type { Page } from './ui.ts';

const ROUTES = {
  dashboard: dashboardPage,
  settings: settingsPage,
  moderation: moderationPage,
  notices: noticesPage,
  audit: auditPage,
} as const;
type Route = keyof typeof ROUTES;

const app = document.getElementById('app')!;
const main = h('main', { class: 'main', id: 'main' });
const links = new Map<Route, HTMLAnchorElement>();
const nav = h('nav', { class: 'nav', 'aria-label': 'Pages' });
for (const r of Object.keys(ROUTES) as Route[]) {
  const a = h('a', { href: `#/${r}`, class: 'nav-link' }, COPY.nav[r]);
  links.set(r, a);
  nav.append(a);
}
const who = h('span', { class: 'who muted mono small' });
const logout = h('form', { method: 'post', action: '/admin/logout', class: 'logout' }, h('button', { type: 'submit', class: 'btn btn-ghost btn-sm' }, COPY.logout));
app.append(
  h('header', { class: 'top' }, h('div', { class: 'brand' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, 'Q'), h('span', {}, COPY.brand)), nav, h('div', { class: 'top-end' }, who, logout)),
  main,
);

let current: Page | null = null;

function route(): Route {
  const r = location.hash.replace(/^#\/?/, '');
  return Object.hasOwn(ROUTES, r) ? (r as Route) : 'dashboard';
}

function show(): void {
  current?.stop?.();
  const r = route();
  for (const [k, a] of links) {
    a.classList.toggle('is-on', k === r);
    if (k === r) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  current = ROUTES[r]();
  main.replaceChildren(current.el);
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', show);
show();
void get<{ actor: string }>('me').then((m) => (who.textContent = m.actor), () => {});
