# Game privacy notes

What the Qwakk game (`play.qwakk.fun`) stores about players, where, and for how long. This is the input for the game's own privacy page (`docs/legal/privacy.md`, served at `/privacy`); an older proposed wording is at the end. The landing and app privacy pages are not changed by this repo. Accounts are described in `docs/accounts.md`.

## What we store

| Data | Where | Why | How long |
| --- | --- | --- | --- |
| Nickname and `#1234` tag (a guest, or an account's duck) | Game database (`players`) and the player's browser | Shown in matches and on the leaderboard | Until the player row is deleted (see Retention), or the duck or its account is deleted |
| Player id (random UUID) | Game database, inside the device token | Ties match stats to the same guest | Same as the nickname |
| Device token | The player's browser only (`localStorage` key `qwakk.identity`), signed by the server | Lets the same browser keep its name, tag and stats without an account | Until the player clears site data |
| Session token | The player's browser (`qwakk.identity`) | Proves the identity to the game server for 24 hours | 24 hours, then refreshed |
| Match stats per player: placement, kills, deaths, damage, time survived, points, match mode, map, start and end time | Game database (`matches`, `match_players`) | Leaderboard and the player's own stats | Kept for past seasons (see Retention) |
| First and last seen time | Game database (`players.created_at`, `last_seen`) | Clean-up of inactive guests | Same as the nickname |
| Settings (mouse sensitivity, field of view, volume) | The player's browser only (`qwakk.settings`, `qwakk.sensitivity`) | Comfort | Until the player clears site data |
| Account: id (random UUID), created and last sign-in time | Game database (`accounts`) | Keeps a player's ducks across devices | Until the player deletes the account |
| Email address (normalised: trimmed, lower case) | Game database (`account_logins`, method `email`) | Sign-in codes, account notices, and news only with the opt-in | Until the player deletes the account (deletion removes it at once) |
| Sign-in codes (6 digits) | Game database (`login_codes`): only an HMAC of the code with a random salt, the address, the purpose (sign-in or account deletion), tries and expiry | Proves the email is the player's | At most 10 minutes; deleted when used, after 5 wrong tries, or on the next code request. One active code per address. The plain code is only in the email |
| Account sessions: id, account, created, last used, expiry | Game database (`account_sessions`); the signed token in the player's browser (`localStorage` key `qwakk.account`, with the ducks' last game session) | Keeps the player signed in on that device | 30 days, renewed while the player plays; deleted on log out and with the account. No IP address, user agent or device name |
| Consent records: the accepted legal version (`2026-10-23`) and time, the 16+ statement time | Game database (`accounts.legal_version`, `legal_accepted_at`, `age_confirmed_at`) | Shows which terms apply and that the age rule was confirmed | Until the account is deleted |
| News email opt-in: yes or no, when, and which wording was shown (`MARKETING_TEXT_VERSION`) | Game database (`accounts.marketing_opt_in`, `marketing_updated_at`; every choice appended to `marketing_consents`, never overwritten) | Send news only to players who asked, and prove it | Until the account is deleted (the log goes with it; retention after deletion is an open legal question, see `docs/legal/README.md`) |
| Ducks (characters): up to 4 per account, each a `players` row with the account, slot, look (character catalog id), level and XP | Game database (`players.account_id`, `slot`, `look`, `level`, `xp`) | The player's ducks and their progress (cosmetic in PvP) | Until the duck or the account is deleted |
| Hunt Season runs: the run (map, start and end, waves or objectives cleared, won, number of ducks) and each account duck's part (waves or objectives cleared, hunters bagged, minions bagged, the combo bonus, bosses, revives, XP granted); the duck's personal best (most objectives, fastest time, runs, wins) | Game database (`raid_runs`, `raid_run_players`, `raid_bests`, migration 004; the Pond Keep bests in `raid_keep_bests`, migration 005; minions and the combo bonus in `raid_run_players` and the push bests in `raid_push_bests`, migration 006, the same columns; `raid_bests` and `raid_keep_bests` no longer written) | The XP and level of a duck (`players.xp`, `players.level`: cosmetic in PvP, unlocks in Hunt Season), its Tüy (in the same transaction, see the progression row) and its best run on the character select | Runs: kept like match history. Deleting a duck deletes its best and unlinks its run rows (`raid_run_players.player_id` set null; the rows hold no name). No IP, chat or position data |
| Hunt Season progression: the duck's Tüy (an in-game soft currency, never sold, never tradeable, not a token) balance, the total ever earned, a ledger of every balance change (amount, balance after, reason: run, daily bonus, purchase, respec, admin; the run id, item or day it refers to; an optional idempotency key the menu makes; the time), the gear it owns and wears, its skill tree and how many times it reset it | Game database (`duck_progress`, `feather_ledger`, `duck_items`, `duck_equipped`, `duck_tree`, migration 007) | Hunt Season gear and skills; the ledger lets support answer "where did my Tüy go" and check grants | Until the duck or its account is deleted (every row goes with the duck, on delete cascade). No IP, no name, no device data |
| The duck picked last | Game database (`accounts.last_character_id`) and the browser (`qwakk.account`) | Highlights it on the character select | Until the account is deleted |
| "Play as guest" chosen | The player's browser only (`qwakk.entry`) | The sign-in screen does not come back on every visit | Until the player clears site data or signs in |
| The storage notice was closed (its version) | The player's browser only (`qwakk.storage-notice`) | The notice shows once per version | Until the player clears site data |
| Room chat messages (with the duck's name and tag) | Relayed by the game server in memory only, to the players in the room | Room chat | Never stored: gone when the message is delivered (players' browsers keep the last lines while the page is open) |
| Revoked game sessions (player ids of deleted ducks, claimed guests) | Game server memory only | A deleted duck's 24-hour game session stops working at once | At most 25 hours, gone on every restart |
| IP address | Game server memory only | Rate limits on joins, guest creation and leaderboard reads | Not written to disk or the database. An entry is dropped once its limit has refilled (seconds to minutes) and on every server restart |
| Party membership (who is in which party, its leader) | Game server memory only | Lets friends land in the same match on one team | Not written to disk or the database. Gone when the player leaves the party or closes the page, and on every server restart |
| Duck Plaza (the hub between matches): where each duck stands, its open team invites and emotes; chat lines shown as speech bubbles; the duck's level read from `players.level` at join | Game server memory only | The shared square, invites into a party, speech bubbles, the level badge | Not written to disk or the database. Gone when the duck leaves the plaza, and on every server restart. Chat is relayed like room chat (never stored) |
| Bans: player id, reason, start and end, which admin session set it | Game database (`bans`) | Keeps a guest who broke the rules out of matches and new sessions | While the ban lasts. Ended bans stay as rows until deleted (proposal: delete them after 12 months, see Retention) |
| Players hidden from the leaderboard: player id, reason, which admin session | Game database (`leaderboard_hidden`) | Keeps a cheater or an offensive name off the public board (the match rows stay) | Until the admin shows the player again |
| Admin audit log: time, the admin session's label (`admin@1a2b`), the action, its target (a setting, a room, or a player's id, name and tag) and the old and new value (setting values, a ban reason, a notice text) | Game database (`admin_audit`) | Accountability for every change made in the admin panel | Kept for now (proposal: 12 months, see Retention). Never IP addresses |
| Extra blocked name words | Game database (`blocked_names`) | The nickname filter, on top of `blocked-names.json` | Until removed. Not personal data |
| IP blocks set by the admin | Game server memory only | Keeps an abusive address out for a while | At most 24 hours, gone on every restart. Never written to disk, the database or the audit log (the log names the block and the player, not the address) |

In Duo and Squad matches the stored placement is the team's place (the same for every member) and points use the number of teams; no new data is stored for it.

Not stored: real names, passwords, wallet addresses (QoreX sign-in later stores a public qor1 address, see `docs/accounts.md`), payment data, device fingerprints, IP addresses or user agents with accounts or sessions, chat messages (room chat is relayed in memory only). The game sets no cookies for players. The admin panel (`/admin`, the owner only) sets one strictly necessary session cookie for the logged-in admin; its password hash and TOTP secret live in the server environment, not the database.

Notes:

- Bots are stored in match rows with no player id; they never appear on the leaderboard.
- The game server's normal logs may contain IP addresses in error messages from the hosting proxy (CapRover nginx). Those follow the host's log rotation, not this table. Check the CapRover log retention before launch.
- Nicknames pass a word filter (slurs, insults, impersonation of staff or the brand). It is a filter, not moderation.

Accounts:

- Deleting a duck (type its name) or the whole account (a code by email, then type DELETE) deletes the `players` rows, the account, its logins, sessions, codes and consent log. Their match rows stay in the match history with no link and no name: `match_players.player_id` is set null by the foreign key and `match_players.name` is replaced with `deleted`, so they leave the leaderboard. `leaderboard_hidden` rows for them are deleted. A ban row on a deleted duck's id stays (a bare random id with no link to an email). A short "your account is deleted" email goes to the address once.
- While a duck of an account is banned, the account cannot delete that duck or itself (the deletion request is answered "suspended, email hello@qwakk.fun"), so the ban record and the duck stay until the ban ends; the player can still ask for deletion by email. This needs a line in the privacy policy (legitimate interest in enforcing a ban) and a lawyer's look, see `docs/legal/README.md` (Ban and deletion).
- A guest who signs up keeps its duck: the guest's `players` row gets the account and a slot (stats stay), and its device token no longer makes guest sessions.
- Emails and codes are never logged in production (SMTP errors are logged by code only). In dev and tests without SMTP, a local mail sink prints the code with a masked address (`a***@example.com`) to the server console and keeps the last mail per address in memory for the e2e (`QWAKK_TEST_HOOKS=1`, refused in production).

## Third parties

- **Cloudflare Turnstile** (only when `VITE_TURNSTILE_SITEKEY` is set at build time): when a NEW guest is created, the menu loads Cloudflare's Turnstile script and the server checks the result with Cloudflare, sending the challenge token and the player's IP address (`remoteip`). Cloudflare processes this data under its own privacy policy. Returning players (with a device token) do not trigger it.
- **Email (Hostinger SMTP)**: sign-in and deletion codes go out from `noreply@qwakk.fun` through Hostinger's SMTP server (`SMTP_HOST`), which processes the recipient address and the message. No tracking pixels or tracked links.
- **Cloudflare Turnstile** also guards "send code" when it is configured (the same token check as for new guests).
- **Fonts**: Geist and Geist Mono are bundled with the game (self-hosted), so loading the menu makes no request to Google or any font service.
- No analytics, no ad trackers.

## Retention (proposal for the owner)

- Leaderboard data is kept per season and past seasons stay visible.
- Proposed: delete guest players not seen for 12 months, with their match rows unlinked (the `match_players.player_id` foreign key is `on delete set null`, so match history stays consistent and anonymous). This is not automated yet; it is one SQL statement to schedule:

  ```sql
  delete from players where last_seen < now() - interval '12 months';
  ```

- Deletion on request: a player can clear their browser data to drop the device token, but the server can only find their row by name and tag. Deleting a row by name and tag on request is a manual SQL delete for now (the admin panel's player search finds the id by name).
- Proposed for the admin tables: delete ended bans and audit rows older than 12 months:

  ```sql
  delete from bans where expires_at < now() - interval '12 months';
  delete from admin_audit where at < now() - interval '12 months';
  ```

## Proposed wording for the privacy page

Paste into the privacy page under a "Qwakk game" heading. It avoids promises we do not keep.

> **Qwakk game**
>
> You can play the Qwakk game as a guest, without an account. When you pick a nickname, our game server gives you a random tag (like #1234) and a random player ID, and your browser keeps a signed device token so the same browser keeps your name and stats. We store your nickname, tag, player ID, when you first and last played, and your in-game match stats (placement, kills, deaths, damage, time survived and points). Your nickname, tag and stats can appear on the public leaderboard.
>
> Your game settings stay in your browser. The game does not use cookies, analytics or ad trackers.
>
> Our game server uses your IP address in memory to limit how often you can join matches, create a guest or load the leaderboard, and to block an address for up to a day after abuse. We do not store it in our database.
>
> If a guest breaks the rules (cheating, abuse, an offensive name), we may remove it from a match, hide it from the leaderboard or ban it. For a ban we keep the player ID, the reason and how long it lasts, and we log moderation actions. When you create a new guest, we may use Cloudflare Turnstile to check that you are human; Cloudflare receives the check and your IP address for that purpose.
>
> The leaderboard is for fun only: it has no prizes and no monetary value.
>
> We keep guest data while you keep playing and may delete guests that have been inactive for 12 months. To have your guest data deleted, contact us with your nickname and tag.

The last sentence needs a contact address on the privacy page (none exists yet; see the legal notes in the workspace).
