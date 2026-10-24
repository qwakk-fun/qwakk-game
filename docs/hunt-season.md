# Hunt Season (Av Sezonu)

Hunting season opened and the ducks cut their way out. A co-op PvE mode in the spirit of an action MMORPG: 1 to 4 signed-in ducks (parties welcome) start in **Pond Keep**, a duck castle on a pond island (map `pond-keep`, `docs/pond-keep.md`), draw their katanas and push out across the field through hordes of duck hunters, objective by objective: the trench, the supply crates, the watchtowers and finally the Big Hunter's camp. It is the mode that gives a duck XP, levels and Tüy (Feathers). Here a duck grows (`docs/progression.md`): its level unlocks the katana's moves and skill points for a small tree, and Tüy buys better katanas and armor at Duck Plaza's Blacksmith and Armorer, a few percent at a time. Nothing about a level, the gear or the tree changes the deathmatch or the battle royale (levels stay cosmetic in PvP), and the katana exists only here (the deathmatch and the battle royale stay guns only).

**Tüy is an in-game soft currency earned only by playing Hunt Season. It is never sold for real money, never tradeable and never a token.** No crypto rewards.

Code: shared `packages/shared/src/raid/` (`blade.ts` the katana in the sim, `arc.ts` the hit shapes and the sweep, `push.ts` the objectives and the horde math, `hunters.ts`, `progress.ts` XP, `upgrades.ts` the cards; the keep: `markup.ts`, `keep.ts`, `cannon.ts`, `man.ts`, `root.ts`); server `apps/server/src/raid/` (`blade.ts` the katana's hits, `push.ts` the director, `hunts.ts`, `brain.ts`, `hunter.ts`, `travel.ts`, `keepWorld.ts`, `raid.ts` the rules) and `apps/server/src/RaidRoom.ts`; results `apps/server/src/meta/raid.ts` and migrations 004 to 006; client `apps/client/src/game/raidClient.ts`, `game/raid/` (`bladeFeel.ts` the feel, `campDecor.ts`, the hunter looks, `keepView.ts`), `player/meleeRig.ts`, `player/meleeArt.ts`, `player/katanaTrail.ts` (the katana on the duck), `hud/raid/` (`raidHud.ts`, `bladeHud.ts`); menu: the Hunt Season portal in Duck Plaza (east) and its row in the sheet's Play list, the XP bar.

## A run

| Stage | What happens |
| --- | --- |
| Lobby | Ducks gather in the courtyard, no damage. The first duck starts a 15 s countdown (`raid.lobbySeconds`), each later one adds 5 s, four ducks start in 5 s; at most 30 s after it first started. The room locks when the run starts. |
| Objective | One of the four objectives is in play (below). Packs of minions with elites come out of the trench exits and dugout doors near it and charge the ducks; its ground is their rally point, so the fight meets the ducks out in the field. |
| Break | The objective is taken: the hunters still standing flee (no kills, no drops). 8 s (`raid.breakSeconds`): every duck picks one of three cards (keys 1 to 3, or a tap; the timer picks one at random). Fallen ducks come back beside a friend still standing (a spot checked for room for the duck, ground under it within a step of the friend's and no wall between them; in the castle when there is none or no friend is standing), with 60% health; knocked ones get up with 50%, standing ones heal 25%; the pistol's reserve refills. |
| Won / lost | Won when the Big Hunter falls. Lost when no duck is standing (knocked or out) at once. The end screen shows the run, the XP and the Tüy, and after a level-up the moves it unlocked and the new skill points; the room closes 60 s later. |

| # | Objective | Where (Pond Keep) | Taken when |
| --- | --- | --- | --- |
| 1 | Clear the trench | the trench line in front of the gate on its right (the south-east one) | `raid.push.trenchKills` hunters (28 solo, times 1, 1.5, 2, 2.5 for 1 to 4 ducks) are bagged within 38 m of it |
| 2 | Smash the supply crates | by the two southern dugout doors and on the road between them | every crate (`raid.push.crates`, 3) is smashed: `raid.push.crateHp` (150, 35% more per extra duck) each, by cuts or bullets |
| 3 | Take the watchtowers | the two southern watchtowers (the highest perches in front of the gate) | the snipers placed on their platforms (`raid.push.snipersPerTower`, 2 each) are down; riflemen guard the towers' feet |
| 4 | Storm the Big Hunter's camp | the far end of the hunters' road, 100 m out from the gate | the Big Hunter is down |

A solo run takes about 10 to 12 minutes, a team is faster (more damage, the counts grow slower than the team). The castle is the start and the fallback: the gate, the drawbridge on its lever and the four bread cannons still work as in v2 (below). The QoreChain core no longer ends a run; ducks that hide in the castle for more than 40 s of an objective draw the hunters to its gate (they hammer it while the drawbridge is down, wait on the bank while it is up, and come in once it breaks).

Ducks use the battle royale knock and revive: at 0 health a duck is knocked (it crawls and bleeds out in 30 s), a friend holds Use next to it for 5 s to revive it (faster with the revive card). No friendly fire. A knocked duck that bleeds out is out until the next break; while out its camera follows a living friend. A lone duck has a second wind once an objective: knocked with nobody to revive it, it holds Use for 8 s to get up by itself.

## The katana (Hunt Season only)

Every duck carries a katana (the weapon in hand) and, from level 3, the pistol (the secondary: snipers, a crate out of reach). No rifle, no grenades, no rocket launcher here; the deathmatch and the battle royale never hand out the katana. A fresh duck has the light combo only; the other moves come with its level: Dash at 2, the pistol at 3, "VAK!" at 4, the charged heavy at 6, the Blade Storm at 8 (`docs/progression.md`; a locked move's button shows a padlock and its level, the server masks it).

| Move | Desktop | Phone | What it does |
| --- | --- | --- | --- |
| Light combo | Click (tap) | Fire (tap) | Slash 1, 2, 3: a press during a swing is buffered and chains at the combo window (Slash 1: impact on tick 4, chains from tick 5, recovers on 8, the window shuts on 13; Slash 2: 4, 6, 9, 14; Slash 3, the overhead finisher: impact on 9, recovers on 12). Each cut steps the duck forward a little and slows it while it swings. |
| Heavy spin | Hold, let go | Hold Fire, let go | Held past a swing's recovery the duck charges (up to 0.8 s, slower on its feet); the release spins all the way round, wider and harder the longer the charge (a full charge is a crit). |
| Dash | X | Dash | A 4.5 m lunge in 0.2 s along the move keys (straight ahead without any), through hunters (each one on the path is cut once), invulnerable for its first 5 ticks; 2.2 s cooldown. Blocked (a wall, the gate, a closed drawbridge, a prop: the move clipped under 30% of its speed along its line, or turned back) it ends on the spot, with the cooldown running; at an angle it slides along the wall; off a ledge it carries on and drops. |
| "VAK!" Quack Shockwave | Q | VAK! | The duck roots for 11 ticks and quacks: a ring from its feet to 5.5 m that shoves, staggers and knocks minions off their feet (a little damage); 8 s cooldown. |
| Blade Storm (ultimate) | F | Storm | With its meter full: 4 s of spinning, a cut all around every 0.2 s, moving at 85%. The meter fills from landed hits and kills (server written). |
| Pistol | 2 (1 for the katana, or the wheel) | Swap | The usual pistol (Aim and Reload show with it on a phone). |

Desktop keys: R stays Reload (the pistol), so the ultimate is F; Q was free; Dash has its own key, X (Shift only sprints: a sprint key that sometimes lunges read as a bug; Space is Jump, C Crouch, Alt Walk, V the shoulder, E Use, all taken). The touch layer shows Dash where Aim sits (Aim and Reload only with the pistol), VAK! and Storm in the grenade and rocket spots, each with its cooldown sweeping over it (`input/touch/`); Fire slashes on a tap and charges while held.

### Authority and determinism

- Inputs only: the skill buttons are three new input bits (`Button.Dash`, `Quack`, `Storm`, bits 16 to 18; `PlayerInput.buttons` and `PlayerState.prevButtons` are uint32 now). Every other room masks them off when it sanitizes an input (`GameRoom.allowSkills`), and a duck without the katana never reads them anyway. Stand-in steps never press them, and hold Fire exactly where the last step had it while the katana is out, so a stand-in never swings and never lets a heavy spin go.
- The swing state, the combo step, the buffered press, the charge, the cooldowns, the storm and the dash's movement are part of the shared sim (`raid/blade.ts`, stepped by `stepPlayer` on both sides), so the owner predicts its own duck exactly; the e2e checks 0 corrections while dashing, cutting, quacking and spinning. No PlayerState field was added. The bit map (a katana duck carries no rifle, grenades or rockets, and there is no caped hero in Hunt Season):

| Field | Bits | Meaning |
| --- | --- | --- |
| `arms` | bit 2 | the katana (`WeaponId.Katana` = 2); `weapon` 2 while it is in hand |
| `mag0` | 0..3 | `BladeAct`: idle, slash 1 to 3, charge, heavy, draw |
| `mag0` | 4 | a buffered Fire press (the next slash) |
| `mag0` | 5..7 | the heavy's charge in eighths (kept from the release to the impact) |
| `res0` | 0..7 | ticks into the act (saturates at 255) |
| `ex` | 0..6 | the Dash timer: counts down from 66; dashing while above 60 |
| `ex` | 7..14 | the Quack timer: counts down from 240; casting while above 229 |
| `ex` | 15 | the charged heavy is locked (`EX_HEAVY_LOCK`: the duck's level is under 6; the server sets it at a spawn) |
| `ex` | 16..18 | free |
| `ex` | 19..31 | the keep (the trap root, the manned cannon, the cannons taken: unchanged) |
| `dmEnergy` | 0..7 | the Blade Storm: 0 to 100 its meter (written by the server), 128 + n storming with n ticks left |

- The swing timings come from the art's clip events (`apps/client/public/models/melee/melee.json`) at 30 Hz; the dash follows the clip's per-frame progress curve (scaled to 4.5 m; the clip's own reach is 3 m). These are constants (`BLADE`, `DASH`, `QUACK`, `STORM`): the client simulates them, so they change only with a deploy, and no card ever changes them.
- Hits are server side only (`apps/server/src/raid/blade.ts`): the sim says when a swing lands (`lastBlade`: up to four events a step, so a storm pulse, a quack's impact, a dash tick and a slash landing on the same tick all count), and right after that duck's step the server sweeps the swing's shape (`raid/arc.ts`) against the hunters as the duck saw them: the lag compensated hunter history at the step's view time, bounded by the round trip the server measured and the 230 ms cap, exactly like a shot. A wall between the duck and a hunter stops the cut (`BULLET_QUERY_GROUPS`). Every hunter inside the shape is hit once per swing, so one swing cuts several. The client never sends a hit.
- The client predicts only the feel of its own swings (`game/raid/bladeFeel.ts`): the trail, the whoosh, the slash arc, and the same arc test against the hunters as drawn: a predicted hit freezes the duck's and those hunters' clips for 55 to 95 ms (hit-stop), throws sparks and gives the camera a small kick. Damage numbers, the combo and kills come from the server (`Msg.RaidHits`, the state).

### Hit shapes (`raid/arc.ts`)

Slices of a disc around the feet, from the art's measured blade reach and sweep with forgiveness added (the client draws the slash arc at the same radius); height window from 0.6 m under the feet to 2.4 m over them.

| Swing | Shape |
| --- | --- |
| Slash 1, 2 | 2.6 m, 95 degrees either side (turned 10 and -5 degrees) |
| Slash 3 | a 1.9 m disc 1.5 m ahead (the chop) |
| Heavy spin | all round, 3.0 m, plus 0.9 m at a full charge |
| Blade Storm pulse | all round, 3.0 m |
| Quack | all round, 5.5 m |
| Dash | 1.2 m either side of the path |

### What a cut does (server numbers, `raid.blade.*`)

| | Default |
| --- | --- |
| Slash 1, 2, 3 | 24, 24, 42 damage (a Recruit has 20, a Beater 40) |
| Heavy spin | 34, plus up to 40 with the charge |
| Storm pulse, Quack, Dash | 12, 10, 16 |
| Crit (a back-stab, a fully charged heavy) | x1.6 |
| Stagger | 0.35 s for a minion (the finisher 1.6 times, the heavy 1.5), elites half, the Big Hunter a quarter |
| Knockback | slashes 1.6 m/s, the finisher 6, the heavy 7 to 11, the quack 15 (times `raid.blade.knockScale`; elites less than half, the Big Hunter a tenth); the finisher, the heavy and the quack knock minions off their feet (`HunterAct.Launched`, 1.5 s) |
| Storm meter | +1.2 per landed hit, +3 per kill (100 fills it) |
| Combo | grows with every landed hit, resets 3 s (`raid.blade.comboSeconds`) after the last; its bonus on kill XP is 1% a hit, at most +50% |

## The horde

| Kind | Health (first objective, solo) | Moves | Fights |
| --- | --- | --- | --- |
| Beater (minion, a lanky villager with a big wooden spoon) | 40: two light cuts | 3.2 m/s, charges at 4.9 | hears a duck within 24 m whichever way it faces, charges, winds up (art Bonk: the spoon lands at 0.38 s) and hits for 6 within 2 m |
| Recruit (minion, a kid-sized hunter with a butterfly net) | 20: one light cut | 3.4, charges at 5.3 | the same, 4 damage |
| Rifleman, trapper, decoy thrower, dog (elites) | 110, 140, 100, 55 | as before | as before, but they come at the ducks (no cover, no sniping from afar): riflemen close to 14 m; a glowing ring under them |
| Sniper | 70 | on its perch | placed on the watchtowers for objective 3; the long laser and glint as before |
| Big Hunter | 1,800 (40% more per extra duck) | 2.6 | his camp's boss; whistles up dogs and Beaters (they give no kill XP and drop nothing) |

Health grows 8% per objective and 12% per extra duck (`hunterHpScale`, times `raid.hunterHpScale`). At most 3 minions wind up a swing at one duck at once (a horde, not a blender); a wound-up swing needs the duck still in reach and in sight when the blow lands.

Packs (`push.ts`): every 9, 7.5, 6.5, 6 s on objectives 1 to 4 (times `raid.push.packGapScale`), 6 to 9 minions solo (bigger later and with more ducks, up to 16), about 55% Beaters, escorted by 0 to 2 elites (one less likely on a solo duck's first objective, one more with three or four ducks). They come out of a trench exit or dugout door within 75 m of the objective, never within 25 m of a standing duck. At most `raid.maxLive` hunters alive with four ducks (44), 55% of it solo (24), 15% more per extra duck; packs wait their turn, and a pack bigger than the cap could ever hold shrinks to fit (with room for its elites), so no `raid.maxLive` or `raid.waveScale` the panel allows can stop the packs for good. Hunters stuck in a pocket of the map regroup at a trench exit (never defeated by it).

Defeated hunters drop ammo (22%) or a small heal (12%); minions a third as often; the boss drops both.

Hunters are server-only AI actors with the bot fairness rules (line of sight only, a reaction delay, an aim error that settles, a random spread, a visible telegraph before every attack, no shot without a clear line). Hitboxes from the art contract (`raid/hunters.ts`; the minions from `hunters.json`), lag compensated like a duck's.

## The keep (Pond Keep)

The castle's moving parts are those of v2 (drawbridge on its lever, the repairable gate, the four bread cannons on the towers); the core stays in the courtyard but no longer ends a run. The rules that keep a duck's prediction exact (`ex` and `dmBuff` bits, static colliders only) are unchanged (below).

| Part | Rules | Numbers (admin settings) |
| --- | --- | --- |
| Main gate | Hunters hammer it only while ducks hide in the castle (after 40 s of an objective). Ducks pass through its 1.5 m wicket; a broken gate is the `KEEP_GATE_OPEN` bit. | `raid.gateHp` 700, `raid.gateDamageScale`, `raid.gateRepairPerSecond`, `raid.gateBreakRepairPercent` |
| Drawbridge | The lever raises it; hunters on the deck go into the moat. The `KEEP_CLOSED` bit keeps ducks off a closed deck. | `raid.bridgeMoveSeconds`, `raid.bridgeCooldownSeconds`, `raid.bridgeUpMaxSeconds`, `raid.raftSpeed` |
| Bread cannons | Use on a tower's stand spot mans one (`ex` bits 25 to 27); Fire lobs loaves (server projectiles) as far as 150 m: support for friends out in the field. | `raid.cannon.*` |

### Moving parts and the duck sim (determinism)

No collider a duck walks against ever changes during a run. Duck movement is predicted on the client from the shared sim and the static collider list, so the keep's state reaches the sim only as packed bits that the server writes and both sides then simulate the same way from that tick on (like the trap root):

- **The drawbridge deck is a static walkable collider** (Pond Keep's `castle_bridge` prop carries it; `keepShapes` adds one only for a map without). A raised drawbridge is the `KEEP_CLOSED` bit (`dmBuff` bit 4, `raid/man.ts`), which the server sets on every duck from the tick the bridge starts to rise until it is fully down: the sim then takes back any step that would put a duck onto the deck (`keepDeckRule`, exact float tests on the static deck outline). The server never raises the bridge under a duck: a pull is checked again at the tick boundary, after every duck's steps of that tick (catch-up steps included), and the bit is written in that same step, so no duck can be on the deck when the rule starts. A duck that walks onto the deck within one round trip of the lever pull gets a small correction, the only mispredict this rule can cause.
- **The gate's leaves beside its wicket are static duck-only colliders** (`CG.DuckOnly`: Pond Keep's kit `castle_gate` boxes placed at `raid.gate`). Ducks pass the gate through its 1.5 x 2.2 m wicket door, while it holds and after. A broken gate is the `KEEP_GATE_OPEN` bit (`dmBuff` bit 5): the sim then runs that duck's movement queries without the duck-only group, so the whole opening is free. It is a per-duck query filter from sim state, never a collider switched on or off.
- **What blocks the hunters is server only**: their mover and routes (`travel.ts`) bar the gate's line while it holds, the gate passage and the deck while the bridge is not down, and deep water (the moat is crossed on the bridge or a raft lane, never on foot). The navmesh never changes.
- **What a raised bridge or the gate blocks for bullets and sight** is a pair of colliders with Bullet and Sight bits only (no Move, no Opaque), built on both sides and switched by their groups (`setToggle`): on the server by the keep, on the client from `state.raid.bridge` and `state.raid.gate` (`syncKeepShields`, `raid/keepSync.ts`), so predicted tracers and hit markers, drawn loaves and the cannon's arc preview meet them exactly when the server's traces do. No duck movement query sees them, so switching them cannot move a duck; the hunters' sight and shots and the server's hit traces respect them.
- **Manning a cannon is sim state** in `ex` bits 25 to 27 (the cannon index + 1), set and cleared by the sim itself on Use and Jump presses at the static stand spot, so the owner predicts it exactly. `ex` bits 28 to 31 hold the cannons other ducks man (written by the server when they change), so the sim never mans a taken cannon; two ducks pressing Use at one cannon in the same tick: the server keeps one. The loaves are server projectiles (like the rocket); the client predicts only the feel of its own shot (the thump, the recoil, a puff) and draws the arc preview with the same pure math (`cannonAim`, `breadPath`).

`npm test` checks it (`packages/shared/test/keep.test.ts`): manning replays bit for bit, the deck rule and the gate bit replay bit for bit, and a duck's whole step is identical with the toggled colliders on and off.

## Hitboxes

Hunters have their own hitbox table (`raid/hunters.ts`, from the art contract `art/hunters/README.md` and `hunters.json`), next to the one duck table (`hitbox.ts`): a head sphere and a body capsule per kind and stance (standing or moving), turned by the hunter's yaw. The sniper wears the rifleman's body (and its table) with a ghillie hood. `HitTarget.shape` carries it; ducks never have one.

| Kind | Head (forward, up, radius) | Body (up from, to, radius) |
| --- | --- | --- |
| Rifleman, sniper, decoy thrower | 0.01, 1.55, 0.185 (moving: 0.11, 1.45) | 0.23 to 1.31, 0.23 (moving to 1.20) |
| Trapper | the same head | 0.25 to 1.31, 0.25 |
| Beater | 0.01, 1.55, 0.185 (moving: 0.11, 1.45) | 0.195 to 1.31, 0.195 (moving to 1.20) |
| Recruit | 0.01, 1.12, 0.133 (moving: 0.08, 1.04) | 0.185 to 0.92, 0.185 (moving to 0.84) |
| Big Hunter | 0.01, 1.92, 0.23 (moving: 0.13, 1.79) | 0.36 to 1.60, 0.36 |
| Dog | 0.48, 0.90, 0.16 | along the body from -0.35 to 0.24 m at 0.63 m, 0.195 |
| Trap | none | a puck, 0.08 to 0.12 m up, radius 0.55 |

Hits on hunters follow the TPS hit rule (`shot.ts`) with lag compensation (`raid/hunterHistory.ts`, the same window and cap as the ducks'). Hunters never rewind: their shots use the ducks' current positions. Katana cuts use the swing shapes above against the same lag compensated history (the hitbox table is for the pistol); bread loaves hurt hunters through the blast rules (`HuntWorld.blastBread`).

## Upgrades (`raid/upgrades.ts`, server only)

Three different cards from twelve, never one at its limit, the revive card only with friends. Every number is a `raid.upgrade.*` admin setting, none changes what the client simulates (no card touches a swing's timing or a cooldown).

| Card | Effect (default) | Limit |
| --- | --- | --- |
| Sharper blade | +15% katana and pistol damage | 5 |
| Max health | +20 max health (healed at once), up to 250 | 5 |
| Armor | 10% less damage taken (at most 70% in all) | 4 |
| Regen | +1.5 health a second after 3 s without a hit | 4 |
| Wider arcs | +15% katana reach (the server's sweep) | 3 |
| Faster revive | revives 25% faster | 2 |
| Keen edge | +30% crit damage | 3 |
| Lifesteal | +1 health per landed cut | 3 |
| Storm charge | the Blade Storm meter fills 25% faster | 3 |
| Bleed | cuts make hunters bleed 6 a second for 3 s | 3 |
| Chain lightning | a heavy spin's hits arc 40% of its damage to 3 more hunters within 6 m | 2 |
| Finisher | the combo's third cut hits 40% harder | 3 |

## XP, levels and Tüy (`raid/progress.ts`, `raid/kit.ts`, unit tested)

Level `n` needs `round(100 n^1.5)` XP to reach `n + 1` (cap 50). A run gives each duck in it: 150 XP for the first objective taken and 50 more for each later one (150, 200, 250, 300), 5 per hunter it bagged that is not a minion, 2 per minion, the combo bonus (kill by kill, 1% of the kill's XP per combo hit, at most +50%; capped at half of the kill XP in all), 200 per Big Hunter down (every duck that hit him), 15 per revive, 500 for the win, at most 5,000 per run. A full solo win (about 200 minions, 40 elites, the boss, a decent combo) is about 2,400 XP, like a v2 win.

XP is granted only by the game server at the end of a run (`RaidRoom.recordResult` to `recordRaid`, `meta/raid.ts`), once per run id, recomputed there from the run numbers with the shared formula (the minions and the combo bonus are stored with the rest, migration 006). Tüy is granted in the same transaction the same way (`raidFeathers`: 25 to 40 per objective, 1 per 5 minions, 1 per elite, 25 for the Big Hunter, 50 for the win, at most 400, plus 50 for the first run of the day that took an objective; migration 007, `docs/progression.md`). Only account ducks get XP; a duck that leaves before the end keeps the XP for what it was there for, without the win. The personal best of the push (most objectives, the fastest time to take them) starts fresh in `raid_push_bests` (006): a v2 best of 10 waves could never be beaten in four objectives. No client message can grant, change or send XP or Tüy, and no HTTP route may.

## The room (`RaidRoom.ts`)

- Account only, twice: the matchmaking guard and `checkAdmission` refuse a guest or a party with a guest.
- Quick Play joins an open lobby; a party leader opens a fresh room and the members follow. At most `raid.maxRooms` rooms (3).
- State: `IslandState.raid` (stage, the objective's number, `goal`, its marker `gx`, `gz`, its progress `gDone` of `gNeed`, hunters out, the boss bar, the keep), `hunters` (with `fx`: the elite ring), `raidTargets` (the crates, the towers, the camp), `traps`, `raidDrops`. Public to the room (the co-op rule: hunters are AI enemies, every duck is an ally).
- Messages: `Msg.RaidEvent` (an objective starts, is taken, a marker taken, a streak call-out to one duck, the keep's events), `Msg.RaidKill`, `Msg.RaidHits` to the hitter only (the combo, the storm meter, each hit's damage, flags and spot: the server's numbers), `Msg.RaidSelf`, `Msg.RaidOffer`, `Msg.RaidEnd` (with the run's Tüy), `Msg.RaidKit` to each duck (its level, unlocks, gear and their numbers, from the database at join) and `Msg.RaidLooks` to everyone (every duck's katana and armor tier, cosmetic).
- Progression: at join the room reads the duck's kit (level, gear, tree) from the database by its verified player id and fixes it for the run; its numbers are server only (`raid/blade.ts`, `raid/raid.ts`, `raid/upgrades.ts`), the moves its level lacks are masked off its inputs before the step (`Raid.beforeStep`; the client masks the same bits). The party's average level above 10 makes hunters a little tougher (`levelScale`). `docs/progression.md`.
- Test hooks (`QWAKK_TEST_HOOKS=1`, never in production): `dev:raid` with `start`, `skip` (to an objective), `clear` (take it), `break`, `hold` (ducks take no damage; `wave` 2 turns it off), `spawn` (a hunter of a kind, 1 to 8), `pack` (a minion pack charging the asking duck), `unlock` (every move for that duck for the rest of the run, in memory only), `horde` (hunters around it past the cap, the performance check), `meter` (a full storm meter), `tpgoal` (the duck short of the objective), `quiet` (no packs), `freeze` (the objective cannot be taken), `resetgoal`, and the keep's `gate`, `bridge`, `lever`, `tp`, `gatehunters`.

## Client

- The katana on every duck in the run (`player/meleeRig.ts`): in the right hand or in the scabbard on the back (the pistol out), the melee clips (`duck_melee_anims.glb`) layered over the locomotion from the pose action (the swing, the charge, the spin, the dash, the quack, the storm, the draw), the trail ribbon between the blade's TrailStart and TrailEnd while it cuts. Friends' swings come from their pose (`Act.Katana` and up). Smoothness: clips cross-fade on eased linear ramps (60 ms in, 80 ms out, 110 ms from one swing straight into another), on the move a swing plays on the upper body over the running legs (the legs never stop to swing), the katana's carry pose blends from Katana_Idle to Katana_Run with the speed and Katana_Run keeps in step with the legs (its time is the run's phase, as `melee.json` asks). `npm run anim:raid` measures it.
- The feel (`game/raid/bladeFeel.ts`): hit-stop on predicted hits, sparks, a gentle camera kick, the slash arcs (art SlashArc), the shockwave ring, the storm's whirl, damage numbers (crits bigger and orange, kills with a star), the combo counter with its XP bonus, streak call-outs (Triple Cut, Rampage...), feathers that burst out of our kills and fly to our duck (cosmetic). Synthesized sounds: swings, crunchy cuts, the "VAK!", the storm, the dash, the streak sting, the feathers.
- The horde: minions and elites from the art (`hunter_beater.glb`, `hunter_recruit.glb`; Charge, Bonk, Stagger, Launched, Get_Up), the elite ring, LODs (only the LOD on show stays in the scene graph, the far one without its outline), far hunters animated at a lower rate, looks pooled and made ahead one a frame (a pack never clones a dozen skinned models in one frame).
- Objective markers: a diamond with the distance to the objective's ground, beacons over crates (the kit's large crate with a health bar), towers and the camp; the camp dressed from the prop kit (tents, a campfire, the hunters' flag, hay, crates; decoration only, no colliders). The HUD (`hud/raid/`): the objective bar (n of 4, its progress, the timer, hunters out), the gate and the drawbridge only while they matter, the skill bar with cooldowns, the cards, the end screen.

## Measured

`npm run bench:raid` and `npm run perf:raid` (README, Hunt Season tables).
