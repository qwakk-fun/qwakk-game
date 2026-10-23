# Cookie and Storage Notice: Qwakk game

<!-- Draft for legal review. Placeholders are written [[LIKE_THIS]] and are listed in README.md. Keep the table in step with every localStorage key in apps/client/src. -->

Version [[LEGAL_VERSION]] (draft). Last updated [[LEGAL_UPDATED]].

Short version: the Qwakk game sets **no cookies** for players and uses **no tracking** of any kind. It keeps a few small values in your browser's local storage because the game cannot work without them. Strictly necessary storage like this does not need your consent, so there is nothing to switch on or off.

## What the game keeps in your browser

All of these live in your browser's local storage for play.qwakk.fun. They are not cookies, they are not shared with other websites, and they stay until you sign out or clear your browser's site data.

| Name | What it holds | Why it is needed |
| --- | --- | --- |
| `qwakk.identity` | Your guest's signed device token and your current session token | Keeps you the same guest and proves to the game server who you are |
| `qwakk.account` | Your account's sign-in token, your email, the duck you picked last and that duck's current game session token | Keeps you signed in until you log out or the session ends, and opens the character select on your duck |
| `qwakk.entry` | That you chose to play as a guest on this browser | So the sign-in screen does not come back on every visit |
| `qwakk.character` | The duck look you picked last | So the menu opens with your duck |
| `qwakk.settings`, `qwakk.sensitivity` | Game settings such as mouse and touch sensitivity, field of view, volume and graphics | Your comfort settings |
| `qwakk.language` | English or Turkish | Shows the game in your language |
| `qwakk.storage-notice` | That you closed the storage notice, and which version | So the notice does not come back on every visit |

The game also keeps things in memory while the page is open, such as the last chat messages of your room. They are gone when you close the tab.

## Cloudflare Turnstile

When we have it switched on, the game uses Cloudflare Turnstile, a check that tells people from bots, for example when you create a guest [[or request a sign-in code]]. Your browser then loads the check from Cloudflare, which processes your IP address and technical details from your browser for that check only. We use it to keep bots and abuse out, which is part of running the game safely. [[VERIFY: whether Turnstile stores anything on your device; Cloudflare states it does not use cookies for this check]]. See section 6 of the Privacy Policy.

## The admin panel

The owner's admin panel at play.qwakk.fun/admin sets one strictly necessary session cookie for the signed-in admin. Players never get it.

## What we do not use

- No analytics or statistics tools
- No advertising or retargeting
- No social media buttons or trackers
- No third-party fonts (the fonts are part of the game)

## How to remove it

Sign out to remove your sign-in token. To remove everything, clear the site data for play.qwakk.fun in your browser settings. A guest that is cleared this way cannot be restored. Your account and ducks stay safe on our server: sign in again with your email.

## The notice banner

Because nothing optional is stored, the banner only informs. It has one button and a link, and the game works the same whether or not you press OK. It never blocks play.

| | English | Turkish |
| --- | --- | --- |
| Text | Quack. We only keep what the game needs in your browser: your duck, sign-in and settings. No tracking, no ads. | Vak. Tarayıcında sadece oyunun ihtiyacını tutuyoruz: ördeğin, girişin ve ayarların. Takip yok, reklam yok. |
| Link | Storage notice | Depolama bildirimi |
| Button | OK | Tamam |
| Screen reader label | Storage notice | Depolama bildirimi |

The link opens this notice. Pressing OK saves [[NOTICE_KEY]] with the current version, so the banner only comes back when this notice changes.

## If analytics or anything optional is ever added

Then the banner must turn into a real choice before anything optional is stored or loaded:

1. Update this notice and the Privacy Policy first: the tool, the provider, what it stores, how long, and where the data goes.
2. Load nothing optional until the player says yes. Not before the banner, not while it is open.
3. Give "Accept" and "Reject" the same size, color and number of clicks. No pre-ticked boxes, and closing the banner counts as no.
4. Add a "Storage settings" link in the menu footer so a player can change the choice at any time, as easily as giving it.
5. Store the choice with its version and time, and ask again when the notice changes.
6. For players in Turkey, follow the KVKK cookie guidance (explicit consent for anything that is not strictly necessary); for EU players, the ePrivacy rules of their country.

A cookieless or self-hosted analytics tool does not remove this by itself: reading or writing anything on the device that the game does not strictly need still needs consent in many EU countries. Have a lawyer confirm the setup before launch.
