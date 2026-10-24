/**
 * Account helpers for the browser tests. Battle royale needs an account, so
 * the e2e servers run with a throwaway PostgreSQL database (the local test
 * server, `npm run db:up`, port 5439) and test hooks on: sign-in codes then
 * go to the dev mail sink and are read back at GET /api/test/mail (never in
 * production). `seedBrowser` puts an account session (or the guest choice)
 * and the closed storage notice into a context's localStorage before any
 * page loads, so a test starts where it needs to.
 */
import type { BrowserContext } from 'playwright';
import type { AccountView, CharacterView, SignedIn } from '@qwakk/shared/accounts';
import { LEGAL_VERSION } from '@qwakk/shared/accounts';
import { freshDatabase } from '../../apps/server/test/meta/testDb.ts';

export { freshDatabase };

/** A throwaway database for one e2e run (dropped by the returned function). */
export async function e2eDatabase(label: string): Promise<{ url: string; drop: () => Promise<void> }> {
  try {
    return await freshDatabase(`e2e_${label}`);
  } catch (err) {
    throw new Error(`the e2e needs the local PostgreSQL (npm run db:up, port 5439): ${err instanceof Error ? err.message : err}`);
  }
}

async function post<T>(api: string, path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${api}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${res.status} ${json.error ?? ''}`);
  return json;
}

/** The last code the dev mail sink holds for this address (test hooks). */
export async function mailCode(api: string, email: string, timeoutMs = 10_000): Promise<string> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${api}/api/test/mail?email=${encodeURIComponent(email)}`);
    if (res.ok) {
      const m = (await res.json()) as { code: string | null };
      if (m.code) return m.code;
    }
    if (Date.now() > end) throw new Error(`no code in the dev mail sink for ${email}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Sign up over the API (code from the mail sink) and hatch ducks: [name, look id]. */
export async function signUpApi(api: string, email: string, ducks: [string, number][] = []): Promise<{ session: SignedIn; ducks: CharacterView[] }> {
  await post(api, '/api/auth/code', { email });
  const code = await mailCode(api, email);
  const v = await post<{ status: string; signupToken: string }>(api, '/api/auth/verify', { email, code });
  if (v.status !== 'signup') throw new Error(`${email} already has an account`);
  const session = await post<SignedIn>(api, '/api/auth/signup', { signupToken: v.signupToken, consent: true });
  const made: CharacterView[] = [];
  for (const [name, look] of ducks) made.push((await post<{ character: CharacterView }>(api, '/api/account/characters', { name, look }, session.accountToken)).character);
  return { session, ducks: made };
}

export async function fetchAccount(api: string, token: string): Promise<AccountView> {
  const res = await fetch(`${api}/api/account`, { headers: { authorization: `Bearer ${token}` } });
  return ((await res.json()) as { account: AccountView }).account;
}

/** What a browser context starts with. */
export type Seed = { guest: true } | { account: { token: string; expiresAt: number; email: string; active?: string } } | Record<string, never>;

/** Seed localStorage before any page of `ctx` loads: the storage notice closed, and an account or the guest choice. */
export async function seedBrowser(ctx: BrowserContext, seed: Seed = {}): Promise<void> {
  const account = 'account' in seed ? JSON.stringify(seed.account) : null;
  const guest = 'guest' in seed;
  await ctx.addInitScript(
    ([version, acc, g]) => {
      try {
        // Only once per context: a test may log out or switch later.
        if (sessionStorage.getItem('qwakk.e2e.seeded')) return;
        sessionStorage.setItem('qwakk.e2e.seeded', '1');
        localStorage.setItem('qwakk.storage-notice', version as string);
        if (acc) localStorage.setItem('qwakk.account', acc as string);
        if (g) localStorage.setItem('qwakk.entry', 'guest');
      } catch {
        /* storage blocked */
      }
    },
    [LEGAL_VERSION, account, guest] as const,
  );
}

/** Seed for a signed-up account (its first duck active). */
export function accountSeed(s: { session: SignedIn; ducks: CharacterView[] }): Seed {
  return { account: { token: s.session.accountToken, expiresAt: s.session.expiresAt, email: s.session.account.email, ...(s.ducks[0] ? { active: s.ducks[0].id } : {}) } };
}

/** Is this page in Duck Plaza now (the hub's test hook sees our own duck)? */
export function inPlaza(page: import('playwright').Page): Promise<boolean> {
  return page.evaluate(() => {
    const s = (window as unknown as { __qwakkHub?: { snapshot(): { me: number; leaving: boolean } } }).__qwakkHub?.snapshot();
    return !!s && s.me > 0 && !s.leaving && document.body.classList.contains('in-hub');
  });
}

/** Wait until the page is in Duck Plaza (after the character select, the guest card or a match). */
export async function waitPlaza(page: import('playwright').Page, timeout = 60_000): Promise<void> {
  const end = Date.now() + timeout;
  while (!(await inPlaza(page).catch(() => false))) {
    if (Date.now() > end) throw new Error('not in Duck Plaza in time');
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** On the character select: press Play (the picked duck) and wait for Duck Plaza. */
export async function pickDuck(page: import('playwright').Page, timeout = 60_000, tap = false): Promise<void> {
  const play = page.locator('.qd-play:not([disabled])');
  if (tap) await play.tap({ timeout });
  else await play.click({ timeout });
  await waitPlaza(page, timeout);
}

/** A guest without a name yet: the guest card (name and look), then Duck Plaza. */
export async function guestIntoPlaza(page: import('playwright').Page, name: string, timeout = 60_000): Promise<void> {
  await page.locator('.qm-guest:not([hidden])').waitFor({ timeout });
  await page.locator('#qm-name').fill(name);
  await page.locator('.qm-guest-enter').click();
  await waitPlaza(page, timeout);
}

/** Open the menu sheet over the plaza (Esc with the mouse free) on a tab (play, team, leaderboard, settings, howto, account). */
export async function openSheet(page: import('playwright').Page, tab = 0): Promise<void> {
  if (await page.locator('#hub-sheet:not([hidden])').count() === 0) {
    if (await page.evaluate(() => document.pointerLockElement !== null)) await page.evaluate(() => document.exitPointerLock());
    await page.keyboard.press('Escape');
    await page.locator('#hub-sheet:not([hidden])').waitFor({ timeout: 10_000 });
  }
  await page.locator('.qm-sheet-tab').nth(tab).click();
}
