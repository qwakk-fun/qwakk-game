/**
 * Accounts: what the menu and the server agree on (constants, error codes,
 * the shapes of the account API). The server code is in
 * `apps/server/src/meta/accounts/`, the menu side in
 * `apps/client/src/ui/menu/account/`. Pure data, no runtime code beyond tiny
 * helpers.
 */

/** One version for the Terms of Use, the Privacy Policy and the storage notice (docs/legal/README.md). */
export const LEGAL_VERSION = '2026-10-23';
/** The readable date of that version, for the legal pages' header. */
export const LEGAL_UPDATED = 'October 23, 2026';
/** The wording of the news email opt-in shown at sign-up and on the account screen (stored with each choice). */
export const MARKETING_TEXT_VERSION = '2026-10-23';

/** Characters (ducks) per account. */
export const CHARACTER_SLOTS = 4;
/** Sign-in codes: 6 digits, valid 10 minutes, 5 tries. */
export const CODE_DIGITS = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
/** The menu waits this long before it offers to send another code. */
export const CODE_RESEND_MS = 30 * 1000;

/**
 * Join refusals for battle royale (and later every mode but deathmatch) when
 * the player or its party is not signed in. The matchmaking guard's codes
 * are HTTP statuses (they become the status of the matchmake request); the
 * room's onAuth codes are 44xx like the team errors.
 */
export const ACCOUNT_ERROR = {
  /** Matchmaking: a guest session asked for a battle royale room. */
  needsAccount: 534,
  /** Matchmaking: the party has a guest, so the leader cannot take it into a battle royale. */
  partyHasGuest: 535,
  /** Room onAuth: the same two refusals. */
  roomNeedsAccount: 4412,
  roomPartyHasGuest: 4413,
} as const;

/** A duck of an account, as the account API sends it. */
export interface CharacterView {
  /** The player id (the leaderboard and match rows use it). */
  id: string;
  slot: number;
  name: string;
  tag: string;
  /** Shared character catalog id (`characters.ts`). */
  look: number;
  level: number;
  xp: number;
}

/** The signed-in account, as GET /api/account sends it. */
export interface AccountView {
  email: string;
  marketing: boolean;
  createdAt: string;
  /** The legal version this account accepted; when it differs from LEGAL_VERSION the menu asks again. */
  legalVersion: string;
  /** The character played last (highlighted on a new device). */
  lastCharacterId: string | null;
  characters: CharacterView[];
  slots: number;
}

/** POST /api/auth/verify: an existing account is signed in; a new address gets a sign-up ticket. */
export type VerifyResult =
  | { status: 'signed_in'; accountToken: string; expiresAt: number; account: AccountView }
  | { status: 'signup'; signupToken: string; expiresAt: number };

/** POST /api/auth/signup and the sign-in branch of verify. */
export interface SignedIn {
  accountToken: string;
  expiresAt: number;
  account: AccountView;
  /** The guest duck that came along (a guest who signed up on this device). */
  claimed?: CharacterView | null;
}

/** POST /api/account/play: a game session for one character (the rooms use it like a guest's). */
export interface CharacterSession {
  token: string;
  expiresAt: number;
  playerId: string;
  name: string;
  tag: string;
  look: number;
}

/** The local part: RFC 5322 atext and dots (no quotes, spaces, <>, (), commas, semicolons or @). */
const LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
/** The domain: dot-separated labels of letters, digits and inner hyphens, a letter TLD of 2+. */
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Normalise an email the way the server stores it: trimmed and lower case
 * (dots and plus parts stay), or null when it is not a plain address. The
 * grammar is strict on purpose: nothing a mail library could read as a
 * display name, a group or a second recipient (`<`, `>`, `(`, `)`, `,`, `;`,
 * quotes, spaces) gets through.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (s.length < 6 || s.length > 254) return null;
  const at = s.lastIndexOf('@');
  if (at < 1 || s.indexOf('@') !== at) return null;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (local.length > 64 || domain.length > 253) return null;
  return LOCAL_RE.test(local) && DOMAIN_RE.test(domain) ? s : null;
}
