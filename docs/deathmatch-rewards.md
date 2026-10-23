# Deathmatch rewards

Rules live in `packages/shared/src/deathmatch.ts`. Only the authoritative
server grants points, pickups and weapon rotations; messages are feedback,
not client requests. These are round points, not persistent leaderboard XP.
The existing kill limit and persisted match placement by kills stay intact.

| Event | Reward |
| --- | --- |
| Elimination | 100 points |
| Nonlethal headshot | 10 points |
| Headshot elimination | 50 extra points |
| Eliminate your most recent killer | 50 extra points, consumed once |
| 3 / 5 / 10 kills without dying | 50 / 100 / 200 extra points, special toast and sound |
| Take down the caped hero | 300 extra points (`dm.heroKillPoints`), and the cape |
| Hold the cape | 10 points every 5 s (`dm.heroHoldPoints`) |

Streaks reset on death. Best streak survives until the next round. Streak
point bonuses alone do not change health or armor; kill stacks (below) are
the one combat bonus a run of kills brings. Shot/hit counts come from actual
server weapon shots and validated damaging hits, not input messages, client
hit claims or visual effects.

## Kill stacks

The owner decided that a run of kills should make a duck hit harder and
move faster. Every kill since the last death adds one stack, up to five
(`KILL_STACKS.max`). Each stack gives:

- +6% bullet damage (admin setting `dm.stackDamagePercent`, default 6, server
  only: the client never predicts damage). It applies on the shooter's side,
  before the victim's armor boost.
- +4% movement speed (`KILL_STACKS.speedPerStack`, a constant: the speed is
  part of the shared sim, so the client predicts it exactly, like the speed
  pickup, and stacks with it).

Death, respawn and the round end clear the stacks. `dm.killStacks` turns
gaining them off. The count is packed with the hero bit into the sim field
`dmBuff` (`packages/shared/src/dmBuffs.ts`), public on the player state: it
follows from the public kill feed anyway and holds no position. Everyone who
receives a duck's pose sees its aura grow per stack (orange, hotter with
embers at five); you also get a stack meter, a toast and a rising chime.

## Caped hero

Five seconds into a round, and then every `dm.heroEverySeconds` (120 s) on a
fixed schedule, if nobody holds the cape the server picks a random living
duck (humans and bots alike) as the hero (`apps/server/src/dmHero.ts`). The
hero:

- gets `dm.heroHealth` health (200; normal ducks have 100) and a full flight bar;
- can fly (`packages/shared/src/heroFlight.ts`, part of the shared sim, so
  the client predicts it and the server's copy decides): hold Jump in the air
  to climb at 5.5 m/s up to 12 m above the ground below, where it hovers;
  steer with the normal move keys at 6.4 m/s; let go to glide down (fall
  speed capped at 2.6 m/s). Thrust drains the flight energy (4 s of thrust),
  standing on the ground refills it in 4 s, so the hero has to land and is
  never out of reach for long. On phones the Jump button is held the same way;
- wears a cape (orange outside, yellow lining, dark hem) and a gold aura with
  sparkles; take-off and landing have a burst and a puff.

Whoever takes the hero down takes the cape (full hero health and energy) and
the takedown bonus. A hero that dies any other way (or leaves) frees the cape
until the next scheduled pick. Everyone sees a center announcement ("X is the
hero!", "X took the cape!", "The cape is free") and a kill feed line
(`Msg.DmHero`, no position). Bots that see the hero pick it over closer
targets; a bot hero flies in short hops and glides back down.

### The hero ping (deliberate visibility exception)

So the others can hunt the hero, every 5 s (`DM_HERO.pingEverySeconds`)
everyone but the hero gets `Msg.DmHeroPing`: the hero's position rounded to a
10 m grid (`DM_HERO.pingGrid`), shown on the HUD compass with a rough
distance. This is a public mode objective like the pickups, written down as
the one exception to the anti-wallhack rule in `CLAUDE.md`. Nothing finer,
nothing more often, and never a pose: the hero's real position, flight state
and energy reach only viewers who see it (or the hero itself).

## Temporary map pickups

Every 20 seconds, one random pickup can appear on the map's validated spawn
ground, away from players and other pickups. Maximum three, 25-second map
lifetime. Living, unprotected humans and bots collect on contact (1.7 m
three-dimensional radius, with a wall ray check). One player wins each
pickup. Effects last 10 seconds and replace, rather than stack with, the
current effect:

- Speed: +15% movement speed.
- Armor: 25% bullet damage absorption, capped at a 25 HP shield pool.
- Jump: +20% jump velocity.

Effect state and remaining ticks are part of the shared simulation and
owner-only reconciliation fields. They clear on death, respawn and round
end. Battle royale keeps all these fields at zero. Pickup positions are
public map objectives; they do not expose enemy positions.

## Weapon rotation and results

Every 60 seconds, everyone rotates between the existing rifle and pistol.
The HUD gives a five-second warning. Ammo refills and reload/spray state
resets. Both bots and humans use the same single-weapon loadout; late joins
and respawns get the current weapon. The round starts with rifles.

Round-end schema rows freeze points, kills, deaths, best streak, fired shots
and hits. The MVP card selects most points, with kills/deaths/pid as stable
tie-breaks. Separate cards show highest streak and accuracy (at least ten
shots to qualify); the player also sees their own round statistics. The
round winner is still decided by kills. Results survive departures during
intermission and disappear on the next round. Tab still opens the board.

## Death replay

The server keeps up to 2.5 seconds of bounded pose history at 12 Hz. On a
kill it sends only the killer/victim pair to the dead victim, never other
players or living spectators. The client follows the killer with the existing
collision-aware shoulder camera, including when the killer was outside the
victim's view. This reconstructs the killer's aim and movement, rather than
recording their exact screen (visual recoil and third-party effects are omitted).
History never crosses respawns or rounds. Current particles and name tags are
hidden during replay. Space or the on-screen button skips it; authoritative
respawn or intermission cancels it. The normal three-second respawn delay is
unchanged. Buffs and combat continue server-side throughout.

## Validation

- `npm test -w @qwakk/server -- test/dmRewards.test.ts`
- `npm test -w @qwakk/shared -- test/dmEffects.test.ts`
- `npm test -w @qwakk/client -- test/deathReplay.test.ts`
- `npm test -w @qwakk/shared -- test/dmBuffs.test.ts` (stack speed, flight, determinism)
- `npm test -w @qwakk/server -- test/dmHero.test.ts` (stacks, hero pick, cape transfer, ping)
- `npm run build:test && npm run e2e:dm-rewards`

The browser smoke test starts an isolated local server with test-only auth,
injects combat inside that process (no production force-kill endpoint), and
checks real messages, private rewards, replay/skip/respawn, pickups, revenge,
MVP, round resets and an actual 60-second weapon rotation. Screenshots go to
`/tmp/qwakk-dm-rewards` or the directory passed to the script.
