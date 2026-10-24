# Duck Plaza (Ördek Meydanı)

The social hub between matches, in place of the old main menu. After sign-in (or "Play as guest") and the character select, the player walks into a shared 3D town square with its duck, among the other real players, and enters a game mode by walking through its portal. After a match the duck comes back to the plaza, in front of the portal it used. No combat in the plaza at all: no weapons, no damage.

Code: shared `packages/shared/src/hub/` (`@qwakk/shared/hub`: constants, messages, the map's hub data and portal triggers; `@qwakk/shared/hub/sim`: the hub duck in the shared sim; `@qwakk/shared/hub/schema`: the room schema); server `apps/server/src/hub/` (`HubRoom.ts`, `interest.ts`, `invites.ts`, `teams.ts`, `chatFilter.ts`, `hubMap.ts`); client `apps/client/src/hub/` (the plaza scene, a dynamic import like the game) and the menu around it (`ui/menu/menu.ts`, `hubSheet.ts`, `guestCard.ts`); map `art/map/layout/gen_plaza.py`, props `art/map/blender/props_plaza.py`.

## The flow

| Step | What the player sees |
| --- | --- |
| Sign in or play as a guest | The sign-in screen (unchanged). |
| Character select | The Metin2 style select (unchanged). Play walks into the plaza. |
| Guest card (guests, the first time) | Name (server #tag) and look, then "Enter Duck Plaza". A guest with a saved name walks straight in; the sheet's Account tab has "Change name or duck". |
| Duck Plaza | The square, the other ducks with name#tag and a level badge, the three portals. |
| A portal | The server sees the duck in the opening and says go; the client joins that mode like the old Play buttons did (Quick Play; a team leader opens a fresh room that fits the team). |
| Back from a match | The plaza again, in front of that portal, with the last round card for a few seconds. Hunt Season "Play again" goes straight into the next hunt. |

Everything the old main menu had is in the sheet over the plaza (Esc, or the touch Pause button): Play (a plain list of the three modes for accessibility and for devices where the plaza cannot draw, with the same rules as the portals, plus the live room lists to pick a battle royale or deathmatch room by hand), Team (the party box: create, code, share link, leave), Leaderboard, Settings (and the language), How to play, Account (switch duck, log out, account settings; guests: sign in, change name or duck). When the plaza cannot be reached the sheet opens on Play with a note, so the game stays playable.

## The square (`duck-plaza`, `gen_plaza.py`)

- 128 x 128 m of terrain (2 m cells); a hedgerow ring closes a rounded square of about 104 x 104 m (10,600 m2). Outside: rising wooded hills. The loader's invisible walls (58 m) stay as a backstop.
- Middle: the Duck Pond (an ellipse of 12.5 x 8.5 m radii, water at 2.0 m, at most 0.62 m deep: ducks wade in it, slower) with the bronze duck statue on its island; a cobbled promenade around it with benches facing the water, lamps and flower beds.
- South: Fountain Square, where fresh ducks appear (an arc of 12 spawn spots looking at the pond and the Deathmatch gate), the fountain (ducks can hop in and paddle), market stalls, cafe tables and the leaderboard board.
- Portals: Deathmatch (north, Kavren), Battle Royale (west, Yelova), Hunt Season (east). Each on a paved apron with flower beds, lamps and a low wall behind. Walks connect the promenade to every gate.
- Six townhouses (enterable, the kit's interiors) in the corners and behind the square; oaks, apple trees and bushes in the park corners.
- 250 props (9 new plaza props in their own files: `plaza_portal`, `plaza_fountain`, `plaza_bench`, `plaza_lamp`, `plaza_statue`, `plaza_flowerbed`, `plaza_board`, `plaza_stall`, `plaza_cafe`), daytime, the same toon look and palette as the kit.
- The `hub` section of map_v1.json: portals (id, position, facing), spawns, exits per mode, the board, the pond and the fountain. Checked by `apps/server/test/duckPlaza.test.ts` (determinism, heightfield, stale copy, spawns and exits on free ground, a duck walks from the spawn through each portal and the trigger fires, the hedge ring holds, the pond is shallow).

## Rules (netcode and anti-cheat)

- Inputs only: the hub room takes the match input frame, sanitized the hub way (`sanitizeHubInput`: the match sanitizer, then only Jump, Sprint, Crouch and Walk). The server steps the same `stepPlayer` as a match and owns every position; the client predicts its own duck with the Colyseus reconciler over the 13 movement fields (`HUB_SIM_FIELDS`; every other sim field never changes with those buttons, so the reconcile is exact). The turn-rate cap and the input pacer are the game rooms'. Prediction corrections are 0 in the e2e.
- Identity: name, #tag, look and account come from `verifySession(token)`; the level is read from the database (`players.level`, written only by `recordRaid`) at join. A guest shows "Guest" (level 0). The room never sends a player id, token or address: ducks carry a pid, a session id key and a small per-room team marker (not the party code).
- Portals are decided on the server's position (`portalAt`, `PORTAL_TRIGGER`). A guest at the Battle Royale or Hunt Season portal gets a note (Locked) and a "Sign in" toast; the matchmaking guard and the rooms still refuse a guest anyway. A team member who is not the leader gets "the leader picks"; a team with a guest gets "everyone needs to be signed in" for those two modes.
- Invites: a request with the other duck's pid, rate limited per duck (a burst of 3, one more every 5 s), one open invite per invited duck, the same target again only after 6 s, the other duck within 45 m, 20 s to answer. An accepted invite joins the inviter's party (`party/PartyRoom.ts`, the same parties as before), or the hub opens a party room on the server (`matchMaker.createRoom`): the inviter gets the code first and leads, the invited duck gets it once the leader is in (the party registry, read by verified player id). Codes go only to those two ducks. The leader's portal walk then runs the party's normal "go" (the game room checks the leader holds a seat there); the team follows.
- Chat: the room chat rules (200 characters, the per-duck cooldown, never stored) plus the name word list: a word a name could not be is masked. Shown as speech bubbles over the duck for a few seconds and in the fading chat log.
- Emotes: Quack (a one-shot message to the ducks that receive the quacker's pose, and itself) and Dance (a pose flag, stops when the duck walks off), rate limited per duck.
- Interest (bandwidth only, no line-of-sight culling: there is no combat): near poses within 20 m every tick, far poses within 70 m at 10 Hz, nothing beyond (hysteresis 24 and 78 m). Owner-only movement state through the StateView, as in the game rooms.
- Rooms: `hub`, up to 40 ducks each, Quick Play fills the fullest open plaza first (sorted by clients), at most 40 plazas (`HUB.maxRooms`). The same per-IP join and room limits as the game rooms; maintenance refuses new joins. Listed in the admin dashboard (PLAZA), not in the lobby. The same duck opening the plaza again (another tab) closes the older connection.

## Client

- `hubHost.ts` enters the plaza for the menu (renderer, map, the hub loop) and hands back a small handle; `hubGame.ts` is the loop; `hubSession.ts` the room and prediction; `labels.ts` name#tag, level badge and speech bubbles (within 32 m, fading from 20 m, never through a wall, no label over your own duck); `decor.ts` the portal swirls and signs (a locked portal is grey with "Sign in to enter"), the board's top 10 (the public leaderboard API, refreshed every 2 minutes), the pond and the team and target rings; `hubUi.ts` the few UI bits; `hubAudio.ts` the synthesized ambience (breeze, birds, the fountain, portal hums, quacks).
- Desktop: click to lock the mouse; the crosshair dot picks a duck, a click opens its bubble (Invite to team, Quack; on your own duck Dance and Leave team) and frees the cursor for it. With the cursor free, a click on a duck opens its bubble, elsewhere locks again. Q quacks, B dances, T chats, Y and N answer an invite, Esc opens the sheet.
- Touch: the first tap turns the touch layer on (fullscreen and landscape where allowed); the stick, the look drag, Jump and Pause, plus Quack and Dance; a short tap on a duck opens its bubble (`TouchHooks.tap`). Portrait shows the usual rotate screen.
- The menu chunk stays free of the plaza: `hub/` is part of the game bundle (`play.ts` exports `enterHub`).
- Dev and test builds expose `window.__qwakkHub` (`hubTestHook.ts`, not in public builds): a snapshot, walk to a point, turn, open a bubble, invite, answer, chat, emote.

## Measured

`npm run bench:hub` (one hub room of 40 network clients walking, sprinting, jumping, quacking and chatting): see README (Server benchmark, Duck Plaza). `npm run e2e:hub`: two account ducks meet, invite, team up, walk into the Deathmatch portal together, come back; a guest finds Battle Royale locked and Deathmatch open; a phone in landscape.

## Later

- The Hunt Season portal points at the `raid` room; when Pond Keep ships it needs no change here (the portal opens whatever the raid room plays).
- A small "today" board next to the leaderboard board.
