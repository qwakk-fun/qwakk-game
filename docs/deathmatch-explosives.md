# Deathmatch explosives

Grenades and a rare rocket launcher, deathmatch only. Numbers live in
`EXPLOSIVE` (`packages/shared/src/constants.ts`); the server-only ones have
admin settings. The battle royale never hands any out.

| | Grenade | Rocket |
| --- | --- | --- |
| How you get it | 2 per life (`dm.grenadesPerLife`), refilled on respawn | Map pickup, 3 rockets (`dm.rocketsPerPickup`), one at a time, every 45 to 60 s, gone after 30 s |
| Controls | Hold G (touch: Nade) to see the arc, let go to throw | 3 (touch: Rocket) raises the launcher, Fire launches, 1 or 2 put it away |
| Gate | 0.8 s between throws, the gun waits 0.3 s | 1.1 s between rockets, 0.4 s to raise |
| Flight | 19 m/s lob along the aim, bounces, rolls, fuse 2.5 s | 34 m/s straight at the crosshair point, explodes on impact or after 3 s |
| Damage | 98 at the center (1.2 m), linear to 12% at 6.5 m | 85 splash (0.8 m core, 4.5 m), plus 45 to the duck it hits |
| Knockback | 7 m/s push, 4.5 m/s up at the center | 9 m/s push, 5.5 m/s up |

Always: walls that stop bullets protect (`blastReach` casts `BULLET_QUERY_GROUPS`
rays to the feet, belly and head), teammates take no damage and no push,
your own blast hurts you at half (`weapons.explosive.selfDamage`),
spawn-protected ducks take nothing, armor boosts absorb as for bullets.
A throw ends your spawn protection. Explosive hits do not count toward
accuracy. Kills show a grenade or rocket icon in the feed.

## Authority

- Shared sim (`explosives.ts`, predicted): the throw on release, the
  launcher slot, both gates and the counts, packed in the one sim field
  `ex` (the player schema is near its 64 field limit).
- Server (`apps/server/src/dmExplosives.ts`): flights, fuses, blasts,
  damage, knockback, the pickup. Projectiles do not rewind (they fly in the
  present and can be dodged).
- Knockback is added to the duck's sim velocity (float32), and the shared
  movement step carries it, so the owner's prediction replays it exactly
  after the one unavoidable correction at the blast.
- Stand-in steps hold the grenade button where it was, so they never throw;
  Slot3 is masked like the other one-shot buttons.

## Who hears what (`dmExplosivesNet.ts`)

- Throw or launch: full projectile (`Msg.Proj`) only to the thrower and
  viewers who see the thrower; others in earshot (30 m throw, 220 m launch)
  get `Msg.ShotHint` with `KillWeapon.Grenade` or `Rocket`, a direction and a
  loudness, nothing that places the thrower.
- A grenade at rest is shown, without its thrower or velocity, to viewers
  who see its spot within 45 m.
- Explosions (`Msg.Boom`) are public within 300 m: kind and position only.

## Admin settings

`dm.grenadesPerLife`, `dm.rocketsPerPickup`, `dm.rocketPickupMinSeconds`,
`dm.rocketPickupMaxSeconds`, `weapons.grenade.damage`,
`weapons.grenade.radius`, `weapons.grenade.fuseSeconds`,
`weapons.rocket.damage`, `weapons.rocket.directDamage`,
`weapons.rocket.radius`, `weapons.explosive.selfDamage`,
`weapons.explosive.knockback`.

## Validation

- `npm test -w @qwakk/shared -- test/explosives.test.ts`
- `npm test -w @qwakk/server -- test/dmExplosives.test.ts`
- `npm run build:test && npm run e2e:explosives -- DIR` (two browser ducks:
  the throw arc, a grenade blast, the launcher, a rocket with its trail;
  frames in DIR)
