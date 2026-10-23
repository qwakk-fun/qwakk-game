# Privacy Policy: Qwakk game

<!-- Draft for legal review. Placeholders are written [[LIKE_THIS]] and are listed in README.md. Keep this in step with docs/privacy-notes.md, the migrations and the code: every row below must match what the server really stores. -->

Version [[LEGAL_VERSION]] (draft). Last updated [[LEGAL_UPDATED]].

This policy explains what the Qwakk game at play.qwakk.fun collects about you, why, who else sees it, how long we keep it and what you can do about it. We collect as little as the game needs. No ads, no analytics, no selling data, no tracking cookies.

## 1. Who is responsible

The Qwakk game is run by [[OPERATOR_NAME]], [[OPERATOR_ADDRESS]] ("we", "us"). We are the controller of your personal data under the EU and UK General Data Protection Regulation (GDPR) and the data controller (veri sorumlusu) under Turkey's Personal Data Protection Law No. 6698 (KVKK).

Contact for anything in this policy: hello@qwakk.fun

## 2. The short version

- **Guests:** a nickname, a tag and match stats. Your browser keeps a signed token so it stays the same guest.
- **Accounts:** your email address, your sign-in sessions, which version of our terms you accepted and when, whether you want news emails, up to 4 ducks with their progress and match stats.
- **Public:** duck names, tags, looks and stats appear in matches and on the leaderboard. Chat messages are seen by everyone in the room.
- **Never collected:** passwords, real names, phone numbers, payment details, device fingerprints, location.
- **Your IP address** is used only in our server's memory for abuse limits and is not saved in our database.
- **You can delete your account** and its data yourself from the account screen.

## 3. What we collect, why, and on what basis

The "legal basis" column names the GDPR article first and the matching KVKK article second.

### Account

| Data | Why | Legal basis | How long |
| --- | --- | --- | --- |
| Email address | To create your account, send your sign-in codes and contact you about your account | Contract (GDPR Art. 6(1)(b); KVKK Art. 5(2)(c)) | Until you delete your account |
| Sign-in codes (6 digits) | To check that the email is yours | Contract | Until used or expired (10 minutes), then deleted. We keep them only in a form that cannot be read back [[VERIFY_CODE_STORAGE]] |
| Sign-in sessions: when each session started, was last used and expires | To keep you signed in and let you sign out | Contract | Until you sign out, the session expires ([[SESSION_LIFETIME]]) or you delete your account |
| The version of the Terms of Use you accepted and when, and confirmation that you are 16 or older | To show which terms apply to you and that you met the age rule | Legitimate interest in being able to prove it (GDPR Art. 6(1)(f); KVKK Art. 5(2)(e)) | Until you delete your account |
| News email choice: yes or no, and when you chose it | To send game news only if you asked for it, and to prove that you did | Consent (GDPR Art. 6(1)(a); KVKK Art. 5(1) explicit consent, and Turkey's Law No. 6563 on commercial electronic messages) | Your choice: until you delete your account. The record of when you agreed and when you withdrew: [[CONSENT_RECORD_RETENTION]] |

### Ducks (characters) and stats

| Data | Why | Legal basis | How long |
| --- | --- | --- | --- |
| For each of up to 4 ducks: name, tag (like #1234), look and cosmetics, level, XP, quests and streaks | To run your ducks and their progress | Contract | Until you delete the duck or your account |
| Match stats per duck: placement, kills, deaths, damage, time survived, points, mode, map, start and end time | The leaderboard and your own stats | Contract | Kept per season, and past seasons stay visible. When a duck or account is deleted, its match rows stay in the history with no link to you |
| First and last time played | To clean up inactive guests and accounts | Legitimate interest | Same as the duck or account |

### Guests

| Data | Why | Legal basis | How long |
| --- | --- | --- | --- |
| Nickname, tag, a random player ID, match stats, first and last time played | So you can play without an account | Contract | We may delete guests not seen for [[GUEST_INACTIVE_PERIOD]]. To have a guest deleted sooner, email us its name and tag |

### Chat

Room chat messages go through our game server to the players in that room, together with your duck's name and tag. **We do not save chat messages.** They exist only in the memory of the room and of the players' browsers while the match runs. Messages can be up to 200 characters, and other players may of course take screenshots. Legal basis: contract.

### Fair play and moderation

| Data | Why | Legal basis | How long |
| --- | --- | --- | --- |
| Bans and suspensions: which duck, guest or account, the reason, start and end, which admin session set it | To keep rule breakers out | Legitimate interest in a fair and safe game (GDPR Art. 6(1)(f); KVKK Art. 5(2)(f)) | While the ban lasts, then up to [[ENDED_BAN_RETENTION]] |
| Ducks hidden from the leaderboard: which duck, the reason, which admin session | To keep cheaters and offensive names off the public board | Legitimate interest | Until we show the duck again or it is deleted |
| Moderation log: the time, the action and its target (which can include a duck's name and tag) | Accountability for every moderation step | Legitimate interest | Up to [[AUDIT_LOG_RETENTION]], also after the duck or account is deleted |

### Technical data

| Data | Why | Legal basis | How long |
| --- | --- | --- | --- |
| IP address | Limits on how often an address can join, connect, create a guest, ask for a sign-in code or load the leaderboard, and short blocks after abuse | Legitimate interest in keeping the game running and safe | Server memory only, never written to our database. Dropped after seconds to minutes, a block lasts at most 24 hours, and everything is cleared on each server restart |
| Party membership (who is in which party, its leader) | So friends land in the same match | Contract | Server memory only. Gone when you leave the party, close the page or the server restarts |
| Standard server logs of our hosting setup, which may include IP addresses in error messages | Security and fixing problems | Legitimate interest | [[SERVER_LOG_RETENTION]] |

## 4. Emails we send

- **Sign-in codes and account emails** (for example when you delete your account or when our terms change). We send these because they are part of the service. You cannot turn them off while you have an account.
- **Game news**, only if you ticked the news box. Every news email has an unsubscribe link, and you can also switch news off on the account screen. Switching it off does not affect your account.

Emails are sent from noreply@qwakk.fun. Replies to that address are not read: write to hello@qwakk.fun instead.

## 5. What is public

Your ducks' names, tags, looks and match stats are shown to other players in matches and on the public leaderboard. Your email address is never shown to other players. Chat messages are seen by everyone in the room at that moment.

## 6. Who helps us run the game

We use a few service providers who process data only on our instructions:

| Provider | What they do | Data they handle | Where |
| --- | --- | --- | --- |
| Hetzner Online GmbH | Hosts our game server and database | Everything stored on our server | Germany |
| [[EMAIL_PROVIDER_ENTITY]] (Hostinger) | Sends our emails | Your email address and the content of the email (such as your sign-in code) | [[EMAIL_PROVIDER_LOCATION]] |
| Cloudflare, Inc. (Turnstile), only when we have the human check switched on | Checks that you are a person and not a bot, for example when you create a guest [[or request a sign-in code]] | Your IP address and technical details your browser sends to Cloudflare during the check | United States and Cloudflare's global network |

During a Turnstile check your browser loads Cloudflare's check directly and our server confirms the result with Cloudflare, sending your IP address. Cloudflare uses this data for the check under its own privacy terms. Legal basis: our legitimate interest in keeping bots and abuse out.

Fonts are part of the game itself, so loading the game makes no request to Google or any other font service. We use no analytics, advertising or social media trackers.

We do not sell your data or share it with advertisers. We may disclose data if the law requires it, or to protect players and the game against fraud or abuse.

## 7. Data outside your country

Our servers are in Germany, in the European Union. If you play from outside the EU, your data travels to Germany.

- **Cloudflare** is based in the United States. Transfers to it rely on [[GDPR_TRANSFER_BASIS_CLOUDFLARE]].
- **For players in Turkey:** storing data in Germany and using the providers above is a transfer abroad under KVKK Article 9. We rely on [[KVKK_TRANSFER_BASIS]].

## 8. How long we keep data

The tables above give the period for each kind of data. In short:

- Your account and ducks: until you delete them, or until your account has been inactive for [[ACCOUNT_INACTIVE_PERIOD]] [[and we have emailed you a warning first: only if this is implemented]].
- **When you delete your account,** we delete your email address, sessions, terms and news records, ducks, names, progress and cosmetics. Match rows stay in the match history without any link to you or your names, so other players' results stay correct. The only things we may keep are the records listed above for bans and the moderation log, for the periods shown there, and anything the law requires us to keep.
- Backups of our database are overwritten within [[BACKUP_RETENTION]].

## 9. Your rights

Depending on where you live you have the right to:

- **access** the personal data we hold about you,
- **correct** it if it is wrong,
- **delete** it (on the account screen, or by email),
- **export** it: we send you a copy in a common machine-readable format,
- **object** to processing based on our legitimate interest,
- **restrict** processing in some cases,
- **withdraw your consent** to news emails at any time (account screen or the unsubscribe link). This does not affect what we did before.

**Under KVKK (Article 11)** you can also learn whether your data is processed, the purpose and whether it is used for that purpose, which third parties in Turkey or abroad receive it, ask that third parties are told about a correction or deletion, object to a result that is against you and comes only from automated processing, and claim compensation for damage caused by unlawful processing.

To use any right, email hello@qwakk.fun. Writing from the email address on your account helps us confirm it is you. For a guest, include its name and tag. We answer within one month (GDPR) and within 30 days (KVKK), and it is free.

You can also complain to a data protection authority: in the EU, the authority in your country; in Turkey, the Personal Data Protection Authority (Kişisel Verileri Koruma Kurumu), after you have first contacted us.

## 10. Age

The game is for people aged 16 and older. We do not knowingly collect data from anyone younger. If you think a child under 16 has an account, tell us at hello@qwakk.fun and we will delete it.

## 11. Security

Sign-in uses one-time codes instead of passwords, so there is no password of yours we could leak. Connections to the game are encrypted (HTTPS and secure WebSockets). The admin panel is open only to the owner and needs a password plus a second factor. No system is perfectly safe: if a breach affects your data, we will tell you and the authorities as the law requires.

## 12. Browser storage

The game keeps a few small values in your browser so it works (your guest or sign-in token, your last picked duck, language and settings). It sets no cookies for players. Details: [[COOKIES_NOTICE_URL]].

## 13. Changes

If we start collecting something new or use data in a new way, we update this policy first and ask you to look at the new version the next time you sign in.
