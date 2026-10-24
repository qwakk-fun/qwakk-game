# Hunt Season progression (balance)

A duck that plays Hunt Season grows: its level unlocks the katana's moves, every level gives a skill point for a small tree, and Tüy (Feathers) it earns buy better katanas and armor at Duck Plaza's market stalls. It never jumps: every purchase or point is a few percent, and a fully grown duck is about 1.8 times as strong as a fresh one, reached over about a hundred runs. **Hunt Season only:** the deathmatch and the battle royale never read any of it (levels stay cosmetic in PvP; a source test checks that only the Hunt Season code reads a kit).

**Tüy is an in-game soft currency earned only by playing Hunt Season. It is never sold for real money, never tradeable between ducks or accounts, and never a token.** No crypto rewards in the game (CLAUDE.md product rule).

Code: shared `packages/shared/src/raid/` (`unlocks.ts`, `gear.ts`, `tree.ts`, `kit.ts`; the menu reads them as `@qwakk/shared/duck`), server `apps/server/src/meta/progression/` (`store.ts` the rows, `service.ts` the `/api/duck` routes), `apps/server/src/meta/raid.ts` (the Tüy grant at a run's end), `apps/server/src/raid/raid.ts`, `raid/blade.ts`, `raid/upgrades.ts` and `RaidRoom.ts` (the kit in a run); client `apps/client/src/ui/menu/duck/` (My Duck, the shop panel), `src/hub/` (the stalls), `game/raidClient.ts`, `hud/raid/` (locks, the end screen), `player/meleeRig.ts` (the katana's tier look), `world/sainte/itemMeshes.ts` (the armor band). Migration `apps/server/db/migrations/007_progression.sql`. Tests: `packages/shared/test/progression.test.ts`, `apps/server/test/raid/progression.test.ts`, `apps/server/test/meta/progression.db.test.ts`, `apps/server/test/raid/room.test.ts`, `apps/server/test/duckPlaza.test.ts`; e2e `e2e/raid.ts` (the chain) and `e2e/hub.ts` (the phone shop).

## Levels unlock the katana's moves

XP and the level curve are unchanged (`raid/progress.ts`: level n needs `round(100 n^1.5)` XP, cap 50; `docs/hunt-season.md`).

| Level | Unlocks | Cumulative XP | About runs |
| --- | --- | --- | --- |
| 1 | Light combo (Slash 1, 2, 3) | 0 | 0 |
| 2 | Dash | 100 | 1 (any run that takes an objective) |
| 3 | Pistol (the secondary) | 383 | 1 |
| 4 | "VAK!" Quack Shockwave | 903 | 1 |
| 6 | Charged heavy spin | 2,821 | 2 |
| 8 | Blade Storm | 6,143 | 4 to 5 |

Existing ducks keep their level and get what it unlocks at once. A locked move's HUD button shows a padlock and its level (desktop skill bar and the touch buttons); the end screen names the moves a level-up unlocked and the new skill points.

How a lock is enforced (server state or server-masked input only, so prediction stays exact):

- Dash, VAK! and the Blade Storm are input buttons. The server masks a locked one off every input of that duck before the step (`Raid.beforeStep`, `lockedButtonsOf`), and the client masks the same bits before it sends and predicts (`RaidClient.lockedButtons`; everything is locked until `Msg.RaidKit` arrives, which can only mask more than the server, never less). A cheat that sends them anyway gets nothing.
- The pistol is the `arms` bit the server hands out at a spawn (`armBlade`): without it Slot 2 does nothing and an ammo drop is not taken.
- The charged heavy is `ex` bit 15 (`EX_HEAVY_LOCK`), set by the server at a spawn: the sim never starts a charge while it is set. Replay tests: `packages/shared/test/progression.test.ts`.
- The storm meter of a duck without the storm stays empty (server).

## Tüy (Feathers)

Granted by the game server at the end of a run, in the same transaction as the XP (`recordRaid`), once per run id, recomputed from the server's run numbers (`raidFeathers`, `kit.ts`). No HTTP route grants Tüy, XP or levels.

| Source | Tüy |
| --- | --- |
| Objective n taken (1 to 4) | 25, 30, 35, 40 |
| Minions bagged | 1 per 5 |
| Elites and other hunters bagged | 1 each |
| The Big Hunter down (every duck that hit him) | 25 |
| The win | 50 |
| First run of the day (UTC) that took an objective | +50 |
| Most per run (the daily bonus on top) | 400 |

### Typical runs

| Run | XP | Tüy (no daily) |
| --- | --- | --- |
| Short loss: 1 objective, 30 minions, 4 elites | 254 | 35 |
| Solid loss: 3 objectives, 120 minions, 20 elites | 1,057 | 134 |
| Solo win: 4 objectives, 200 minions, 40 elites, the boss | 2,455 | 285 |
| Average (40% wins, 40% solid, 20% short; 3 runs a day) | about 1,450 | about 190 (with a third of the daily bonus) |

A test-hook win with no kills (the e2e) gives 180 Tüy plus the daily 50: a fresh duck can buy the Bamboo Blade after its first win.

## Gear (Tüy only, level gated)

Bought at Duck Plaza's market stalls by the fountain: the **Blacksmith** (katanas) and the **Armorer** (armor). Walk up to the counter, press E (tap the button on a phone): a small panel lists the slot's tiers with their stats, the comparison with what the duck wears, the level lock, the price and one button (Buy, Equip or Equipped). Bought items are not equipped by themselves. Equipped gear counts from the next run.

| Katana | Level | Tüy | Damage | Crit chance | Power | Step | Look |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Training Bokken | 1 | starter | x1.00 | 0% | 1.00 | | wooden blade |
| Bamboo Blade | 3 | 200 | x1.07 | 2% | 1.08 | +8% | pale green blade |
| Steel Katana | 7 | 750 | x1.14 | 4% | 1.17 | +8% | the art's steel |
| Moonsteel | 12 | 2,000 | x1.22 | 6% | 1.26 | +8% | pale blue, blue glow |
| Dragon Fang | 18 | 4,500 | x1.30 | 8% | 1.36 | +8% | orange, ember glow |

| Armor | Level | Tüy | Max health | Damage stopped | Effective health | Step | Look |
| --- | --- | --- | --- | --- | --- | --- | --- |
| None | | | +0 | 0% | 1.00 | | |
| Padded Vest | 2 | 150 | +8 | 3% | 1.11 | +11% | cream vest band |
| Leather Jerkin | 5 | 550 | +16 | 6% | 1.23 | +11% | brown, a yellow trim |
| Chain Shirt | 10 | 1,500 | +24 | 9% | 1.36 | +10% | steel grey, an orange trim |
| Toony Plate | 16 | 3,500 | +32 | 12% | 1.50 | +10% | light steel, two yellow trims |

Power: damage times (1 + crit chance x 0.6) for a katana (a crit is x1.6); (100 + health) / 100 / (1 - stopped) for armor. Katana damage applies to every katana cut (slashes, the heavy, storm pulses, the dash's cut), not the pistol, the quack or the cannons. The random crit is rolled by the server on a cut that is not already a crit (a back-stab, a full heavy). Looks: the tier tints the existing katana's Blade mesh (one material per tier, `meleeRig.ts`) and the armor is the battle royale vest band in the tier's colors (`itemMeshes.ts`, vest levels 11 to 14); no new art, never a hitbox change. Helmet and charm slots exist in the data model (`duck_equipped.slot`), nothing is sold for them yet.

## The skill tree

One point per level from level 2, plus one at every tenth level (level 10: 10 points, level 29: 30). Three branches of five nodes, 30 ranks in all, so the tree fills around level 29 and before that the duck chooses. Prerequisites inside a branch; a capstone needs level 15 and 7 points in its branch. Every effect is a server number: no node changes a cooldown, a timing or movement (those are client simulated; changing them per duck would need per-duck sim values, which we keep out).

| Branch | Node | Ranks | Per rank | Needs |
| --- | --- | --- | --- | --- |
| Blade | Sharp Edge | 3 | +3% katana damage | |
| Blade | Long Reach | 2 | +4% swing reach (the server's sweep) | Sharp Edge 1 |
| Blade | Finisher | 2 | +10% Slash 3 and heavy spin damage | Sharp Edge 2 |
| Blade | Lucky Edge | 2 | +2% crit chance | Long Reach 1 |
| Blade | Iaido (capstone) | 1 | crits x1.85 instead of x1.6 | level 15, 7 in Blade |
| Agility | Thick Feathers | 3 | +5 max health | |
| Agility | Tough Down | 2 | 3% less damage taken | Thick Feathers 1 |
| Agility | Dash Strike | 2 | +25% dash cut damage | Thick Feathers 1 |
| Agility | Sidestep | 2 | 3% chance a hunter's hit misses | Tough Down 1 |
| Agility | Last Stand (capstone) | 1 | once an objective, a knockdown blow leaves 1 health | level 15, 7 in Agility |
| Quack | Loud Quack | 3 | +8% VAK! reach, +20% VAK! damage | level 4 |
| Quack | Stunning Quack | 2 | +30% VAK! stagger | Loud Quack 1 |
| Quack | Storm Heart | 2 | storm meter fills 10% faster | level 8, Loud Quack 1 |
| Quack | Eye of the Storm | 2 | +15% storm pulse damage | Storm Heart 1 |
| Quack | Rallying Quack (capstone) | 1 | VAK! heals the duck and friends in its ring 10 | level 15, 7 in Quack |

Respec: the first one is free, every later one costs 300 Tüy (My Duck, "Reset the tree"). The server re-checks a stored tree against the rules whenever it builds a kit (`cleanTree`).

## How strong, and when

A duck's kit numbers sit under the run's upgrade cards (which everyone draws the same way): cards multiply on top. Effective damage counts the light combo with crits; effective health counts health, damage taken and dodges (`kitPower`, unit tested to land between 1.6 and 2 for a full kit).

Purchase order by level (Padded, Bamboo, Leather, Steel, Chain, Moonsteel, Plate, Dragon) at the average run (1,450 XP, 190 Tüy):

| Runs | Level | Katana | Armor | Tree points | Damage | Health | Power | Hunter health / damage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | Training Bokken | none | 0 | 1.00 | 1.00 | 1.00 | 1.00 / 1.00 |
| 1 | 4 | Training Bokken | Padded Vest | 3 | 1.06 | 1.16 | 1.11 | 1.00 / 1.00 |
| 2 | 6 | Bamboo Blade | Padded Vest | 5 | 1.18 | 1.22 | 1.20 | 1.00 / 1.00 |
| 5 | 8 | Bamboo Blade | Leather Jerkin | 7 | 1.18 | 1.39 | 1.28 | 1.00 / 1.00 |
| 10 | 11 | Steel Katana | Leather Jerkin | 11 | 1.33 | 1.48 | 1.41 | 1.01 / 1.005 |
| 20 | 14 | Steel Katana | Chain Shirt | 14 | 1.39 | 1.73 | 1.55 | 1.04 / 1.02 |
| 30 | 16 | Moonsteel | Chain Shirt | 16 | 1.54 | 1.73 | 1.63 | 1.06 / 1.03 |
| 50 | 20 | Moonsteel | Toony Plate | 21 | 1.58 | 1.89 | 1.73 | 1.10 / 1.05 |
| 70 | 23 | Dragon Fang | Toony Plate | 24 | 1.71 | 1.89 | 1.80 | 1.13 / 1.065 |
| 120 | 29 | Dragon Fang | Toony Plate | 30 | 1.71 | 1.89 | 1.80 | 1.19 / 1.095 |

(The tree in this table puts its points into Blade and Agility first; points in Quack add VAK! and storm power the single number does not count.) When each item becomes affordable at the average run: Padded run 1, Bamboo run 2, Leather run 5, Steel run 9, Chain run 17, Moonsteel run 27, Plate run 46, Dragon run 69 (Tüy is the limit from the Leather on, the level for nothing after that: a duck that saves skips nothing). At 3 to 4 runs a day: the first upgrades on day one, the full set in about three weeks, the full tree in about a month.

### Strong ducks: the level scaling

So runs stay fun for strong ducks without punishing fresh ones: hunter health grows 1% and hunter damage 0.5% per level of the party's average above level 10, at most +25% and +12.5% (level 35). Read at the run's start (`levelScale`, admin settings `raid.levelHpPercent` and `raid.levelDamagePercent`, 0 turns it off). A top duck still clears its runs about 1.4 times faster and takes about 1.7 times the beating of a fresh one. A party of fresh ducks plays exactly as before.

## Data (migration 007)

| Table | What | Written by |
| --- | --- | --- |
| `duck_progress` | per duck: Tüy balance (`check >= 0`), Tüy ever earned, respecs, the day of the last daily bonus | the run grant (game server), the checked routes |
| `feather_ledger` | every balance change: delta, balance after, reason (`run`, `daily`, `buy`, `respec`, `admin`), ref (run id, item, day), idempotency key (unique per duck), time; append only | same |
| `duck_items` | owned items (primary key duck and item: an item is bought once), source (`starter`, `shop`, `admin`) | the starter on first use, purchases |
| `duck_equipped` | per slot (`katana`, `armor`, `helmet`, `charm`) the item worn; a foreign key to `duck_items`, so only owned items | equips |
| `duck_tree` | rank per node | tree spends, respecs |

Every row belongs to one duck (`players.id`, `on delete cascade`): deleting a duck or an account deletes all of it (`deleteCharacter`, `deleteAccount`; tested). Existing ducks get their rows on first use (the starter katana, a zero balance). The admin panel's player search shows a duck's level and Tüy balance (read only).

## API (`/api/duck`, the game session token)

The duck is the session token's player id (`verifySession`), and it must be an account duck; the body only names what to buy, wear or raise. Guests (403 `needs_account`) cannot have progression, and they cannot play Hunt Season anyway.

| Route | Body | Answer |
| --- | --- | --- |
| `GET /api/duck` | Bearer | `{ duck }`: level, XP, Tüy, owned, equipped, tree, respecs |
| `POST /api/duck/buy` | `{ item, key? }` | `{ duck }`; `needs_level`, `too_poor`, `owned`, `unknown_item`, `not_for_sale` |
| `POST /api/duck/equip` | `{ item }` | `{ duck }`; `not_owned` |
| `POST /api/duck/tree` | `{ node }` | `{ duck }`; `no_points`, `needs_level`, `needs_node`, `needs_branch`, `maxed`, `unknown` |
| `POST /api/duck/respec` | `{ key? }` | `{ duck }`; `too_poor`, `nothing_to_reset` |

Every write is one transaction with the duck's `duck_progress` row locked (`select ... for update`): concurrent requests of one duck run one after the other, so Tüy is never spent twice (tested with ten concurrent buys and two buys the balance pays for only one of). `key` (8 to 64 of `A-Z a-z 0-9 _ -`) makes a retried purchase or respec answer the stored state (`replay: true`) instead of charging again. Limits in memory: per duck a burst of 12, then 2 a second; per IP a burst of 60, then 4 a second (loopback exempt outside production).

## In a run (`RaidRoom`)

- At join the room reads the duck's kit from the database by its verified player id (`duckKit`), never from the join options, and fixes it for the run. Without a database answer the duck plays as a fresh duck (its run is then not saved either). Dev identities without a token (non-production only) and bot ducks get every move and no gear, as before.
- `Msg.RaidKit` to the duck itself at join and at the start: `[level, unlockBits, katanaTier, armorTier, bladeDamagePct, critChancePct, bonusHp, damageStoppedPct]`.
- `Msg.RaidLooks` to everyone in the run: `[pid, katanaTier, armorTier, ...]` (cosmetic; every duck in a run is an ally).
- `Msg.RaidEnd` gains `feathersGained, feathersBefore, feathersAfter, dailyBonus` (indices 15 to 18; -1 until stored).
- Test hook `dev:raid` `unlock` (test servers only): every move for that duck for the rest of the run, in memory (the stored level is untouched).
