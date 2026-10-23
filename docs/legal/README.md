# Game legal drafts

Drafts for the Qwakk game's legal pages and account-flow copy. None of this is live yet and none of it has been reviewed by a lawyer.

| File | What it is |
| --- | --- |
| `terms.md` | Terms of Use for the game |
| `privacy.md` | Privacy Policy (GDPR and KVKK) |
| `cookies.md` | Cookie and storage notice, plus the notice banner text |
| `ui-copy.md` | English and Turkish copy for sign-in, sign-up, ducks, account screen, errors and the emails |

The texts follow the tone and structure of the DEX's pages (`qwakk-app/app/terms`, `/privacy`, `/risk`, `lib/legal.ts`) and the data table in `../privacy-notes.md`. No em dashes.

## Versioning

- One version string covers the Terms, the Privacy Policy and the storage notice, like the DEX: `LEGAL_VERSION = "2026-10-23"` (the date of the version, `YYYY-MM-DD`), with a readable `LEGAL_UPDATED = "October 23, 2026"` for the page header. Replace `[[LEGAL_VERSION]]` and `[[LEGAL_UPDATED]]` with them when the pages are built.
- At sign-up, store with the account: the accepted `LEGAL_VERSION` and the time. On the news box, store yes or no, the time, and `MARKETING_TEXT_VERSION` (a short id for the exact wording shown, for example `2026-10-23`), because the consent proof is the wording the player saw.
- Bump `LEGAL_VERSION` on any meaningful change (new data, new purpose, new provider, new rules). A signed-in player with an older version sees the "updated terms" step in `ui-copy.md` section 5. Typo fixes do not bump it.
- Withdrawing news consent writes a new row or field with the time. Do not overwrite the original yes; it is the proof that the earlier emails were allowed.
- Keep every published version (Git history is enough if the pages are built from these files, otherwise copy each old version to `archive/`).

## Open placeholders

Every placeholder is written `[[LIKE_THIS]]`. Search the folder for `[[` before publishing.

| Placeholder | Where | What is needed |
| --- | --- | --- |
| `[[OPERATOR_NAME]]`, `[[OPERATOR_ADDRESS]]` | terms, privacy | The person or company that runs the game. A real name and address are needed for GDPR (controller identity) and KVKK (veri sorumlusu) |
| `[[GOVERNING_LAW]]`, `[[VENUE]]` | terms | Governing law and courts. Decide with the entity |
| `[[LIABILITY_CAP]]` | terms | A fixed amount for a free game, for example 100 euros. Lawyer to confirm |
| `[[LEGAL_VERSION]]`, `[[LEGAL_UPDATED]]` | all three | See Versioning |
| `[[SESSION_LIFETIME]]` | privacy | The account session length the account system uses |
| `[[VERIFY_CODE_STORAGE]]` | privacy | Confirm the server stores only a hash of each code and deletes used or expired codes. If not, change the sentence |
| `[[CONSENT_RECORD_RETENTION]]` | privacy | How long the news consent record is kept after withdrawal or account deletion. Check the Turkish rule under Law 6563 (believed to be 3 years, not verified) |
| `[[GUEST_INACTIVE_PERIOD]]` | privacy | Proposed 12 months (`../privacy-notes.md`), not automated yet |
| `[[ACCOUNT_INACTIVE_PERIOD]]` | privacy | Proposed 24 months. Remove the warning-email clause unless that email is built |
| `[[ENDED_BAN_RETENTION]]`, `[[AUDIT_LOG_RETENTION]]` | privacy | Proposed 12 months each (`../privacy-notes.md`), not automated yet |
| `[[SERVER_LOG_RETENTION]]` | privacy | CapRover and nginx log rotation on the server. Not checked |
| `[[BACKUP_RETENTION]]` | privacy | Whether database backups exist and how long they live. Delete the line if there are none |
| `[[EMAIL_PROVIDER_ENTITY]]`, `[[EMAIL_PROVIDER_LOCATION]]` | privacy | The Hostinger company that contracts the email service and where its mail servers are. Check the Hostinger account and its data processing terms |
| `[[GDPR_TRANSFER_BASIS_CLOUDFLARE]]` | privacy | Usually the EU-US Data Privacy Framework or Cloudflare's Standard Contractual Clauses. Lawyer to confirm |
| `[[KVKK_TRANSFER_BASIS]]` | privacy | The basis for sending Turkish players' data to Germany and to the providers (KVKK Art. 9, as changed in 2024). Lawyer to decide |
| `[[or request a sign-in code]]` | privacy, cookies | Keep only if Turnstile also guards the code request |
| `[[ACCOUNT_SESSION_KEY]]`, `[[NOTICE_KEY]]` | cookies | The real localStorage keys once built (proposed `qwakk.storage-notice` for the banner) |
| `[[VERIFY: ... Turnstile ...]]` | cookies | Confirm on Cloudflare's current Turnstile privacy terms whether it stores anything on the device |
| `[[COOKIES_NOTICE_URL]]` | privacy | The URL of the storage notice |
| `[[MARKETING_TEXT_VERSION]]` | ui-copy | See Versioning |

## Facts to check against the account system before publishing

These sentences are written from the brief, not from built code. Change the text if the code differs.

- Codes: 6 digits, valid 10 minutes, one use, a limit on wrong tries, and requesting a new code makes the old one stop working (the copy "Use the newest one" assumes this).
- Deleting a duck or an account deletes its name, progress and cosmetics, and its match rows stay with no link (like the guest rule `on delete set null`). The leaderboard then no longer shows it.
- Sessions store only start, last use and expiry. If the user agent, IP or device name is stored, add it to the privacy table.
- Emails, codes and tokens never appear in server logs.
- The email shows no tracking pixel and no tracked links.

## Needs a lawyer or an entity

- **Operator identity, governing law, venue, liability cap.** Nothing can be final without the entity.
- **KVKK.** Transfer abroad (servers in Germany, Hostinger, Cloudflare in the US) under Art. 9; whether VERBİS registration is needed; a Turkish-language privacy notice (aydınlatma metni) for Turkish players, since the game has a Turkish menu. The English draft is not enough on its own for Turkey.
- **Marketing emails from Turkey.** Law No. 6563 consent rules and whether the sender must register with İYS (İleti Yönetim Sistemi) before the first news email. Do not send news until this is checked.
- **Players aged 16 and 17.** Whether a 16 or 17 year old can accept the terms alone in the main markets, and whether the parent or guardian line in the terms is enough.
- **EU Digital Services Act.** Names and room chat are user content, so we likely count as a hosting service: a contact point, a way to report content and a statement of reasons when we act against an account. The terms cover these by email today; check whether that is enough.
- **Ban and deletion.** Deleting an account deletes the email, so a banned player can come back with the same email. Keeping a hash of a banned email after deletion would stop that but is new data and needs a basis and a line in the privacy policy.
- **Consumer law.** The "as is" and liability sections are written to give way to mandatory consumer rights. Check the wording for the EU and Turkey.

## Other docs that need an update (not changed here)

- `../privacy-notes.md` says "chat (there is no chat)". There is a room chat: messages are relayed by the server (`apps/server/src/chat.ts`, `gameRoom.ts`), up to 200 characters, and not stored. It also does not yet list email, accounts, codes, sessions, consent records or characters. The account work should add those rows.
- `apps/client/src/ui/menu/copy.ts` links the footer to `https://qwakk.fun/terms` and `https://qwakk.fun/privacy`. The landing (`qwakk-landing/app`) has no such pages today, so those links are dead. Decide where the game's legal pages live (for example `play.qwakk.fun/terms`) and point the links there.

## Wallet sign-in (add only when it ships)

Draft paragraph for `privacy.md` section 3 once QoreX sign-in works:

> **Wallet sign-in.** If you link a QoreX wallet, we store its public address (qor1...) with your account so you can sign in with it. We use it only to recognise you: it never earns rewards and we never ask for your recovery phrase or a transaction. Wallet addresses and their activity on QoreChain are public by design. Legal basis: contract. Kept until you unlink the wallet or delete your account.
