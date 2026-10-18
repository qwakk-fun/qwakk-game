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

Streaks reset on death. Best streak survives until the next round. Streak
bonuses do not increase damage, health, armor, or movement speed. Shot/hit
counts come from actual server weapon shots and validated damaging hits,
not input messages, client hit claims or visual effects.

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
- `npm run build:test && npm run e2e:dm-rewards`

The browser smoke test starts an isolated local server with test-only auth,
injects combat inside that process (no production force-kill endpoint), and
checks real messages, private rewards, replay/skip/respawn, pickups, revenge,
MVP, round resets and an actual 60-second weapon rotation. Screenshots go to
`/tmp/qwakk-dm-rewards` or the directory passed to the script.
