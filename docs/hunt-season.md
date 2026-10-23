# Hunt Season (Av Sezonu)

Hunting season opened and the ducks defend the pond. A co-op PvE mode: 1 to 4 signed-in ducks (parties welcome) hold the QoreChain Tower in the middle of Kavren against 15 waves of duck hunters. It is the mode that gives a duck XP and levels. Levels are cosmetic progress only: nothing about a level changes the deathmatch or the battle royale.

Code: shared `packages/shared/src/raid/` (`@qwakk/shared/raid`, pure), the trap root in the sim (`raid/root.ts`); server `apps/server/src/raid/` and `apps/server/src/RaidRoom.ts`; results `apps/server/src/meta/raid.ts` and `apps/server/db/migrations/004_raid.sql`; client `apps/client/src/game/raidClient.ts`, `apps/client/src/game/raid/` (hunter art and looks), `apps/client/src/hud/raid/`; menu: the Hunt Season button (`ui/menu/playStep.ts`), the XP bar (`ui/menu/xpBar.ts`).

## A run

| Stage | What happens |
| --- | --- |
| Lobby | Ducks gather by the tower, no damage. The first duck starts a 15 s countdown (`raid.lobbySeconds`), each later one adds 5 s, four ducks start in 5 s. The hunt starts at most 30 s after the countdown first started (an absolute deadline: a duck leaving and joining again cannot hold it off). The room locks when the run starts. |
| Wave | The director sends the wave's hunters from the edge of town (the ends of Kavren's roads). Hunters walk to the tower and hammer it; any duck they see, they fight. |
| Break | 20 s (`raid.breakSeconds`). Every duck picks one of three upgrade cards (keys 1 to 3, or a tap); the timer picks one at random. Fallen ducks come back with 60% health, knocked ones get up with 50%, standing ones heal 25%. Reserve ammo refills. |
| Won / lost | Won after wave 15. Lost when the tower falls or no duck is standing (knocked or out) at once. The end screen shows the run and the XP; the room closes 60 s later. "Play again" starts another hunt from the menu. |

Waves 5, 10 and 15 are boss waves: the Big Hunter comes out, and the rocket launcher pickup from the deathmatch appears by the tower for 90 s. A full run is about 12 to 18 minutes with a team that defends (waves of 25 to 70 s in headless runs, plus 14 breaks of 20 s).

Ducks use the battle royale knock and revive: at 0 health a duck is knocked (it crawls and bleeds out in 30 s), a friend holds Use next to it for 5 s to revive it (faster with the revive upgrade). There is no friendly fire. A knocked duck that bleeds out is out until the next break; while out, its camera follows a living friend. A lone duck (a solo run) has a second wind once a wave: knocked with nobody to revive it, it holds Use for 8 s to get up by itself; the run is lost only if it is knocked again (or bleeds out).

Ammo: rifle and pistol, full reserves at every break, ammo drops in between. Grenades: one each wave (`RAID.grenadesPerWave`), more with the grenade card; the deathmatch's grenade code throws them.

## Waves (`raid/waves.ts`, unit tested)

`k = 1 + 0.5 * (ducks - 1)` (1, 1.5, 2, 2.5), times 0.6 on a boss wave:

| Kind | From wave | Count |
| --- | --- | --- |
| Rifleman | 1 | `round((2 + 0.6 w) k)`, at least 1 |
| Hunting dog | 2 | packs of 3: `3 * round((0.5 + 0.22 (w - 1)) k)`, at least one pack |
| Trapper | 3 | `round((0.6 + 0.3 (w - 3)) k)`, at least 1 |
| Decoy thrower | 4 | `round((0.6 + 0.25 (w - 4)) k)`, at least 1 |
| Big Hunter | 5, 10, 15 | 1 |

Solo: wave 1 is 3 riflemen, wave 2 three riflemen and a pack of dogs, wave 15 about 32 hunters. Four ducks, wave 15: about 44 plus the boss's reinforcements. At most 30 are alive at once (`raid.maxLive`); the rest wait their turn. Spawns come every `max(0.7, 2.2 - 0.1 w)` s (a dog pack 1.6 times that), never at an edge spawn within 18 m of a duck.

Health (`HUNTER_HP` times `(1 + 0.045 (w - 1))`, times `1 + 0.12 (ducks - 1)`, the boss `1 + 0.35 (ducks - 1)`, times `raid.hunterHpScale`): rifleman 90, trapper 120, decoy thrower 80, dog 45, Big Hunter 1400 (about 1650 on wave 5 alone, 3700 on wave 15 with four ducks).

When a wave is down to its last three hunters (or runs past two minutes), the rest stop sniping from afar and push to the tower, fighting only what is within 22 m, so a wave never stalls on one far rifleman. The HUD then marks every remaining hunter, and always the ones hammering the tower.

## Hunters

Server-only AI actors (`raid/hunter.ts`, `raid/brain.ts`). They are not ducks: no seat, no input frames, no client prediction. They walk on navmesh paths with a kinematic mover (`raid/hunterMover.ts`: wall checks at knee and chest height, the ground under each step, steering around each other and the ducks; they never push a duck, so a duck's prediction stays exact). Fair by the bot rules: line of sight only (`SIGHT_QUERY_GROUPS`, bushes hide), a reaction delay on a new target (`raid.hunterReactionMin/Max`, 15 to 25 ticks), an aim error that settles while they aim (`raid.hunterAimError`), a random spread on every bullet (`raid.hunterSpreadDeg`), no shot without a clear line at the moment it fires, bullets stop at walls (`BULLET_QUERY_GROUPS`). A duck that goes out of sight is chased to the point where it was last seen, never to where it really is (`knownTarget` in `raid/brain.ts`); after about 2.5 s out of sight the hunter forgets it. They leave knocked ducks alone, so friends can revive them.

| Kind | Moves | Fights | Tell |
| --- | --- | --- | --- |
| Rifleman | 3.0 m/s, 4.4 running | Sees 60 m, fights within 50 m. Finds half cover (a spot where a wall hides it kneeling but not standing), kneels, stands up to aim and fires one 13 damage shot (x1.6 to the head, falloff past 40 m); moves to new cover (a bound toward the tower) every two shots, reloads every five. | Red laser and a scope glint for 0.9 s (27 ticks, plus the reaction on a new target); the laser stops tracking for the last 8 ticks: step aside on the glint and the shot misses. |
| Trapper | 3.4, 4.6 running | Closes to 9 m: a 7 pellet shotgun (5 each, falloff to 0 at 20 m). Sets a trap a few meters ahead of a duck it fights (every 8 s, at most 2 of its own, 10 in all, also by the tower when nobody is around). | A short glint before the shot (14 ticks). The trap is a visible net disc: armed after 0.7 s, it roots the duck that steps in for 1.6 s (and 6 damage), then breaks; shoot it (30 health) to break it first. |
| Decoy thrower | 3.1 | Keeps 18 m and lobs a wooden decoy duck at a duck it sees (every 4.5 s). | The duck call honks as the decoy flies; it pops after 2.2 s in a small toony blast (32 at the center, radius 3.4 m, through walls that stop bullets). |
| Hunting dog | 5.2, 6.4 running | Packs of three, notice ducks within 12 m whichever way they face, chase, bite (8) within 2.1 m every 0.9 s. 45 health. | The lunge (8 ticks) before each bite. |
| Big Hunter | 2.6 | Closes to 13 m: a double barrel, two blasts of 9 pellets (7 each, falloff to 0 at 32 m) 8 ticks apart (each blast checks the line again), then a 2.2 s reload. Whistles for help every 16 s (11 s on wave 15) while fewer than 4 helpers stand, never past `raid.maxLive` alive, and no more whistles 150 s into the wave: 3 dogs, plus a rifleman from wave 10. Whistled helpers give no kill XP and drop nothing (no farming the boss). | A 1.1 s wind-up with an orange glint; the whistle is a clear sound and a banner. |

At the tower (within 2.6 m of its walls) a hunter hammers it: per second rifleman 3, trapper 4, decoy thrower 3, dog 1.5, Big Hunter 12 (`RAID.towerDps`, times `raid.towerDamageScale`), tower health 1000 (`raid.towerHp`). Defeated hunters drop ammo (22%) or a small heal (12%, 25 health); the boss drops both.

### Hitboxes

Hunters have their own hitbox table (`raid/hunters.ts`, from the art contract `art/hunters/README.md` and `hunters.json`), next to the one duck table (`hitbox.ts`): a head sphere and a body capsule per kind and stance (standing or moving), turned by the hunter's yaw. The dog's body capsule lies along its facing. `HitTarget.shape` carries it; ducks never have one.

| Kind | Head (forward, up, radius) | Body (up from, to, radius) |
| --- | --- | --- |
| Rifleman, decoy thrower | 0.01, 1.55, 0.185 (moving: 0.11, 1.45) | 0.23 to 1.31, 0.23 (moving to 1.20) |
| Trapper | the same head | 0.25 to 1.31, 0.25 |
| Big Hunter | 0.01, 1.92, 0.23 (moving: 0.13, 1.79) | 0.36 to 1.60, 0.36 |
| Dog | 0.48, 0.90, 0.16 | along the body from -0.35 to 0.24 m at 0.63 m, 0.195 |
| Trap | none | a puck, 0.08 to 0.12 m up, radius 0.55 |

Hits on hunters follow the TPS hit rule (`shot.ts`: the camera ray finds the aim point, the muzzle trace decides) with lag compensation: the server keeps a short history of every hunter's hitbox (`raid/hunterHistory.ts`, the same window and cap as the ducks' history) and judges a duck's shot against the hunters as that duck drew them (the client draws hunters on the near timeline, 100 ms behind). Hunters never rewind: their shots use the ducks' current positions. Grenades and rockets hurt hunters through the same blast rules as ducks (`dmExplosives.ts` hooks).

## Upgrades (`raid/upgrades.ts`, server only)

Three different cards from the nine, never one at its limit, the repair kit only while the tower is hurt. The numbers are admin settings (`raid.upgrade.*`) and never touch the client sim; the card shows the server's value.

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
| Tower repair kit | +250 tower health | any |

## XP and levels (`raid/progress.ts`, unit tested)

Level `n` needs `round(100 n^1.5)` XP to reach `n + 1` (level 2 at 100 XP, 5 at 1,703, 10 at about 11,100), capped at level 50 for now. A run gives each duck in it: 40 XP per wave cleared plus 4 per wave number (wave 15 gives 96), 4 per hunter it bagged, 120 per boss down (every duck that hit it), 15 per revive, 400 for the win, at most 5,000 per run. A first full solo win with about 150 hunters bagged is about 2,400 XP (level 5).

XP is granted only by the game server at the end of a run, from what the server saw: `RaidRoom.recordResult` calls `recordRaid` (`meta/raid.ts`) once (on the end, or when the room disposes after everyone left mid-run). The meta layer recomputes every grant from the run numbers with the shared formula (it does not trust the room's own number either), writes the run (`raid_runs`, `run_key` unique: a retried write never grants twice), each duck's row (`raid_run_players`), adds the XP to `players.xp` and sets `players.level`, and keeps the personal best (`raid_bests`: most waves cleared, the fastest time to clear them, runs, wins). Only account ducks get XP (guests cannot join; dev identities have no row). A duck that leaves before the end keeps the XP for the waves, kills and revives it was there for, but gets no win bonus and no recorded win. No client message can grant, change or send XP: the room answers `Msg.RaidEnd` with the server's numbers, first at once (`granted 0`), then always a second answer: the stored numbers (`granted 1`), or "could not be saved" (`granted 2`: no database, or the write failed; the end screen says so).

The account API sends `xp`, `level` and `raidBest` with every duck; the character select and the Play tab's duck card show the level and an XP bar.

## The room (`RaidRoom.ts`)

- Account only, twice: the matchmaking guard (`accountOnly.rooms` includes `raid`, codes 534 and 535) and `checkAdmission` (4412 and 4413); a party with a guest is refused like the battle royale.
- Quick Play joins an open lobby (`joinOrCreate`; the matchmaker skips locked and full rooms); a party leader opens a fresh room (`create`) and the members follow by room id (`PartyMsg.Go` with `mode: 'raid'`). The room holds seats for the leader's party friends for `PARTY.reserveSeconds`, and refuses a party that does not fit (`RAID_ERROR.full`, 4414) or any join once the run started. At most `raid.maxRooms` rooms (3) at once.
- Not listed in the lobby room list. The admin dashboard lists runs as HUNT with their wave and stage; Close works on them.
- The tick loop sleeps whenever nobody is connected (`idleWhenEmpty`); a room disposes when its last client leaves.
- State: `IslandState.raid` (stage, wave, the stage clock, tower, hunters left, the boss bar, ducks, team kills), `hunters`, `traps`, `raidDrops`, and the deathmatch's `dmRockets` for the boss wave launcher. Each duck's own run numbers (upgrades and their effects, kills, XP so far) and its cards go to that duck only as messages (`Msg.RaidSelf`, `Msg.RaidOffer`); a pick (`Msg.RaidPick`) is checked against its offer. No PlayerState field was added: the trap root is packed into `ex`.
- Visibility: every duck in a run is an ally (team 1), so ducks always get each other's poses and teammate entries. Hunters, traps and drops are public room state, sent to everyone in the room every tick regardless of line of sight: hunters are AI enemies of a co-op mode, not human opponents, so seeing them gives no human an edge over another (the CLAUDE.md Hunt Season rule). Hunter shots reach players as `Msg.Shots` entries with pid 0; decoys as `Msg.Proj` and `Msg.Boom` with `ExplosiveKind.Decoy`.
- Test hooks (`QWAKK_TEST_HOOKS=1`, never in production): `dev:raid` with `start`, `skip` (to a wave), `clear` (beat the wave), `break` (end it now), `hold` (ducks take no damage, the benchmark), `spawn` (one hunter of a kind in front of the asking duck, for screenshots).

## Client

- Hunters are drawn from the art (`game/raid/hunterAssets.ts`: the four looks on the shared rig with `hunter_anims.glb`, the dog with its own clips, LODs by distance, the Stars and Poof attached to `FxStars` and `FxPoof`, the held decoy on `LeftHandProp`, the duck toon recipe with a 7.5 mm outline). Body clips (Idle, Walk, Run at their authored speeds, Defeat, Whistle, Bite) play under upper body clips (Aim, Fire, Reload, Throw) split at `Spine`; the aim pitch turns `Spine2`. Without the art, greybox hunters (a capsule, a blaze-orange cap and a gun) stand in (`hunterView.ts`), and switch to the models once they load.
- Telegraphs: the rifleman's red laser (it stops on the duck it points at) and glint while it aims, the boss's orange wind-up glint, a small health bar once a hunter is hurt; a toony pop (dust and yellow stars, no blood) on hits and defeats.
- HUD (`hud/raid/raidHud.ts`): the wave bar (wave of 15, a boss star, the wave timer or the countdown, hunters left), the tower bar, the Big Hunter's bar, banners (lobby, wave start and clear, the whistle, the tower under attack), the cards, the duck's own upgrades, the knocked and out notes, markers for hunters at the tower and the last three, and the end screen with the XP and the level bar filling up. Phones: the same in a compact layout; cards are tapped, the Use button shows for a revive or the second wind.
- Sounds (synthesized, `audio/sound.ts`): the wave horn (deeper on boss waves), the wave clear cheer, the boss whistle, the decoy's duck call and pop, the trap snap, the tower knock, the card pick.

## Measured

`npm run bench:raid` (README, Hunt Season tables): the raid's own tick is about 0.2 ms headless with 30 hunters alive (p95 0.34 ms); networked, one full room (4 clients, wave 13, 26 to 30 hunters) ticks in 1.2 to 1.5 ms on average (p95 under 2.8 ms) and the whole server uses 8.6% of one core alone, 18.8% next to a deathmatch room of 1 client and 23 bots, about 8.5 to 9.2 KB/s down per client. The deathmatch benchmark is unchanged.
