/**
 * The signed-in account on this device (localStorage `qwakk.account`, no
 * cookies): the account session token, the account and its ducks as last
 * fetched, the duck picked on the character select, and that duck's current
 * game session (24 h, refreshed from the account session like a guest's is
 * from its device token). `qwakk.entry` remembers that this browser chose to
 * play as a guest, so the sign-in screen does not come back every visit.
 * Storage can be blocked: then it all lasts for this page only.
 */
import type { AccountView, CharacterSession, CharacterView, SignedIn } from '@qwakk/shared/accounts';
import { ApiError } from '../api.ts';
import { fetchAccount, logout, playAs } from './accountApi.ts';

const KEY = 'qwakk.account';
const ENTRY = 'qwakk.entry';
/** Refresh a game session when it has less than this left. */
const REFRESH_MARGIN_MS = 2 * 3600 * 1000;

interface Stored {
  token?: string;
  expiresAt?: number;
  email?: string;
  /** The duck picked last on this device. */
  active?: string;
  game?: CharacterSession & { id: string };
}

let memory: Stored = {};
let entryMemory: string | null = null;

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    memory = raw ? { ...(JSON.parse(raw) as Stored) } : {};
  } catch {
    /* blocked or corrupt: keep the in-memory copy */
  }
  return { ...memory };
}

function write(next: Stored): void {
  memory = next;
  try {
    if (next.token) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* blocked: this page only */
  }
}

/** 'guest' when this browser picked "Play as guest" (and has no account signed in). */
export function entryMode(): 'guest' | null {
  try {
    entryMemory = localStorage.getItem(ENTRY);
  } catch {
    /* blocked */
  }
  return entryMemory === 'guest' ? 'guest' : null;
}

export function setEntryMode(mode: 'guest' | null): void {
  entryMemory = mode;
  try {
    if (mode) localStorage.setItem(ENTRY, mode);
    else localStorage.removeItem(ENTRY);
  } catch {
    /* blocked */
  }
}

export class AccountSession {
  account: AccountView | null = null;

  /** Is an account session stored on this device (it may still turn out expired)? */
  get signedIn(): boolean {
    const s = read();
    return !!s.token && (s.expiresAt ?? 0) > Date.now();
  }

  get token(): string | null {
    return read().token ?? null;
  }

  get email(): string {
    return this.account?.email ?? read().email ?? '';
  }

  get ducks(): CharacterView[] {
    return this.account?.characters ?? [];
  }

  /** The duck to play: the one picked on this device, else the account's last, else the first. */
  get active(): CharacterView | null {
    const ducks = this.ducks;
    const id = read().active ?? this.account?.lastCharacterId;
    return ducks.find((d) => d.id === id) ?? ducks[0] ?? null;
  }

  /** After a sign-in or sign-up. */
  adopt(s: SignedIn): void {
    this.account = s.account;
    write({ token: s.accountToken, expiresAt: s.expiresAt, email: s.account.email });
    setEntryMode(null);
  }

  /** Fetch the account (and keep a renewed token). Throws ApiError; 401 clears the session. */
  async refresh(): Promise<AccountView> {
    const token = this.token;
    if (!token) throw new ApiError('session_expired', 401);
    try {
      const r = await fetchAccount(token);
      this.account = r.account;
      const s = read();
      write({ ...s, email: r.account.email, ...(r.accountToken && r.expiresAt ? { token: r.accountToken, expiresAt: r.expiresAt } : {}) });
      return r.account;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.clear();
      throw err;
    }
  }

  /** Replace the account view (after a change the server answered with). */
  update(account: AccountView): void {
    this.account = account;
  }

  select(id: string): void {
    const s = read();
    if (s.active !== id) write({ ...s, active: id, game: s.game?.id === id ? s.game : undefined });
  }

  /** A fresh game session for the active duck (cached while it has 2 h left). */
  async gameSession(): Promise<CharacterSession> {
    const duck = this.active;
    const token = this.token;
    if (!duck || !token) throw new ApiError('session_expired', 401);
    const s = read();
    if (s.game && s.game.id === duck.id && s.game.expiresAt - Date.now() > REFRESH_MARGIN_MS) return s.game;
    try {
      const g = await playAs(token, duck.id);
      write({ ...read(), active: duck.id, game: { ...g, id: duck.id } });
      return g;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.clear();
      throw err;
    }
  }

  /** Forget a cached game session (its duck was deleted or the server refused it). */
  dropGameSession(): void {
    const s = read();
    if (s.game) write({ ...s, game: undefined });
  }

  /** End this device's session on the server (best effort) and forget it here. */
  async logout(): Promise<void> {
    const token = this.token;
    this.clear();
    if (token) await logout(token).catch(() => {});
  }

  clear(): void {
    this.account = null;
    write({});
  }
}
