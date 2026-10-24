# Accounts

Persistent accounts with a Metin2 style way in: sign in by email (or play as a guest), pick a duck on the character select, then the main menu as that duck. Guests play Deathmatch only; Battle Royale and Hunt Season need an account. Phase 1 of a bigger plan: phase 2 adds XP and levels, daily quests, login streaks, cosmetic unlocks and a QoreX wallet sign-in. Levels only ever unlock cosmetics: no gameplay stat lives on a duck.

Code: server `apps/server/src/meta/accounts/` (codes, tokens, mail, store, service, routes), migration `apps/server/db/migrations/003_accounts.sql`; menu `apps/client/src/ui/menu/account/`; shared constants and API types `packages/shared/src/accounts.ts` (`@qwakk/shared/accounts`). Privacy rows: `docs/privacy-notes.md`.

## Data model

| Table | Columns | Notes |
| --- | --- | --- |
| `accounts` | `id` uuid, `created_at`, `last_login_at`, `legal_version`, `legal_accepted_at`, `age_confirmed_at`, `marketing_opt_in`, `marketing_updated_at`, `last_character_id` | One per player. No email here: the email is a login |
| `account_logins` | `id`, `account_id`, `method` (`email`, later `qorex`), `subject` (the normalised email, later a qor1 address), `created_at`, `last_used_at` | `unique (method, subject)`; one login per method and account. The email login is also where we write to the player |
| `account_sessions` | `id` uuid, `account_id`, `created_at`, `last_used_at`, `expires_at` | One per signed-in device, at most 20 per account. No IP, no user agent |
| `login_codes` | `email` (primary key: one active code per address), `purpose` (`login`, `delete`), `code_hash`, `salt`, `attempts`, `created_at`, `expires_at` | HMAC-SHA256 under a key derived from `SESSION_SECRET`, over purpose, address, salt and code |
| `marketing_consents` | `id`, `account_id`, `opt_in`, `text_version`, `source` (`signup`, `account`), `at` | Append only: every news choice with the wording version |
| `players` (existing) | + `account_id`, `slot` (0 to 3), `look` (character catalog id), `xp`, `level` | A duck is a player row with an account and a slot; guests keep both null (`check ((account_id is null) = (slot is null))`, `unique (account_id, slot)`). Leaderboard, match rows and the in-game identity stay per duck |

The migration only adds tables and nullable or defaulted columns, so existing guests, matches and admin data are untouched (tested on a database that already holds guests, settings and bans).

### Phase 2

- XP and level (built with Hunt Season, `docs/hunt-season.md`): Hunt Season is the mode that gives XP. The game server grants it at the end of a run through `recordRaid` (`apps/server/src/meta/raid.ts`, migration `004_raid.sql`: `raid_runs`, `raid_run_players`, `raid_bests`; Pond Keep's bests are in `raid_keep_bests` from `005_raid_keep.sql`), once per run, and sets `players.level` from the shared curve (`@qwakk/shared/progress`: level n needs 100 * n^1.5 XP, cap 50). Never from a client message, never from an HTTP route. The account API sends `xp`, `level` and `raidBest` with every duck; the character select and the Account card in Duck Plaza's sheet show the level, an XP bar and the best wave (the plaza's name labels show the level badge). Levels are cosmetic progress only (they unlock nothing yet, and never gameplay power).
- Cosmetic unlocks: a new `account_unlocks (account_id, item_id, unlocked_at, source)` table (per account, so every duck can wear them), plus `players.cosmetics` (what a duck wears) checked against it.
- Daily quests: `account_quests (account_id, day, quest_id, progress, done_at)`, progress written by the game server from match results, never by an HTTP route.
- Login streaks: `accounts.streak_days`, `accounts.streak_last_day` (a date), updated at sign-in or at the first match of a day.
- QoreX sign-in: an `account_logins` row with `method = 'qorex'` and `subject` = the qor1 address (the table and its check constraint already allow it).

## The flow

1. **Sign-in screen** (`loginScreen.ts`): email, Send code (Turnstile first when configured), the 6-digit code boxes (one real input, paste and phone autofill work, six digits submit), then for a new address only the sign-up step: the required box "I am 16 or older, I accept the Terms of Use and I have read the Privacy Policy" and the optional news box (unchecked). A guest duck on this device comes along. Also: Play as guest (Deathmatch only), and the disabled "Sign in with QoreX (soon)" button.
2. **Character select** (`duckSelect.ts`): four nests, each duck in 3D on a podium (one WebGL renderer for all, `menuHero/roster.ts`; portraits first and as the fallback), name, #tag, look and level; the picked duck turns to the viewer and quacks. Empty nests hatch a duck (`createDuck.ts`: name, look, 3D preview). Delete a duck by typing its name. Bring the guest duck in. Play as the duck.
3. **Main menu** as that duck: the "Playing as" card with Switch duck, the Account tab (email, news switch, legal links, log out, delete account with an emailed code and DELETE).

The account session token lives in `localStorage` (`qwakk.account`), like the guest identity; no cookies. A returning device opens on the character select. A browser that chose "Play as guest" goes straight to the guest menu (`qwakk.entry`); its Quick Play button reads "Sign in to play Battle Royale" and opens the sign-in screen.

## Sessions and the rooms

- Account session `a1.<payload>.<sig>` (30 days, renewed on `GET /api/account` when half used) names an `account_sessions` row; logout and deletion delete rows, so a signature alone signs nobody in.
- Picking a duck trades it for the usual 24-hour game session (`POST /api/account/play`), now with `k: 'a'` and the duck's look. Rooms keep calling `verifySession(token)`; the identity carries `account` and `look`. The room seats an account duck in its stored look, never the `character` join option.
- Battle royale and Hunt Season refuse guests twice: the matchmaking guard (`checkAccount`, codes 534 and 535 as HTTP statuses) and `BrRoom.checkAdmission` / `RaidRoom.checkAdmission` (4412 and 4413). A party with a guest cannot go into a battle royale (the party registry knows who is a guest from the verified session); the party view marks guests.
- Deleted ducks and claimed guests: their older game sessions are refused at once (`accounts/revoked.ts`, memory, 25 hours).
- Dev only: a join without a token (tools, benchmarks, direct-start tests) gets a random dev identity that counts as signed in. In production a join without a valid token is refused as before.

## API

All JSON, `Cache-Control: no-store`, the same origin and CORS policy as the rest of `/api`.

| Route | Body | Answer |
| --- | --- | --- |
| `POST /api/auth/code` | `{ email, lang?, turnstileToken? }` | `{ ok: true }` for every valid address (no account enumeration) |
| `POST /api/auth/verify` | `{ email, code }` | `{ status: 'signed_in', accountToken, expiresAt, account }` or `{ status: 'signup', signupToken, expiresAt }`; errors `code_wrong` (with `left`), `code_expired`, `code_locked`, `code_format` |
| `POST /api/auth/signup` | `{ signupToken, consent: true, marketing?, guestDeviceToken?, guestLook? }` | Signed in, with `claimed` (the guest duck) |
| `POST /api/auth/logout` | Bearer | This device's session ends |
| `GET /api/account` | Bearer | `{ account }` (and a renewed `accountToken`) |
| `POST /api/account/marketing` | Bearer, `{ optIn }` | Logged with `MARKETING_TEXT_VERSION` |
| `POST /api/account/legal` | Bearer, `{ accept: true }` | After a legal version change |
| `POST /api/account/characters` | Bearer, `{ name, look, slot? }` | The new duck (`slots_full`, `slot_taken`, `name_*`) |
| `POST /api/account/characters/delete` | Bearer, `{ id, confirm }` | `confirm` must be the name exactly |
| `POST /api/account/characters/claim` | Bearer, `{ deviceToken, look? }` | Brings this device's guest duck in |
| `POST /api/account/play` | Bearer, `{ id }` | A game session for that duck |
| `POST /api/account/delete/code` | Bearer, `{ lang? }` | A deletion code to the account's email |
| `POST /api/account/delete` | Bearer, `{ code, lang? }` | Deletes the account, its logins, sessions and ducks |
| `GET /api/test/mail?email=` | none | Test hooks only (`QWAKK_TEST_HOOKS=1`, never production): the dev mail sink's last code |

Limits (memory only): codes 5 per IP then one a minute, and 3 per address then one every 2 minutes; code checks 10 per IP then one every 6 s (and 5 tries per code); at most 15 wrong codes per address in 24 hours (`VERIFY_FAILS`), after which that address gets no new code and no check until the window ends (the answer is the generic `code_rate_limited`, so it reveals nothing; the trade-off: someone who floods wrong codes at an address locks its owner out for up to a day); account calls 60 per IP then 2 a second. Loopback is exempt from the per-IP limits outside production.

Email addresses follow a strict grammar (`normalizeEmail` in `packages/shared/src/accounts.ts`: RFC 5322 atext local part, letter-digit-hyphen domain labels, a letter TLD): nothing a mail library could read as a display name, a group or a second recipient. The mailer hands nodemailer the recipient as an address object with an explicit envelope, so it is never re-parsed.

Bans: a ban is set on a duck (its player id, admin panel). While any duck of an account is banned, the account is frozen for duck changes: it cannot hatch, claim or delete a duck and cannot delete itself (`account_banned`), so a ban cannot be shed by replacing the duck or the account. The banned duck cannot play; the account's other ducks can (bans stay per duck, as for guests).

## Email

`nodemailer` over Hostinger SMTP (`SMTP_HOST=smtp.hostinger.com`, implicit TLS on 465), from `MAIL_FROM` (default `Qwakk <noreply@qwakk.fun>`). Plain text plus a small branded HTML part, in the menu's language; the subject never holds the code. Without `SMTP_HOST` the dev mail sink prints the code (masked address) to the console outside production; in production sending a code answers 503 `email_failed`. DKIM for qwakk.fun is not verified yet: check deliverability (spam folder) after the first deploy.

## QoreX sign-in: the plug-in point

- Server: add `POST /api/auth/qorex/challenge` (a nonce, stored like a code) and `POST /api/auth/qorex/verify` (the wallet's signature over the nonce, checked against the qor1 address) in `accounts/http.ts` and `accounts/service.ts`. On success it answers exactly like `verify`: look up `account_logins (method 'qorex', subject address)`; found: `signIn(accountId)` with `touchLogin(..., 'qorex')`; not found: a sign-up ticket for the address (the sign-up step then needs an email for codes and news, or an account without one, `loadAccount` already allows an account with no email login). Linking a wallet to a signed-in account inserts the `qorex` login row.
- Menu: `loginScreen.ts`, the `.qa-qorex` button in `showEmail()` (now disabled). Enable it, run the wallet proof, call the new route and hand its answer to the same `afterVerify` path as the email code (`signedIn` or `showSignup`).
- Copy: `COPY.auth.qorex` and `qorexNote` exist; the privacy paragraph for wallet sign-in is drafted in `docs/legal/README.md`.
