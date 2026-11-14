/**
 * The account routes, mounted by the meta handler (../http.ts) under /api.
 * JSON bodies only (the meta handler's readJson: 4 KB, application/json),
 * account calls carry `Authorization: Bearer <account session>`.
 *
 *   POST /api/auth/code                   { email, lang?, turnstileToken? } -> { ok }
 *   POST /api/auth/verify                 { email, code } -> signed in, or a sign-up ticket
 *   POST /api/auth/signup                 { signupToken, consent, marketing?, guestDeviceToken?, guestLook? }
 *   POST /api/auth/logout                 (Bearer) this device's session ends
 *   GET  /api/account                     (Bearer) the account and its ducks
 *   POST /api/account/marketing           (Bearer) { optIn }
 *   POST /api/account/legal               (Bearer) { accept: true }
 *   POST /api/account/characters          (Bearer) { name, look, slot? }
 *   POST /api/account/characters/delete   (Bearer) { id, confirm }
 *   POST /api/account/characters/claim    (Bearer) { deviceToken, look? }
 *   POST /api/account/play                (Bearer) { id } -> a game session for that duck
 *   POST /api/account/delete/code         (Bearer) { lang? } -> a confirmation code by email
 *   POST /api/account/delete              (Bearer) { code, lang? }
 *   POST /api/account/qorex/challenge     (Bearer) { address, duckId } -> the Duck Pass request for QoreX
 *   POST /api/account/qorex/verify        (Bearer) { txHash } -> 202 pending, or the linked Duck Pass
 *   POST /api/account/qorex/unlink        (Bearer) the linked wallet is forgotten
 *   GET  /api/test/mail?email=            test hooks only (never production): the dev mail sink
 */
import type { AccountService, ApiResult } from './service.ts';

export const ACCOUNT_PATHS = [
  '/api/auth/code',
  '/api/auth/verify',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/account',
  '/api/account/marketing',
  '/api/account/legal',
  '/api/account/characters',
  '/api/account/characters/delete',
  '/api/account/characters/claim',
  '/api/account/play',
  '/api/account/delete/code',
  '/api/account/delete',
  '/api/account/qorex/challenge',
  '/api/account/qorex/verify',
  '/api/account/qorex/unlink',
  '/api/test/mail',
];

/** Answer an account route, or null when `route` is not one. `body()` reads the JSON body on demand. */
export async function accountRoute(
  accounts: AccountService,
  route: string,
  params: URLSearchParams,
  authorization: string | undefined,
  ip: string,
  body: () => Promise<unknown>,
): Promise<ApiResult | null> {
  switch (route) {
    case 'POST /api/auth/code':
      return accounts.requestCode(await body(), ip);
    case 'POST /api/auth/verify':
      return accounts.verify(await body(), ip);
    case 'POST /api/auth/signup':
      return accounts.signup(await body(), ip);
    case 'POST /api/auth/logout':
      return accounts.logout(authorization, ip);
    case 'GET /api/account':
      return accounts.account(authorization, ip);
    case 'POST /api/account/marketing':
      return accounts.marketing(authorization, await body(), ip);
    case 'POST /api/account/legal':
      return accounts.legal(authorization, await body(), ip);
    case 'POST /api/account/characters':
      return accounts.createCharacter(authorization, await body(), ip);
    case 'POST /api/account/characters/delete':
      return accounts.deleteCharacter(authorization, await body(), ip);
    case 'POST /api/account/characters/claim':
      return accounts.claim(authorization, await body(), ip);
    case 'POST /api/account/play':
      return accounts.play(authorization, await body(), ip);
    case 'POST /api/account/delete/code':
      return accounts.deleteCode(authorization, await body(), ip);
    case 'POST /api/account/delete':
      return accounts.deleteAccount(authorization, await body(), ip);
    case 'POST /api/account/qorex/challenge':
      return accounts.qorexChallenge(authorization, await body(), ip);
    case 'POST /api/account/qorex/verify':
      return accounts.qorexVerify(authorization, await body(), ip);
    case 'POST /api/account/qorex/unlink':
      return accounts.qorexUnlink(authorization, ip);
    case 'GET /api/test/mail':
      return accounts.testMail(params);
    default:
      return null;
  }
}
