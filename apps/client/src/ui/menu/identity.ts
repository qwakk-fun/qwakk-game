/**
 * The guest identity kept in this browser (localStorage `qwakk.identity`):
 * the server-signed device token (it IS your player, so the same browser keeps
 * its stats), the last name and #tag, and the current session token.
 * Storage can be blocked: then the identity lasts for this page only.
 */
import { ApiError, createSession, type SessionInfo } from './api.ts';
import { getTurnstileToken, turnstileEnabled } from './turnstile.ts';

const KEY = 'qwakk.identity';
/** Refresh the session when it has less than this left. */
const REFRESH_MARGIN_MS = 2 * 3600 * 1000;
export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export interface StoredIdentity {
  deviceToken?: string;
  playerId?: string;
  name?: string;
  tag?: string;
  token?: string;
  expiresAt?: number;
}

let memory: StoredIdentity = {};

export function loadIdentity(): StoredIdentity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = { ...(JSON.parse(raw) as StoredIdentity) };
  } catch {
    /* blocked or corrupt: keep the in-memory copy */
  }
  return { ...memory };
}

function store(next: StoredIdentity): void {
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* blocked: this page only */
  }
}

const FIRST = ['Soggy', 'Turbo', 'Sneaky', 'Fluffy', 'Salty', 'Mighty', 'Lucky', 'Spicy', 'Cosmic', 'Sleepy', 'Rapid', 'Golden'];
const LAST = ['Mallard', 'Quacker', 'Waddler', 'Duckling', 'Feather', 'Paddler', 'Bill', 'Puddle', 'Teal', 'Drake'];

/** A friendly starter name, at most 16 characters. */
export function suggestName(rand: () => number = Math.random): string {
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
  return `${pick(FIRST)}${pick(LAST)}`.slice(0, 16);
}

function fresh(id: StoredIdentity, name: string): boolean {
  return !!id.token && id.name === name && (id.expiresAt ?? 0) - Date.now() > REFRESH_MARGIN_MS;
}

/**
 * A valid session for `name`: the cached one if it is fresh, else a new one
 * from the server (a new guest passes the Turnstile check first when it is on).
 */
export async function ensureSession(name: string, turnstileHost?: HTMLElement): Promise<SessionInfo> {
  const id = loadIdentity();
  if (fresh(id, name)) return id as SessionInfo;
  let turnstile: string | undefined;
  if (!id.deviceToken && turnstileEnabled() && turnstileHost) turnstile = await getTurnstileToken(turnstileHost);
  let s: SessionInfo;
  try {
    s = await createSession(name, id.deviceToken, turnstile);
  } catch (err) {
    // A device token from another server secret: start over as a new guest once.
    if (err instanceof ApiError && err.code === 'turnstile_failed' && id.deviceToken && !turnstile && turnstileEnabled() && turnstileHost) {
      s = await createSession(name, undefined, await getTurnstileToken(turnstileHost));
    } else {
      throw err;
    }
  }
  store({ deviceToken: s.deviceToken, playerId: s.playerId, name: s.name, tag: s.tag, token: s.token, expiresAt: s.expiresAt });
  return s;
}

/** Remember a typed name before the server has confirmed it (no tag yet). */
export function rememberName(name: string): void {
  const id = loadIdentity();
  if (id.name !== name) store({ ...id, name, tag: undefined, token: undefined, expiresAt: undefined });
}
