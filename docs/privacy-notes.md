# Game privacy notes

What the Qwakk game (`qwakk.fun/game`) stores about players, where, and for how long. This is the input for the privacy page; the proposed wording is at the end. The landing and app privacy pages are not changed by this repo.

## What we store

| Data | Where | Why | How long |
| --- | --- | --- | --- |
| Nickname and `#1234` tag | Game database (`players`) and the player's browser | Shown in matches and on the leaderboard | Until the player row is deleted (see Retention) |
| Player id (random UUID) | Game database, inside the device token | Ties match stats to the same guest | Same as the nickname |
| Device token | The player's browser only (`localStorage` key `qwakk.identity`), signed by the server | Lets the same browser keep its name, tag and stats without an account | Until the player clears site data |
| Session token | The player's browser (`qwakk.identity`) | Proves the identity to the game server for 24 hours | 24 hours, then refreshed |
| Match stats per player: placement, kills, deaths, damage, time survived, points, match mode, map, start and end time | Game database (`matches`, `match_players`) | Leaderboard and the player's own stats | Kept for past seasons (see Retention) |
| First and last seen time | Game database (`players.created_at`, `last_seen`) | Clean-up of inactive guests | Same as the nickname |
| Settings (mouse sensitivity, field of view, volume) | The player's browser only (`qwakk.settings`, `qwakk.sensitivity`) | Comfort | Until the player clears site data |
| IP address | Game server memory only | Rate limits on joins, guest creation and leaderboard reads | Not written to disk or the database. An entry is dropped once its limit has refilled (seconds to minutes) and on every server restart |
| Party membership (who is in which party, its leader) | Game server memory only | Lets friends land in the same match on one team | Not written to disk or the database. Gone when the player leaves the party or closes the page, and on every server restart |

In Duo and Squad matches the stored placement is the team's place (the same for every member) and points use the number of teams; no new data is stored for it.

Not stored: email, real names, passwords, wallet addresses, payment data, device fingerprints, chat (there is no chat). The game sets no cookies.

Notes:

- Bots are stored in match rows with no player id; they never appear on the leaderboard.
- The game server's normal logs may contain IP addresses in error messages from the hosting proxy (CapRover nginx). Those follow the host's log rotation, not this table. Check the CapRover log retention before launch.
- Nicknames pass a word filter (slurs, insults, impersonation of staff or the brand). It is a filter, not moderation.

## Third parties

- **Cloudflare Turnstile** (only when `VITE_TURNSTILE_SITEKEY` is set at build time): when a NEW guest is created, the menu loads Cloudflare's Turnstile script and the server checks the result with Cloudflare, sending the challenge token and the player's IP address (`remoteip`). Cloudflare processes this data under its own privacy policy. Returning players (with a device token) do not trigger it.
- **Fonts**: Geist and Geist Mono are bundled with the game (self-hosted), so loading the menu makes no request to Google or any font service.
- No analytics, no ad trackers.

## Retention (proposal for the owner)

- Leaderboard data is kept per season and past seasons stay visible.
- Proposed: delete guest players not seen for 12 months, with their match rows unlinked (the `match_players.player_id` foreign key is `on delete set null`, so match history stays consistent and anonymous). This is not automated yet; it is one SQL statement to schedule:

  ```sql
  delete from players where last_seen < now() - interval '12 months';
  ```

- Deletion on request: a player can clear their browser data to drop the device token, but the server can only find their row by name and tag. Deleting a row by name and tag on request is a manual SQL delete for now.

## Proposed wording for the privacy page

Paste into the privacy page under a "Qwakk game" heading. It avoids promises we do not keep.

> **Qwakk game**
>
> You can play the Qwakk game as a guest, without an account. When you pick a nickname, our game server gives you a random tag (like #1234) and a random player ID, and your browser keeps a signed device token so the same browser keeps your name and stats. We store your nickname, tag, player ID, when you first and last played, and your in-game match stats (placement, kills, deaths, damage, time survived and points). Your nickname, tag and stats can appear on the public leaderboard.
>
> Your game settings stay in your browser. The game does not use cookies, analytics or ad trackers.
>
> Our game server uses your IP address in memory to limit how often you can join matches, create a guest or load the leaderboard. We do not store it in our database. When you create a new guest, we may use Cloudflare Turnstile to check that you are human; Cloudflare receives the check and your IP address for that purpose.
>
> The leaderboard is for fun only: it has no prizes and no monetary value.
>
> We keep guest data while you keep playing and may delete guests that have been inactive for 12 months. To have your guest data deleted, contact us with your nickname and tag.

The last sentence needs a contact address on the privacy page (none exists yet; see the legal notes in the workspace).
