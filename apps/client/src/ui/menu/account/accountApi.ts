/**
 * The account API on the game server (server: apps/server/src/meta/accounts/).
 * JSON in and out, no cookies (`credentials: 'omit'` in api.ts): the account
 * session token travels as `Authorization: Bearer`.
 */
import type { AccountView, CharacterSession, CharacterView, SignedIn, VerifyResult } from '@qwakk/shared/accounts';
import { locale } from '../../../i18n/locale.ts';
import { call } from '../api.ts';

const json = (body: unknown, token?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const auth = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } });

/** Email a sign-in code (the answer is the same for every valid address). */
export function requestCode(email: string, turnstileToken?: string): Promise<{ ok: true }> {
  return call('/api/auth/code', json({ email, lang: locale, ...(turnstileToken ? { turnstileToken } : {}) }), 15_000);
}

export function verifyCode(email: string, code: string): Promise<VerifyResult> {
  return call('/api/auth/verify', json({ email, code }));
}

export function signup(signupToken: string, marketing: boolean, guest?: { deviceToken: string; look: number }): Promise<SignedIn> {
  return call('/api/auth/signup', json({ signupToken, consent: true, marketing, ...(guest ? { guestDeviceToken: guest.deviceToken, guestLook: guest.look } : {}) }));
}

export function logout(token: string): Promise<{ ok: true }> {
  return call('/api/auth/logout', json({}, token));
}

/** The account; `accountToken` comes along when the session was renewed. */
export function fetchAccount(token: string): Promise<{ account: AccountView; accountToken?: string; expiresAt?: number }> {
  return call('/api/account', auth(token));
}

export function setMarketing(token: string, optIn: boolean): Promise<{ marketing: boolean }> {
  return call('/api/account/marketing', json({ optIn }, token));
}

export function acceptLegal(token: string): Promise<{ account: AccountView }> {
  return call('/api/account/legal', json({ accept: true }, token));
}

export function createDuck(token: string, name: string, look: number, slot?: number): Promise<{ character: CharacterView }> {
  return call('/api/account/characters', json({ name, look, ...(slot !== undefined ? { slot } : {}) }, token));
}

export function deleteDuck(token: string, id: string, confirm: string): Promise<{ ok: true }> {
  return call('/api/account/characters/delete', json({ id, confirm }, token));
}

export function claimGuest(token: string, deviceToken: string, look: number): Promise<{ character: CharacterView }> {
  return call('/api/account/characters/claim', json({ deviceToken, look }, token));
}

/** A 24-hour game session for one duck (what the rooms and the party take). */
export function playAs(token: string, id: string): Promise<CharacterSession> {
  return call('/api/account/play', json({ id }, token));
}

export function requestDeleteCode(token: string): Promise<{ ok: true }> {
  return call('/api/account/delete/code', json({ lang: locale }, token), 15_000);
}

export function deleteAccount(token: string, code: string): Promise<{ ok: true }> {
  return call('/api/account/delete', json({ code, lang: locale }, token));
}
