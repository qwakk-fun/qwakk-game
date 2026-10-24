# Hunt Season melee art (the asset contract)

The duck katana, its scabbard, the duck's katana moves and the swing effects for Hunt Season's melee mode: big readable swings that cut through a horde. Built entirely by Python scripts driving Blender on the classic duck rig, like the rest of the duck art (no third-party models, textures or clips; see `../LICENSES.md`). The horde minions that go with it live in the hunter set (`../hunters/README.md`, Minions).

## Rebuild (one command)

```sh
sh qwakk-game/art/melee/build.sh               # about 60 seconds on an M4 Pro, renders included
sh qwakk-game/art/melee/build.sh --no-render   # about 2 seconds: meshes, clips, exports, melee.json
sh qwakk-game/art/melee/build.sh --quick       # fewer render samples
sh qwakk-game/art/melee/build.sh --only anim:Slash_1 --only keys   # render only some shots
```

Needs Blender 5.2 (`BLENDER=/path/to/blender` to override) and `ffmpeg` for the sheets. The build rebuilds the classic duck and its rig in memory from `art/blender/` (it writes nothing in `art/export/` and never touches `duck.glb` or `duck_anims.glb`), so the clips fit `duck.glb` bone for bone. It ends with `validate.py` (plain Python contract check). Two builds in a row give byte-identical GLBs, PNG and JSON (checked with `shasum` on 2026-10-24).

Headless three.js check (no browser, no dev server), from `qwakk-game/`:

```sh
node art/melee/tools/load_test.mjs
```

It plays every clip on `duck.glb` through an `AnimationMixer` (every track binds, bounds stay finite), attaches the katana and the scabbard with the poses below and checks that the katana's `Tip` lands where the art build measured it at seven checkpoint frames (measured error 0.5 to 1.7 mm), and that at `Draw`'s `grab` and `Sheathe`'s `release` the katana in the hand sits exactly in the scabbard's `KatanaSeat` (0 mm, 0.01 degrees).

## Files (published to `apps/client/public/models/melee/`)

| File | What | Triangles | Size |
| --- | --- | --- | --- |
| `katana.glb` | `Katana` (handle, guard, collar, tassel) with the `Blade` mesh and the empties as children; `Scabbard` with its `KatanaSeat` empty | katana 1,456 (Blade 304), scabbard 744 | 68 KB |
| `duck_melee_anims.glb` | Armature only, the classic duck's bones, every melee clip below | | 291 KB |
| `melee_fx.glb` | `SlashArc`, `Shockwave`, `EliteRing`, `Feather` | 224, 480, 256, 304 | 45 KB |
| `melee.json` | This contract as data: attach poses, clips, events, flow, the dash curve, hit arcs, checkpoints | | 10 KB |

The clips are a separate file on purpose: `duck_anims.glb` and its validator stay exactly as they were. Load `duck_melee_anims.glb` next to `duck_anims.glb` (same bone names, so its clips play on every duck character, `duck_<id>.glb` included) and split it into upper and lower parts the same way (`player/animations.ts`).

All GLBs are uncompressed glTF 2.0. The katana and the feather use one material, `QwakkMelee` (a 256 px palette texture with nearest filtering, its own palette: steel blade with a bright edge band, brand yellow `#ffd43b` diamond wrap and guard rim, beak orange `#ff8a3d` tassel and scabbard cord, brand dark `#151619` scabbard and guard). Give them the duck toon recipe (two bands, shadow tint `#d9a6a0`); every part is smooth shaded, so the 7.5 mm inverted hull outline works on them too. Local copies, `stats.json` (counts, IK reach error per clip, the full arc measurements), the palette and `melee.blend` are in `export/`.

## The katana (`katana.glb`)

- Axes (katana space, glTF): origin at the grip, the center of the right fist; the blade runs along **+Y**, the cutting edge faces **-Z**, the flats face ±X. 1.08 m from the pommel to the tip (blade 0.81 m, 7.6 cm wide at the guard): chunky and readable at third-person distance.
- Nodes: `Katana` (mesh, at the origin, no transform), children `Blade` (mesh, identity: tint or glow it alone for the blade storm), `Grip` (empty at the origin), `TrailStart` (on the edge near the guard, `[0, 0.19, 0.037]`), `TrailEnd` (on the edge near the tip, `[0, 0.89, -0.009]`), `Tip` (the point, `[0, 0.915, -0.058]`). A swing trail is a ribbon between `TrailStart` and `TrailEnd`, sampled each frame in world space.
- Attach (also `melee.json` `attach.katana`): child of the `RightHand` joint at position `[0, 0.08, -0.07]`, quaternion `[-0.5, 0.5, 0.5, 0.5]` (`[x, y, z, w]`). Same position as the guns in `weapons/attach.json`; the rotation differs because the handle runs through the curled fingers and the blade leaves the fist on the thumb side.

```js
const hand = duck.getObjectByName('RightHand');
const { position, quaternion } = melee.attach.katana;    // melee.json
hand.add(katana);
katana.position.fromArray(position);
katana.quaternion.fromArray(quaternion);
```

- The scabbard rides diagonally across the back: `Scabbard` child of the `Spine1` joint at position `[-0.255, 0.21, -0.3]`, quaternion `[-0.325573, 0.940842, 0.077096, 0.053616]` (`attach.scabbard`). The handle sticks out behind the right shoulder, clear of the big head; the tip ends low on the left, above the tail. Show it while the duck carries the katana (drawn or sheathed).
- Sheathed: make `Katana` a child of the scabbard's `KatanaSeat` empty with an identity transform. Drawn: the `RightHand` attach above. Switch at the `Draw` `grab` and `Sheathe` `release` events (re-parent without keeping the world transform; the two coincide on that frame).
- The guns: hide the gun while the katana is out (the katana takes the right hand and its own clips).

## Clips (`duck_melee_anims.glb`, 30 fps)

No root motion: the hips stay over the origin (spins and the dash included); the sim moves and turns the duck. Full-body clips carry rotation tracks for every joint plus a `Hips` translation; upper-body clips carry rotations only for `Spine` and everything below it (`melee.json` `upperBones`, the same split as `player/animations.ts` `UPPER_BONES`), so they layer over any locomotion clip. No scale tracks. Looping clips close exactly (the spin loop ends one full turn on, the same pose). Every full-body clip can also be split into its `@upper` part over locomotion (attack while running); the twist then comes from the spine only, the legs keep running.

| Clip | Seconds | Loop | Layer | What, and the events (seconds) |
| --- | --- | --- | --- | --- |
| `Katana_Idle` | 2.0 | yes | full | Ready stance: low and wide, the blade out at the right hip pointing up and forward (visible from behind), the free wing raised in front. Breathing, blade bob, a tail wag |
| `Katana_Run` | 0.367 | yes | upper | Over `Run_*` or `Sprint`: the blade trails low behind the right hip, the left wing swings with the stride. As long as `Run_F`: set its time to the run's normalized time x 0.367 |
| `Slash_1` | 0.4 | no | full | Right to left, a flat forehand cut at belly height. `activeStart` 0.13, `impact` 0.16, `activeEnd` 0.20, `comboOpen` 0.18, `comboClose` 0.34, `recover` 0.27; back in `Katana_Idle` by 0.40 |
| `Slash_2` | 0.433 | no | full | Left to right, a rising backhand. Starts in `Slash_1`'s follow-through. `activeStart` 0.11, `impact` 0.15, `activeEnd` 0.20, `comboOpen` 0.19, `comboClose` 0.36, `recover` 0.29 |
| `Slash_3` | 0.533 | no | full | The finisher: a hop (both feet leave the ground) and an overhead chop that slams the blade into the ground ahead. Starts in `Slash_2`'s follow-through. `activeStart` 0.24, `impact` 0.30, `activeEnd` 0.33, `recover` 0.40 |
| `Heavy_Charge` | 1.0 | yes | full | Hold: coiled low, blade hidden behind the right hip, the free wing pointing at the target, trembling. Enter from `Katana_Idle` with a 0.15 s crossfade |
| `Heavy_Release` | 0.6 | no | full | A 360 degree spin cut at belly height, blade straight out: from the coil the blade sweeps the right, the front (`impact` 0.09), then one full turn of the body (passing the front again at 0.42). `activeStart` 0.04, `activeEnd` 0.44, `recover` 0.50 |
| `Dash` | 0.267 | no | full | A low lunge, both feet off the ground, blade trailing low behind. `moveStart` 0.03, `moveEnd` 0.20; ends in `Katana_Idle` |
| `Quack_Shockwave` | 0.5 | no | full | Puff up (lean back, wings flung up, left foot raised), then a stomp and a huge quack, bill wide open: `impact` 0.24 (the shockwave leaves the feet), `recover` 0.38 |
| `Ultimate` | 0.4 | no | full | Blade storm activation: crouch, the katana shoots up beside the head, battle quack: `flash` 0.24. The last frame is `Ultimate_Spin`'s first |
| `Ultimate_Spin` | 0.4 | yes | full | One full turn to the left per loop, blade straight out at belly height, small hops. Leave to `Katana_Idle` with a 0.1 s crossfade |
| `Draw` | 0.467 | no | upper | From the unarmed upper body (`Idle`): reach over the right shoulder, `grab` 0.1333 (move the katana from `KatanaSeat` to the hand), slide it out, whip it over into the guard: `ready` 0.4333 |
| `Sheathe` | 0.5 | no | upper | From `Katana_Idle`'s upper body: blade up beside the head, tip to the scabbard, slide home: `release` 0.30 (move the katana to `KatanaSeat`); arm back to the unarmed `Idle` by 0.50 |

Event meanings: `activeStart` to `activeEnd` is when the blade sweeps (deal the hit once per target inside this window, or all at `impact`); `impact` is the frame the blade passes the duck's front (hit-stop, sparks, the camera kick); `comboOpen` to `comboClose` is when the next light attack may chain (crossfade about 0.06 s; each slash starts from the pose the previous one leaves in its window, so chaining never pops); `recover` is when a dash, a move or another skill may cancel the follow-through. Played alone, every attack ends in `Katana_Idle`'s first pose.

`melee.json` `clips.<name>.flow` says which clip each one follows and where it leaves the duck.

### The dash distance

`Dash` has no root motion. Move the duck **3.0 m** forward over the clip (`melee.json` `dash.distance`), following `dash.progress`, the fraction covered at each 30 fps frame: `[0, 0.043, 0.414, 0.689, 0.873, 0.972, 1, 1, 1]` (frames 0 to 8; a burst between 0.03 and 0.20 s that eases to a stop). The feet are off the ground the whole time the duck moves, so no foot slides whatever the speed.

## Suggested hit arcs (measured from the animation)

Measured from the blade tip and the blade's inner end across each active window, sampled at 120 Hz, in the duck's model space. Angles are degrees from the duck's forward, **positive to the duck's right** (clockwise from above). "Reach" is the tip's horizontal distance from the duck's origin. The suggested shapes add 0.25 m of forgiveness to the reach and 15 degrees on each side of a slice. Full numbers in `melee.json` `arcs`.

| Move | Measured sweep (tip) | Reach / inner | Height of the blade (m) | Suggested hit |
| --- | --- | --- | --- | --- |
| `Slash_1` | +116 to -70 (186 degrees) | 1.37 / 0.50 | 0.66 to 1.17 | slice: center +23, half angle 108, radius 1.62 |
| `Slash_2` | -84 to +108 (191 degrees) | 1.36 / 0.54 | 0.91 to 1.42 | slice: center +12, half angle 110, radius 1.61 |
| `Slash_3` | an overhead chop about 18 degrees right of forward | 1.34 | from 2.14 down to the ground | circle on the ground, center `[x -0.39, z 0.88]`, radius 1.1 |
| `Heavy_Release` | 504 degrees (a full circle and more) | 1.39 / 0.56 | 0.56 to 0.82 | circle, radius 1.64, each target once |
| `Ultimate_Spin` | 360 degrees per 0.4 s loop | 1.37 / 0.65 | 0.80 to 0.92 | circle, radius 1.72, tick a few times per turn |
| `Quack_Shockwave` | not a blade | | | a ring growing from 0.5 to 4.5 m over 0.35 s from `impact` (a suggestion: scale `Shockwave` to match) |

These arcs are big on purpose (the "slash through the horde" feel); the sim may keep its own numbers. The art does not decide damage or hits.

## Effects (`melee_fx.glb`)

FX space: the ground plane is XZ (glTF), forward +Z, Y up. `SlashArc`, `Shockwave` and `EliteRing` are flat ribbons with material `MeleeFx`: a vertex color (`COLOR_0`) already holds a white-hot to transparent glow ramp (black is invisible), and `TEXCOORD_0` runs u along the piece (0 to 1) and v across it (0 inner edge, 1 outer edge) for shader fades. Draw them additive, `depthWrite` off, double sided, with `vertexColors`.

- `SlashArc`: a crescent of radius 1 m, 200 degrees wide, centered on +Z, thickest in the middle, tapering to points; u = 0 at the duck's right end (where a right-to-left swing starts), u = 1 the bright leading left end. Scale it to the swing's reach (about 1.4), place it at the blade's height, mirror x for a left-to-right swing, tilt it for diagonals, fade it out over about 0.15 s.
- `Shockwave`: a ground ring of outer radius 1 m with a bright rim fading inward and a short 0.22 m wall; scale it up from the `impact` and fade it by time.
- `EliteRing`: a 0.6 m ground ring with eight outward spikes in hot orange-red, under an elite enemy (scale it to the enemy, spin it slowly).
- `Feather`: the XP pickup, a chunky golden feather 0.30 m tall, origin at its middle, toon material on the melee palette; bob and spin it about Y and add a glow sprite if wanted.

## Scripts

| File | Role |
| --- | --- |
| `blender/mp.py` | Katana proportions, the melee palette, where the scabbard rides, effect sizes, budgets |
| `blender/katana.py` | The katana, the scabbard, their contract points and the seat transform |
| `blender/mclips.py` | Every clip as code: the stance parameter set (the grip in polar coordinates, so swings follow true arcs), keys, events, flow |
| `blender/mfx.py` | The effect meshes |
| `blender/mmeasure.py` | Blade sweeps, hit arcs and checkpoints from the solved poses |
| `blender/mrender.py` | Review renders |
| `blender/build_melee.py` | Entry point, exports, `melee.json` |
| `validate.py` | Contract check (plain Python) |
| `tools/load_test.mjs` | Headless three.js load, playback, attach and hand-over check |

## Review renders (`renders/`, WebP)

`katana_closeup.webp` (side, three-quarter, edge-on, with the scabbard), `katana_hold.webp` (in the hand from the front three-quarter, the side and the game camera side, then sheathed on the back), `katana_grip.webp` (the fist on the handle), `key_poses_tps.webp` and `key_poses_front.webp` (the key moment of every move from the game camera side and the front), `fx_sheet.webp`, `anim_contact_sheet.webp` (every clip, eight frames from behind and eight from the side; upper-body clips layered over `Run_F` or `Idle` like the engine) and one sheet per clip in `anim/`.

## Known weak spots

- Clips are procedural (eased keys between stances, analytic IK), clean but without hand-keyed irregularities. IK reach: `Draw` misses its path by up to 1.4 cm as the blade passes beside the head, `Slash_3` by 0.5 cm in the hop; every other clip reaches exactly (`export/stats.json`).
- From the over-the-shoulder camera the blade is hidden behind the duck's own body for the frame or two it points straight ahead (the duck is big and wide); the sweep shows on both sides, and the trail ribbon and `SlashArc` carry the read.
- `Draw` and `Sheathe` cheat for speed: the blade passes through the scabbard and the back for two or three frames while it leaves or enters (the arm is far too short to pull 0.8 m of blade out along the scabbard).
- The wrist bends hard in the widest swings (the edge leads the cut): fine on the chunky mitten hand at game distance, visible in close-ups.
- The tassel is rigid (part of the katana mesh).
