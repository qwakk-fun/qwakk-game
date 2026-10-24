# Hunt Season (Av Sezonu)

Hunting season opened and the ducks defend their castle. A co-op PvE mode: 1 to 4 signed-in ducks (parties welcome) hold **Pond Keep**, a duck castle on a pond island (map `pond-keep`, `docs/pond-keep.md`), and the QoreChain core in its courtyard against 10 waves of duck hunters. Hunters pour out of the trenches all around, snipe from watchtowers and hills, hammer the gate, cross the moat over the drawbridge or on raft lanes; the ducks fight from the walls, lob bread from the tower cannons, pull the drawbridge lever and mend the gate. It is the mode that gives a duck XP and levels. Levels are cosmetic progress only: nothing about a level changes the deathmatch or the battle royale.

Code: shared `packages/shared/src/raid/` (`@qwakk/shared/raid`, pure: waves, XP, upgrades, hunters; the keep is in the root package: `raid/markup.ts`, `raid/keep.ts`, `raid/cannon.ts`, `raid/man.ts`), the trap root in the sim (`raid/root.ts`); server `apps/server/src/raid/` (`keepWorld.ts` the gate, the drawbridge, the cannons and the loaves; `travel.ts` the hunters' route rules; `hunts.ts`, `brain.ts` the hunters) and `apps/server/src/RaidRoom.ts`; results `apps/server/src/meta/raid.ts` and `apps/server/db/migrations/004_raid.sql`, `005_raid_keep.sql`; client `apps/client/src/game/raidClient.ts`, `apps/client/src/game/raid/` (hunter art and looks, `keepView.ts` the keep's moving parts), `apps/client/src/hud/raid/`; menu: the Hunt Season portal in Duck Plaza (east, `docs/duck-plaza.md`) and its row in the sheet's Play list (`ui/menu/hubSheet.ts`), the XP bar (`ui/menu/xpBar.ts`, on the character select and the sheet's Account card).

## A run

| Stage | What happens |
| --- | --- |
| Lobby | Ducks gather in the courtyard, no damage (the cannons and the lever already work). The first duck starts a 15 s countdown (`raid.lobbySeconds`), each later one adds 5 s, four ducks start in 5 s. The hunt starts at most 30 s after the countdown first started (an absolute deadline). The room locks when the run starts. |
| Wave | The director sends the wave's hunters from the trench exits all around the pond (60 to 120 m out). They charge the keep, take cover in the trenches, snipe from the perches, hammer the gate, break in and go for the core; any duck they see, they fight. |
| Break | 10 s (`raid.breakSeconds`). Every duck picks one of three upgrade cards (keys 1 to 3, or a tap); the timer picks one at random. Fallen ducks come back with 60% health, knocked ones get up with 50%, standing ones heal 25%. Reserve ammo refills. The castle crew patches the gate by 25% of its health (`raid.gateBreakRepairPercent`). |
| Won / lost | Won after wave 10. Lost when the core falls or no duck is standing (knocked or out) at once. The end screen shows the run and the XP; the room closes 60 s later. "Play again" starts another hunt from the menu. |

Waves 3, 6 and 10 are boss waves: the Big Hunter comes out, and the rocket launcher pickup appears in the courtyard for 90 s. A full run is about 8 to 10 minutes with a team that uses the keep (waves of 40 to 60 s plus 9 breaks of 10 s); passive bot ducks that only shoot from the walls take 75 to 110 s a wave.

Ducks use the battle royale knock and revive: at 0 health a duck is knocked (it crawls and bleeds out in 30 s), a friend holds Use next to it for 5 s to revive it (faster with the revive upgrade). There is no friendly fire (bread loaves never hurt a duck). A knocked duck that bleeds out is out until the next break; while out, its camera follows a living friend. A lone duck has a second wind once a wave: knocked with nobody to revive it, it holds Use for 8 s to get up by itself.

Ammo: rifle and pistol, full reserves at every break, ammo drops in between. Grenades: one each wave (`RAID.grenadesPerWave`), more with the grenade card.

## The keep (Pond Keep)

The map's `raid` markup (`map_v1.json`, read and checked by `raid/markup.ts` like the rest of the map; the contract is `docs/pond-keep.md`) places everything: the core, the gate, the drawbridge (hinge, span, deck outline), the four cannon mounts and the spots a duck mans them from, the lever, the spawns, the sniper perches, the raft lanes, the trenches, the wall walk, the courtyard (`keep`) and island outlines. `raid/keep.ts` derives the geometry once at load (pure, the same on both sides).

| Part | Rules | Numbers (admin settings) |
| --- | --- | --- |
| QoreChain core | In the courtyard. Hunters inside the walls hammer it (within 1.8 m of its plinth); at 0 the run is lost. | `raid.coreHp` 1000; per second rifleman 3, trapper 4, decoy thrower 3, dog 1.5, sniper 2, Big Hunter 12 (`RAID.coreDps`), times `raid.coreDamageScale`. |
| Main gate | Hunters outside, in the gate passage, hammer it while the drawbridge is down. Looks: intact (over half health), damaged, broken (at 0). Broken lets hunters into the courtyard; mended back past 30% it holds again (shown with a plank barricade until it is whole). A duck holding Use within 3.4 m of it (either side) mends it after a short wind-up; a hit on that duck pauses the mending for 1.5 s. | `raid.gateHp` 700; per second rifleman 4, trapper 6, decoy thrower 4, dog 2.5, sniper 3, Big Hunter 20 (`RAID.gateDps`), times `raid.gateDamageScale`; `raid.gateRepairPerSecond` 35; `raid.gateBreakRepairPercent` 25. |
| Drawbridge | The lever in the courtyard beside the gate passage: a Use press within 1.8 m raises a lowered bridge or lowers a raised one. It takes `raid.bridgeMoveSeconds` to move, the lever then rests for `raid.bridgeCooldownSeconds`, and a raised bridge comes down by itself after `raid.bridgeUpMaxSeconds` (the hunters always get a way in). It never rises under a duck (the lever says why): the raise starts at the end of the tick, once every duck has stepped, and is refused if a duck stands on the deck then. When it starts to rise, every hunter in the gate passage or on the deck goes into the moat: out of the wave, a toony splash, credited to the duck at the lever (kill XP); the Big Hunter is dunked instead (8% of his health, out on the far bank, 3 s stunned). While it is not down, hunters cannot hammer the gate (the bridge covers it) and must cross on the raft lanes. | `raid.bridgeMoveSeconds` 2.5 s, `raid.bridgeCooldownSeconds` 10 s, `raid.bridgeUpMaxSeconds` 25 s, `raid.raftSpeed` 1.5 m/s. |
| Bread cannons | One on each corner tower. A Use press on its stand spot mans it (Use or Jump leaves; knocked or dead leaves too). While manning, the duck stands at the cannon: no walking, jumping, shooting, throwing or healing; it turns and aims, and the camera's crosshair aims the cannon: the barrel turns toward the crosshair point within its arc (about 40 degrees either way of straight out, 23 up or down, what clears the barbette) and takes the low arc that lands there. Holding Fire lobs a loaf whenever the cannon is ready: a server projectile (gravity, about 150 m at most), bursting on what it hits in a splash of crumbs that hurts hunters with falloff (a quarter at the edge) through what stops a bullet and shoves them away (dogs fly further, the Big Hunter hardly moves). Each loaf heats the cannon; at 100% it overheats and fires again only once it cooled below the vent line. | `raid.cannon.damage` 75 (times the duck's damage upgrade), `raid.cannon.radius` 3.5 m, `raid.cannon.knockback` 8 m/s, `raid.cannon.reloadSeconds` 1.3 s, `raid.cannon.heatPerShot` 30%, `raid.cannon.coolPerSecond` 10%, `raid.cannon.ventBelow` 35%. The flight constants (`CANNON` in `raid/cannon.ts`: speed 54 m/s, gravity 14 m/s², the arc limits) are client drawn, so they are constants. |
| Wall walk and crenels | Plain map geometry: ducks fight from height; hunters see and shoot a duck on the walls only through gaps where its chest or head is in clear sight (`SIGHT_QUERY_GROUPS`), so a duck behind a merlon is safe and one in a crenel is exposed. Shots through the gatehouse's iron grate reach the hunters hammering the gate. | |

### Moving parts and the duck sim (determinism)

No collider a duck walks against ever changes during a run. Duck movement is predicted on the client from the shared sim and the static collider list, so the keep's state reaches the sim only as packed bits that the server writes and both sides then simulate the same way from that tick on (like the trap root):

- **The drawbridge deck is a static walkable collider** (Pond Keep's `castle_bridge` prop carries it; `keepShapes` adds one only for a map without). A raised drawbridge is the `KEEP_CLOSED` bit (`dmBuff` bit 4, `raid/man.ts`), which the server sets on every duck from the tick the bridge starts to rise until it is fully down: the sim then takes back any step that would put a duck onto the deck (`keepDeckRule`, exact float tests on the static deck outline). The server never raises the bridge under a duck: a pull is checked again at the tick boundary, after every duck's steps of that tick (catch-up steps included), and the bit is written in that same step, so no duck can be on the deck when the rule starts. A duck that walks onto the deck within one round trip of the lever pull gets a small correction, the only mispredict this rule can cause.
- **The gate's leaves beside its wicket are static duck-only colliders** (`CG.DuckOnly`: Pond Keep's kit `castle_gate` boxes placed at `raid.gate`). Ducks pass the gate through its 1.5 x 2.2 m wicket door, while it holds and after. A broken gate is the `KEEP_GATE_OPEN` bit (`dmBuff` bit 5): the sim then runs that duck's movement queries without the duck-only group, so the whole opening is free. It is a per-duck query filter from sim state, never a collider switched on or off.
- **What blocks the hunters is server only**: their mover and routes (`travel.ts`) bar the gate's line while it holds, the gate passage and the deck while the bridge is not down, and deep water (the moat is crossed on the bridge or a raft lane, never on foot). The navmesh never changes.
- **What a raised bridge or the gate blocks for bullets and sight** is a pair of colliders with Bullet and Sight bits only (no Move, no Opaque), built on both sides and switched by their groups (`setToggle`): on the server by the keep, on the client from `state.raid.bridge` and `state.raid.gate` (`syncKeepShields`, `raid/keepSync.ts`), so predicted tracers and hit markers, drawn loaves and grenades and the cannon's arc preview meet them exactly when the server's traces do. No duck movement query sees them, so switching them cannot move a duck; the hunters' sight and shots and the server's hit traces respect them.
- **Manning a cannon is sim state** in `ex` bits 25 to 27 (the cannon index + 1), set and cleared by the sim itself on Use and Jump presses at the static stand spot, so the owner predicts it exactly. `ex` bits 28 to 31 hold the cannons other ducks man (written by the server when they change), so the sim never mans a taken cannon; two ducks pressing Use at one cannon in the same tick: the server keeps one. The loaves are server projectiles (like the rocket); the client predicts only the feel of its own shot (the thump, the recoil, a puff) and draws the arc preview with the same pure math (`cannonAim`, `breadPath`).

`npm test` checks it (`packages/shared/test/keep.test.ts`): manning replays bit for bit, the deck rule and the gate bit replay bit for bit, and a duck's whole step is identical with the toggled colliders on and off.

## Waves (`raid/waves.ts`, unit tested)

`k = 1 + 0.5 * (ducks - 1)` (1, 1.5, 2, 2.5), times 0.65 on a boss wave, times `raid.waveScale` (admin):

| Kind | From wave | Count |
| --- | --- | --- |
| Rifleman | 1 | `round((3 + 0.9 w) k)`, at least 1 |
| Hunting dog | 2 | packs of 3: `3 * round((0.6 + 0.3 (w - 2)) k)`, at least one pack |
| Sniper | 2 | `round((0.5 + 0.3 (w - 2)) k)`, 1 to 4, at most one per free perch (the rest come as riflemen) |
| Trapper | 3 | `round((0.7 + 0.35 (w - 3)) k)`, at least 1 |
| Decoy thrower | 4 | `round((0.7 + 0.3 (w - 4)) k)`, at least 1 |
| Big Hunter | 3, 6, 10 | 1 |

Solo: wave 1 is 4 riflemen, wave 2 nine hunters, wave 9 twenty-eight; about 157 over a run (v1: about 150 over 15 waves). Four ducks, wave 10: about 54 plus the boss's helpers. At most 30 are alive at once (`raid.maxLive`); the rest wait their turn. Spawns come every `max(0.6, 1.8 - 0.12 w)` s (a dog pack 1.6 times that), from the markup's trench exits, never within 25 m of a standing duck.

Health (`HUNTER_HP` times `(1 + 0.06 (w - 1))`, times `1 + 0.12 (ducks - 1)`, the boss `1 + 0.35 (ducks - 1)`, times `raid.hunterHpScale`): rifleman 60, trapper 85, decoy thrower 55, dog 32, sniper 50, Big Hunter 1100. Lighter than v1, and more of them.

A wave past one minute, or down to its last three hunters, pushes in: no more sniping from afar, everyone goes for the keep and fights only what is within 22 m. During a push a hunter that has neither moved 2 m nor fought nor hammered for 20 s (wedged in a pocket of the map) regroups: it goes back to a trench exit away from the ducks, its health kept, and comes again. It is never removed by this, so it never clears a wave, gives XP or drops anything. Waiting for the drawbridge (any time it is not down) or riding a raft counts as busy. The HUD marks every remaining hunter once three are left, and always the ones hammering the gate or the core and the snipers aiming.

## Hunters

Server-only AI actors (`raid/hunter.ts`, `raid/brain.ts`, `raid/travel.ts`). They are not ducks: no seat, no input frames, no client prediction. They walk on navmesh paths with a kinematic mover (`raid/hunterMover.ts`: wall checks at knee and chest height, the ground under each step, no drop deeper than a stair, steering around each other and the ducks; they never push a duck). A planned path that crosses a barrier (the gate, the raised bridge's gateway) marks its goal out of reach for a while and the hunter goes for its objective instead; stuck in a pocket the navmesh does not join up, it scrambles out onto a connected spot toward its goal. Fair by the bot rules: line of sight only (`SIGHT_QUERY_GROUPS`, bushes hide), a reaction delay on a new target (`raid.hunterReactionMin/Max`), an aim error that settles while they aim (`raid.hunterAimError`), a random spread on every bullet (`raid.hunterSpreadDeg`), no shot without a clear line at the moment it fires, bullets stop at walls (`BULLET_QUERY_GROUPS`). A duck that goes out of sight is chased to the point where it was last seen, never to where it really is; the chase runs out after about 4 s. They leave knocked ducks alone.

Where they go with no duck in mind (their objective): inside the walls, the core; the drawbridge down and the gate holding, the gate (they stand in the passage and hammer it); the gate broken, the core; the drawbridge up (or moving), the nearest raft landing on the island, paddling across a raft lane from the outer bank if they are not on the island yet, where they wait (and fight) until the bridge comes down. Riflemen and the rest charge at a run while far from their objective.

| Kind | Moves | Fights | Tell |
| --- | --- | --- | --- |
| Rifleman | 3.0 m/s, 4.4 running | Sees 70 m, fights within 60 m. Takes half cover (trench points first, then random walkable spots, only ones it can really walk to), kneels, stands up to aim and fires one 13 damage shot (x1.6 to the head, falloff past 40 m); a bound toward the keep every two shots, a reload every five. | Red laser and a scope glint for 0.9 s (27 ticks, plus the reaction on a new target); the laser stops tracking for the last 8 ticks: step aside on the glint and the shot misses. |
| Sniper | 3.0, 4.3 running | Walks to a free perch (a watchtower platform or a hill nest, 90 to 140 m from the walls) and holds it; sees 160 m, fights within 150 m: one 26 damage shot (x1.6 to the head, no falloff) every 2.3 to 3.3 s, a reload every four. In a push it leaves the perch. | The longest tell: the red laser (drawn up to 175 m) and a glint that grows with the distance, for 30 ticks plus 0.25 a meter (1.8 s at 90 m, 2.2 s at 140 m) plus the reaction; frozen for the last 12 ticks. An aiming sniper always has a marker on the HUD. |
| Trapper | 3.4, 4.6 running | Closes to 9 m: a 7 pellet shotgun (5 each, falloff to 0 at 20 m). Sets a trap a few meters ahead of a duck it fights (every 8 s, at most 2 of its own, 10 in all), also in front of the gate when nobody is around. | A short glint before the shot (14 ticks). The trap is a visible net disc: armed after 0.7 s, it roots the duck that steps in for 1.6 s (and 6 damage); shoot it (30 health) to break it. |
| Decoy thrower | 3.1 | Keeps 18 m and lobs a wooden decoy duck at a duck it sees (every 4.5 s). | The duck call honks as the decoy flies; it pops after 2.2 s in a small toony blast (32 at the center, radius 3.4 m). |
| Hunting dog | 5.2, 6.4 running | Packs of three, notice ducks within 12 m whichever way they face, chase, bite (8) within 2.1 m every 0.9 s. | The lunge (8 ticks) before each bite. |
| Big Hunter | 2.6 | Closes to 13 m: a double barrel, two blasts of 9 pellets (7 each, falloff to 0 at 32 m) 8 ticks apart (each blast checks the line again), then a 2.2 s reload. Whistles for help every 16 s (11 s on wave 10) while fewer than 4 helpers stand, never past `raid.maxLive` alive, and no more whistles 150 s into the wave: 3 dogs, plus a rifleman from wave 6. Whistled helpers give no kill XP and drop nothing. | A 1.1 s wind-up with an orange glint; the whistle is a clear sound and a banner. |

Defeated hunters drop ammo (22%) or a small heal (12%, 25 health); the boss drops both; a hunter splashed into the moat drops nothing.

### Hitboxes

Hunters have their own hitbox table (`raid/hunters.ts`, from the art contract `art/hunters/README.md` and `hunters.json`), next to the one duck table (`hitbox.ts`): a head sphere and a body capsule per kind and stance (standing or moving), turned by the hunter's yaw. The sniper wears the rifleman's body (and its table) with a ghillie hood. `HitTarget.shape` carries it; ducks never have one.

| Kind | Head (forward, up, radius) | Body (up from, to, radius) |
| --- | --- | --- |
| Rifleman, sniper, decoy thrower | 0.01, 1.55, 0.185 (moving: 0.11, 1.45) | 0.23 to 1.31, 0.23 (moving to 1.20) |
| Trapper | the same head | 0.25 to 1.31, 0.25 |
| Big Hunter | 0.01, 1.92, 0.23 (moving: 0.13, 1.79) | 0.36 to 1.60, 0.36 |
| Dog | 0.48, 0.90, 0.16 | along the body from -0.35 to 0.24 m at 0.63 m, 0.195 |
| Trap | none | a puck, 0.08 to 0.12 m up, radius 0.55 |

Hits on hunters follow the TPS hit rule (`shot.ts`) with lag compensation (`raid/hunterHistory.ts`, the same window and cap as the ducks'). Hunters never rewind: their shots use the ducks' current positions. Grenades, rockets and bread loaves hurt hunters through the blast rules (`dmExplosives.ts` hooks; `HuntWorld.blastBread`).

## Upgrades (`raid/upgrades.ts`, server only)

Three different cards from the nine, never one at its limit, the repair kit only while the core is hurt. The numbers are admin settings (`raid.upgrade.*`) and never touch the client sim; the card shows the server's value. The damage card also makes a duck's bread loaves hit harder.

| Card | Effect (default) | Limit |
| --- | --- | --- |
| Damage | +15% damage to hunters | 5 |
| Max health | +20 max health (healed at once), up to 250 | 5 |
| Armor | 10% less damage taken (at most 70% in all) | 4 |
| Regen | +1.5 health a second after 3 s without a hit | 4 |
| Extra grenade | +1 grenade every wave | 3 |
| Faster revive | revives 25% faster | 2 |
| Headshot bonus | +30% headshot damage | 3 |
| Lifesteal | +6 health for every hunter you bag | 3 |
| Core repair kit | +250 core health | any |

## XP and levels (`raid/progress.ts`, unit tested)

Level `n` needs `round(100 n^1.5)` XP to reach `n + 1` (level 2 at 100 XP, 5 at 1,703, 10 at about 11,100), capped at level 50 for now. A run gives each duck in it: 60 XP per wave cleared plus 8 per wave number (wave 10 gives 132), 4 per hunter it bagged (a hunter its lever pull sent into the moat counts; a loaf's kill counts for its duck), 150 per boss down (every duck that hit it), 15 per revive, 400 for the win, at most 5,000 per run. A full solo win with every hunter bagged is about 2,450 XP (v1: about 2,400 for 15 waves in 12 to 18 minutes), so a minute of hunting is worth about 1.5 to 2 times what it was.

XP is granted only by the game server at the end of a run, from what the server saw: `RaidRoom.recordResult` calls `recordRaid` (`meta/raid.ts`) once (on the end, or when the room disposes after everyone left mid-run). The meta layer recomputes every grant from the run numbers with the shared formula, writes the run (`raid_runs`, `run_key` unique: a retried write never grants twice), each duck's row (`raid_run_players`), adds the XP to `players.xp` and sets `players.level`, and keeps the personal best on Pond Keep (`raid_keep_bests`, migration 005: most waves cleared, the fastest time to clear them, runs, wins; the Kavren bests of v1 stay in `raid_bests`, no longer written, because a 15 wave best could never be beaten in a 10 wave run). Only account ducks get XP. A duck that leaves before the end keeps the XP for the waves, kills and revives it was there for, but gets no win bonus and no recorded win. No client message can grant, change or send XP: the room answers `Msg.RaidEnd` with the server's numbers, first at once (`granted 0`), then always a second answer: the stored numbers (`granted 1`), or "could not be saved" (`granted 2`).

The account API sends `xp`, `level` and `raidBest` with every duck; the character select and the Play tab's duck card show the level and an XP bar.

## The room (`RaidRoom.ts`)

- Account only, twice: the matchmaking guard (`accountOnly.rooms` includes `raid`, codes 534 and 535) and `checkAdmission` (4412 and 4413); a party with a guest is refused like the battle royale.
- Quick Play joins an open lobby (`joinOrCreate`); a party leader opens a fresh room (`create`) and the members follow by room id. The room holds seats for the leader's party friends for `PARTY.reserveSeconds`, and refuses a party that does not fit (`RAID_ERROR.full`, 4414) or any join once the run started. At most `raid.maxRooms` rooms (3) at once.
- Not listed in the lobby room list. The admin dashboard lists runs as HUNT with their wave and stage; Close works on them.
- The tick loop sleeps whenever nobody is connected (`idleWhenEmpty`); a room disposes when its last client leaves.
- State: `IslandState.raid` (stage, wave, the stage clock, the core, the gate and its look, the drawbridge (its state, when its move started and ends, when the lever is ready, when it comes down by itself), hunters left, the boss bar, ducks, team kills, and `cannons`: who mans each, its barrel's turn and elevation, heat, overheated, when it may fire), `hunters`, `traps`, `raidDrops`, and the deathmatch's `dmRockets` for the boss wave launcher. Each duck's own run numbers and its cards go to that duck only as messages (`Msg.RaidSelf`, `Msg.RaidOffer`); a pick (`Msg.RaidPick`) is checked against its offer. No PlayerState field was added: the trap root and the cannon manning are packed into `ex`, the drawbridge and gate bits into `dmBuff`.
- Messages: `Msg.RaidEvent` (wave start and clear, the whistle, core hit, gate hit, gate broken, gate fixed, the drawbridge moving, a splash, and to one duck: the lever refused (why, and the seconds left) and its cannon overheated), `Msg.RaidKill` (with how: shot, splashed, a loaf), loaves as `Msg.Proj` and `Msg.Boom` with `ExplosiveKind.Bread` (ids from 1,000,000), decoys with `ExplosiveKind.Decoy`.
- Visibility: every duck in a run is an ally (team 1), so ducks always get each other's poses and teammate entries. Hunters, traps, drops, the cannons and the keep are public room state, sent to everyone in the room every tick regardless of line of sight (the CLAUDE.md Hunt Season rule).
- Test hooks (`QWAKK_TEST_HOOKS=1`, never in production): `dev:raid` with `start`, `skip` (to a wave), `clear` (beat the wave), `break` (end it now), `hold` (ducks take no damage, the benchmark), `spawn` (one hunter of a kind in front of the asking duck), `gate` (set the gate's health), `bridge` (straight up or down), `lever` (pull it from anywhere), `tp` (move the asking duck to a cannon's stand spot 1 to 4, the lever 5, inside the gate 6, the wall walk over the gate 7, outside past the bridge 8), `gatehunters` (riflemen at the gate).

## Client

- Hunters are drawn from the art (`game/raid/hunterAssets.ts`); the sniper wears the rifleman with a ghillie hood. Without the art, greybox hunters stand in. A hunter on a raft lane has a raft under it.
- The keep (`game/raid/keepView.ts`) from the prop kit's animated GLBs (`castle_gate` in its looks plus the `Planks` barricade while a broken gate is mended, `castle_drawbridge` on its hinge with its chains following, `castle_lever`, `bread_cannon` turning and tilting to its duck's aim with a heat glow and recoil), placed from the markup; greybox stand-ins until they load. Manning a cannon shows the dotted arc and the landing ring (the same math the server fires with), and our own shot thumps at once (predicted feel); the loaves are drawn from the server's messages with the same flight step (`game/explosivesClient.ts`), bursting in crumbs and flour.
- Telegraphs: the rifleman's and the sniper's red laser and glint, the boss's orange wind-up glint, a small health bar once a hunter is hurt; a toony pop (dust and yellow stars, no blood) on hits and defeats, a splash when the drawbridge throws them in the moat.
- HUD (`hud/raid/raidHud.ts`): the wave bar (wave of 10, a boss star, the timer, hunters left), the core's and the gate's bars (the gate's look in its label), the drawbridge line (down, rising, up and when it comes down, the lever's cooldown), the cannon panel while manning (heat, overheated, ready), the action prompt (man the bread cannon, raise or lower the drawbridge, hold to repair the gate), the Big Hunter's bar, banners, the cards, the duck's own upgrades, the knocked and out notes, markers, and the end screen with the XP and the level bar. Phones: a compact layout; the touch Use button shows for a cannon, the lever, the gate, a revive or the second wind; Fire fires a manned cannon, Jump or Use leaves it.
- Sounds (synthesized, `audio/sound.ts`): the wave horn, the wave clear cheer, the boss whistle, the decoy's duck call and pop, the trap snap, the core knock, the gate knock and break, the repair tap, the chain rattle and the lever clunk, the cannon thump, the loaf's bonk, the splash, the overheat hiss, the card pick.

## Measured

`npm run bench:raid` (README, Hunt Season tables).
