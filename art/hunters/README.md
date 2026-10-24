# Duck hunters (raid enemies)

The enemies of the co-op raid mode: humans hunting our ducks around the QoreChain Tower on Kavren. Four hunter looks on one shared skeleton (Rifleman, Trapper, Decoy thrower, and the boss "Big Hunter"), two cheap horde minions for the melee waves on the same skeleton (Beater, Recruit), a hunting dog, a wooden decoy duck, a net trap and the toony defeat effects. Built entirely by Python scripts driving Blender, like the ducks: no third-party models, textures or clips (see `../LICENSES.md`).

## Rebuild everything (one command)

```sh
sh qwakk-game/art/hunters/build.sh             # about 55 seconds on an M4 Pro, renders included
sh qwakk-game/art/hunters/build.sh --no-render # about 5 seconds: meshes, rig, clips, exports, manifest
sh qwakk-game/art/hunters/build.sh --quick     # fewer render samples
sh qwakk-game/art/hunters/build.sh --only anim:Defeat --only lineup   # render only some shots
```

Needs Blender 5.2 at `/Applications/Blender.app` (or `BLENDER=/path/to/blender`) and `ffmpeg` for the sheets. The build ends with `validate.py` (plain Python contract check). The exports are deterministic: two builds in a row give byte-identical GLBs, PNG and JSON (checked with `shasum` on 2026-10-23).

Headless three.js check (no browser, no dev server), from `qwakk-game/`:

```sh
node art/hunters/tools/load_test.mjs
```

It loads every file with three's GLTFLoader, plays every clip on every hunter through an `AnimationMixer`, and checks that all tracks bind, the bounds are finite, the muzzle is in front, the hat leaves the head and the stars show in `Defeat`, the hidden joints fall back to scale 0 after the defeat stops, and the attach poses below put the effects upright.

## Files (published to `apps/client/public/models/hunters/`)

| File | What | Triangles LOD0 / LOD1 / LOD2 | Size |
| --- | --- | --- | --- |
| `hunter_rifleman.glb` | Rifleman: camo jacket, blaze-orange vest and cap, scoped hunting rifle | 3,536 / 2,220 / 1,150 | 285 KB |
| `hunter_trapper.glb` | Trapper: heavy brown camo coat, blaze trapper hat with fur flaps, pack with a rolled net and rope, pump shotgun | 3,960 / 2,652 / 1,378 | 327 KB |
| `hunter_decoy.glb` | Decoy thrower: waders over a camo shirt, camo bucket hat with a blaze band, round glasses, duck call on a cord, bag of wooden decoys, light single-shot gun | 3,964 / 2,694 / 1,486 | 338 KB |
| `hunter_boss.glb` | Big Hunter: long leather coat, felt hat with a blaze band and a big yellow feather, ginger beard, red nose, blaze bandolier with shells, whistle on a lanyard, double barrel | 3,978 / 2,666 / 1,420 | 305 KB |
| `hunter_beater.glb` | Minion "Beater": a lanky villager in a blue smock with a rope belt and a patched knee, a cooking pot for a helmet, an oversized wooden spoon | 1,976 / 1,138 / 930 | 167 KB |
| `hunter_recruit.glb` | Minion "Recruit": a kid-sized hunter (`Root` scale 0.72) in a too-big camo jacket and boots, an oversized blaze cap over the brows, a butterfly net | 1,976 / 1,166 / 1,004 | 192 KB |
| `hunter_anims.glb` | Armature only, every hunter clip (below) | | 359 KB |
| `dog.glb` | Hunting dog (retriever, blaze vest), its own skeleton, LODs and clips embedded | 1,884 / 1,164 / 574 | 257 KB |
| `decoy.glb` | Wooden decoy duck: root `Decoy`, children `LOD0`, `LOD1` | 672 / 284 | 32 KB |
| `trap.glb` | Net trap: root `Trap`, children `Open` and `Sprung` | 564 (Open) / 696 (Sprung) | 47 KB |
| `hunter_fx.glb` | Defeat effects: `Stars` (dizzy ring), `Poof` (dust ring) | 200 / 432 | 25 KB |
| `hunters.json` | This contract as data: heights, hitboxes, clips, events, speeds, attach poses, LOD distances (minions carry `"minion": true`) | | 11 KB |

All GLBs are uncompressed glTF 2.0, one material, the 256 px palette texture embedded. Local copies, `stats.json` (every count and the IK reach error per clip), the palette and `hunters.blend` are in `export/`.

## Axes, scale, materials

- glTF axes like the duck GLBs: Y up, meters, every character faces +Z, feet at y = 0, rest pose is a T-pose. The game turns the model to face the sim's -Z exactly like the ducks.
- The recruit does the same at **0.72** (1.32 m to the cap). Every number in `hunters.json` for the boss and the recruit (heights, hitboxes, `muzzleAim`) already includes its scale.
- The boss uses the same skeleton and the same clips: its `Root` joint node carries a uniform scale of **1.24** in the file. Do not overwrite `Root.scale` (no clip animates `Root`). Scaling the boss's outer object instead is fine too, but then reset `Root.scale` to 1 or the two multiply.
- One material, `Hunter` (`Hunter_LOD0..2` meshes all use it): palette texture with nearest filtering. Apply the duck toon recipe: two bands with shadow tint `#d9a6a0`, a 7.5 mm inverted-hull outline in `#151619` along the smoothed normals (every part is smooth shaded, so the hull does not crack). The top half of the texture is 16 px flat cells; the bottom half holds two camo tiles (green woodland, brown) projected onto the clothes in world space at bind.
- Colors: camo greens and browns with blaze orange (`#ff6a13`) accents so hunters contrast with the yellow ducks. Brand yellow `#ffd43b` appears only on the boss feather, the dog vest stripe and the stars.

## Nodes and bones (every hunter file, and `hunter_anims.glb`)

The armature node is `HunterRig`; its child `Root` is the skeleton root. 33 joints, identical names, order and bind pose in all six hunter files, the minions included (checked by `validate.py`), except the static `Muzzle` point, which sits at each gun's own barrel tip (a minion's item end).

```
HunterRig
└─ Root                          ground origin (boss: scale 1.24)
   ├─ Hips ─ Spine ─ Spine1 ─ Spine2 ─ Neck ─ Head ─┬─ HeadTop     name tag / health bar point (static)
   │   │                         │                  └─ Hat         the hat; only Defeat and Defeat_Dizzy move it
   │   │                         ├─ Whistle                         the boss whistle; only Whistle moves it
   │   │                         ├─ LeftShoulder ─ LeftArm ─ LeftForeArm ─ LeftHand ─┬─ LeftHandFingers
   │   │                         │                                                    └─ LeftHandProp   hidden (scale 0), the held decoy
   │   │                         └─ RightShoulder ─ RightArm ─ RightForeArm ─ RightHand ─┬─ RightHandFingers
   │   │                                                                                 └─ WeaponSocket ─ Muzzle
   │   ├─ LeftUpLeg ─ LeftLeg ─ LeftFoot ─ LeftToeBase
   │   └─ RightUpLeg ─ RightLeg ─ RightFoot ─ RightToeBase
   ├─ FxStars                    hidden (scale 0): the dizzy stars ring
   └─ FxPoof                     hidden (scale 0): the dust poof
LOD0, LOD1, LOD2                 skinned meshes on the one skin
```

- **Weapon.** The gun is part of each hunter's mesh, rigid on `WeaponSocket` (the right fist). Tracers and muzzle flashes start at the `Muzzle` node; it never animates, so read its world position each shot. In `WeaponSocket` space (x right, y barrel, z top) the muzzle is at: rifleman `(0, 0.775, 0.066)`, trapper `(0, 0.68, 0.076)`, decoy thrower `(0, 0.53, 0.062)`, boss `(0, 0.835, 0.068)` (before the boss scale).
- **Left hand.** `LeftHand` is baked onto each gun's forend (0.30 m in front of the right fist) in every clip that holds the gun with both hands, so no IK is needed.
- **Head top.** `HeadTop` is 1.97 m above the feet standing (boss 2.45 m), above every hat crown; it follows the head.
- **Hidden joints.** `FxStars`, `FxPoof` and `LeftHandProp` have node scale 0 in every file. The clips that use them scale them up and back; once those clips stop, three's mixer restores the node's own scale 0 (checked by the load test). Never play a clip set where they would stay visible by accident: the rule is simply "always play clips, never leave the skeleton in its raw T-pose".

## Attaching the effects and the held decoy

The models do not contain the stars, the poof or the held decoy; add them once per hunter, as children of the joints that carry them, with these poses (also in `hunters.json` `attach`):

| Child | Joint | Position | Quaternion `[x, y, z, w]` |
| --- | --- | --- | --- |
| `hunter_fx.glb` `Stars` | `FxStars` | `[0, 0, 0]` | `[0, 0, 0, 1]` |
| `hunter_fx.glb` `Poof` | `FxPoof` | `[0, 0, 0]` | `[0, 0, 0, 1]` |
| `decoy.glb` `Decoy` (LOD1 is plenty in a hand) | `LeftHandProp` | `[0, 0, -0.055]` | `[0.5, 0.5, 0.5, 0.5]` |
| Dog: `Stars`, `Poof` | dog `FxStars`, `FxPoof` | `[0, 0, 0]` | `[0, 0, 0, 1]` |

```js
const pose = manifest.attach.hunter.Stars;
const joint = hunter.getObjectByName(pose.node);
joint.add(stars);                        // a clone of hunter_fx.glb's Stars node
stars.position.fromArray(pose.position);
stars.quaternion.fromArray(pose.quaternion);
```

Because the joints are at scale 0 until a clip scales them up, the attached meshes are invisible the rest of the time with no extra code. Give them the same toon material (no outline needed for the poof).

## Clips (`hunter_anims.glb`, 30 fps)

Every clip plays directly on all six hunter looks by joint name. No root motion: the engine moves the hunter; `Hips` only bobs, sways and turns. Looping clips close exactly (first key = last key; `Defeat_Dizzy`'s stars ring spins by 144 degrees per loop, which looks the same because the ring has five-fold symmetry).

| Clip | Seconds | Loop | Layer | Notes |
| --- | --- | --- | --- | --- |
| `Idle` | 2.4 | yes | full | Gun at low ready across the body, breathing, weight shift, looks around |
| `Walk` | 0.8 | yes | full | Authored for **1.4 m/s** (`timeScale = speed / 1.4`), gun carried |
| `Run` | 0.6 | yes | full | Authored for **3.6 m/s**, gun carried higher |
| `Aim` | 2.0 | yes | upper | Rifle shouldered at eye level, the torso turned so the left shoulder leads, breathing |
| `Aim_Up` | 2.0 | yes | upper | The same aim pitched 40 degrees up (hands stay on the gun) |
| `Aim_Down` | 2.0 | yes | upper | The same aim pitched 40 degrees down |
| `Fire` | 0.3 | no | upper | Recoil kick from the level aim, back to the aim |
| `Reload` | 1.8 | no | upper | Gun tips up to the chest, left hand fetches a shell from the right hip pouch, loads it, back to the aim. Events: `shellIn` 1.0 s, `ready` 1.45 s |
| `Throw` | 1.2 | no | upper | Gun one-handed low; the left hand pulls a decoy from the hip bag and lobs it overhand. Events: `pick` 0.25 s (the held decoy appears), `release` 0.70 s (it disappears: spawn the thrown `decoy.glb` at `LeftHandProp`'s world position and give it the velocity) |
| `Hit` | 0.4 | no | full | Flinch back, head snaps, feet planted |
| `Defeat` | 2.0 | no | full | Toony, no gore: a jolt, the hat pops off and flips through the air (lands in front at about 0.9 s), a stiff plank fall onto the back (`ground` 0.62 s) with a dust poof, legs kick up, dizzy stars from 0.95 s. Hold the last frame (`LoopOnce` + `clampWhenFinished`) or go on to `Defeat_Dizzy` |
| `Defeat_Dizzy` | 1.2 | yes | full | Lying on the back, stars circling, a foot twitch; the hat stays where it landed |
| `Taunt` | 1.8 | no | full | Shakes the gun overhead with a belly laugh; starts and ends in the `Idle` carry |
| `Whistle` | 1.6 | no | full | Call reinforcements (boss): the whistle comes up to the mouth on its lanyard, two toots (events `toot1` 0.55 s, `toot2` 0.95 s), the gun waves the others in. Works on every look; only the boss has a whistle mesh |
| `Charge` | 0.533 | yes | full | The minions' clumsy all-out run, authored for **4.2 m/s**: high knees, a big bob and waddle, leaning in, the item raised overhead in both hands (bat grip) |
| `Bonk` | 0.7 | no | full | The minion attack: the item goes up overhead, then smashes down in front; event `hit` 0.38 s, when the `Muzzle` point (spoon bowl, net hoop) is about 0.85 m ahead at a duck's chest height (beater: 0.61 m up, 0.88 m ahead). A wobble, back to the carry by 0.7 s |
| `Stagger` | 0.5 | no | full | Hit-stop knockback for the duck's slashes: rocked back on the heels, head thrown back, one step back to catch the balance, recovered by 0.5 s. In place: the engine moves the hunter back |
| `Launched` | 1.1 | no | full | Thrown by the quack shockwave: blasted up (the hips rise about 0.8 m by 0.35 s) and over in a full backward flip, limbs flailing, dropped flat on the back (event `ground` 0.78 s, a bounce). Ends in `Defeat_Dizzy`'s lying pose, so it chains into `Get_Up` (survived) or `Defeat_Dizzy` (out). In place: the engine adds the knockback travel. The hat stays on |
| `Get_Up` | 0.9 | no | full | From the lying pose back onto the feet: sit up, hop up, a dazed head shake, ending in `Idle`'s first pose |

The five melee-wave clips play on every look (a rifleman can be staggered and launched too); they were made for the minions. `Defeat` pops the beater's pot and the recruit's cap like any hat.

- **Tracks.** Full clips carry rotation tracks for every body joint plus a `Hips` translation. Upper clips carry rotations only for `Spine` and everything below it (arms, neck, head, fingers), so they layer over `Idle`, `Walk` or `Run` by replacing those joints. The special joints have tracks only in the clips that move them: `Hat` (translation, rotation) in `Defeat`/`Defeat_Dizzy`, `FxStars` and `FxPoof` (translation, rotation, scale) in the defeats, `LeftHandProp` (scale) in `Throw`, `Whistle` (translation, rotation) in `Whistle`. `Root`, `HeadTop`, `WeaponSocket` and `Muzzle` are never animated.
- **Non-looping clips** need `action.setLoop(THREE.LoopOnce, 1)` and `clampWhenFinished = true` (three's default loop would wrap `Defeat` back to its first frame).
- **Aim pitch.** Either blend `Aim_Down`, `Aim` and `Aim_Up` by the pitch (weights over -40..0..+40 degrees), or play `Aim` and add the pitch after `mixer.update()`: premultiply `Spine1` (or split across `Spine1` and `Spine2`) by a rotation about the model's X axis expressed in the joint's parent space; a negative angle raises the muzzle (measured in three: -0.3 rad on `Spine2` raises it 0.29 m with no sideways drift). A plain local `rotateX(+a)` on `Spine1`/`Spine2` also pitches (down for +a) but drifts about 1 cm sideways because of the aim twist. The whole upper body including both hands and the gun moves together, so the hands stay on the gun.
- **Fire while pitched.** `Fire` is authored over the level `Aim`; to keep the pitch, play it as an additive clip: `THREE.AnimationUtils.makeClipAdditive(fireClip.clone(), 0, aimClip)`.
- The boss plays the same clips; under the `Root` scale everything, the hat flight and the stars included, scales with it.

## Heights and hitboxes (measured from the posed LOD0 mesh, `hunters.json` `hunters.<id>.hitbox`)

Head sphere (center height `headY`, radius `headR`, forward offset `headZ`) plus a vertical body capsule (segment `bodyLo..bodyHi`, radius `bodyR`), like the duck's `hitbox.ts`. The body capsule covers the torso, coat and pelvis from the ground up; the arms and the gun stay outside, like the duck's wings. The `aim` pose was measured with the clip's own stance (hips 4 cm lower than the bind pose), `run` mid-stride.

| Hunter | Pose | headY | headR | headZ | bodyLo | bodyHi | bodyR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Rifleman, decoy thrower | stand | 1.55 | 0.185 | 0.01 | 0.23 | 1.31 | 0.23 |
| | aim | 1.53 | 0.185 | 0.05 | 0.23 | 1.29 | 0.23 |
| | run | 1.45 | 0.185 | 0.11 | 0.24 | 1.20 | 0.24 |
| Trapper (heavier coat) | stand | 1.55 | 0.185 | 0.01 | 0.25 | 1.31 | 0.25 |
| | aim | 1.53 | 0.185 | 0.05 | 0.25 | 1.29 | 0.25 |
| | run | 1.45 | 0.185 | 0.11 | 0.26 | 1.20 | 0.26 |
| Big Hunter (scale 1.24) | stand | 1.92 | 0.23 | 0.01 | 0.36 | 1.60 | 0.36 |
| | aim | 1.90 | 0.23 | 0.06 | 0.36 | 1.58 | 0.36 |
| | run | 1.79 | 0.23 | 0.13 | 0.36 | 1.46 | 0.36 |

A single table for the three regular hunters (the trapper's numbers) is a safe simplification. Heights to the top of the hat: rifleman 1.80 m, trapper 1.81 m, decoy thrower 1.80 m (skulls 1.74 m); Big Hunter 2.40 m to the hat crown and 2.52 m to the feather tip (skull 2.16 m). The classic duck is 1.79 m to its tuft. Standing footprint about 0.75 x 1.1 m (the gun out front); the boss about 0.97 x 1.6 m.

## Minions (`hunter_beater.glb`, `hunter_recruit.glb`)

Cheap horde enemies that read as weak at a glance: no guns, kitchen and garden gear, silly hats. Same joints, order and bind pose as every hunter (so `hunter_anims.glb` drives them unchanged), same material and palette, same LOD nodes and distances.

- **Budget.** Under 2,000 triangles at LOD0 (`validate.py` checks it): 1,976 each. Their LOD0, LOD1 and LOD2 are built from the hunter detail levels 1, 2 and a third, cheaper level (level 2 without ears, brows, mouth and with coarser rings).
- **The item** is part of the mesh, rigid on `WeaponSocket`, held with the same two-handed hold as a gun (the handle passes under the left fist at the forend spot), so every clip holds it. `Muzzle` sits at the item's working end, the bonk's contact point: spoon bowl `(0, 0.585, 0.012)`, net hoop `(0, 0.80, 0)` in `WeaponSocket` space (recruit before its scale). Do not draw tracers from it.
- **Hitboxes** (`hunters.json`, scale included), standing: beater head `headY` 1.55 `headR` 0.185, body capsule 0.195 to 1.31 radius 0.195 (a narrow chest); recruit head 1.12 radius 0.133, body 0.185 to 0.92 radius 0.185. `aim` and `run` poses are measured as for the others.
- **Heights.** Beater 1.81 m to the pot (skull 1.74 m), recruit 1.32 m to the cap (skull 1.25 m); the classic duck is 1.79 m.

## LODs

`LOD0`, `LOD1`, `LOD2` are skinned meshes on the one skin (one skeleton update for all three). Show exactly one: `LOD0` up to 18 m, `LOD1` up to 40 m, `LOD2` beyond (desktop distances; about 0.6x on phones). LODs are modeled, not decimated: fewer ring segments, and small details drop out (eye catchlights at LOD1; the mouth, the thumbs, collars, boot soles, the scope and small gun parts at LOD2; the decoy heads in the bag down to one). Budgets: under 4,000 triangles at LOD0 and under 1,500 at LOD2 (checked by `validate.py`).

## The dog (`dog.glb`)

- About 1.0 m to the head top, 1.37 m nose to tail tip, faces +Z. Nodes `DogRig` (armature), `LOD0..2` (skinned; 1,884 / 1,164 / 574 triangles, same distances as the hunters).
- Joints: `Root`, `Hips`, `Spine`, `Chest`, `Neck`, `Head`, `Jaw`, `HeadTop`, `Left/RightEar`, `Tail`, `Tail1`, `Left/RightFrontLeg`, `FrontShin`, `FrontPaw`, `Left/RightBackLeg`, `BackShin`, `BackPaw`, plus hidden `FxStars` and `FxPoof` (scale 0, attach the same `Stars` and `Poof`).
- Clips (embedded, 30 fps): `Idle` 2.0 s loop (panting, tail wag), `Run` 0.4 s loop (gallop, authored for **4.5 m/s**), `Bite` 0.6 s (crouch, lunge, the jaw snaps shut at the `bite` event 0.32 s), `Hit` 0.367 s (a yelp flinch), `Defeat` 1.5 s (hops, rolls belly up with the legs in the air and the tongue out, poof at `ground` 0.55 s, stars from 0.85 s; hold the last frame), `Defeat_Dizzy` 1.2 s loop.
- Hitbox (`hunters.json` `dog.hitbox`): head sphere at height 0.90 m, 0.48 m forward, radius 0.16; body as a horizontal capsule along the facing axis at height 0.63 m from z = -0.35 to z = +0.24 (local, forward +Z), radius 0.195. If the hit code only knows vertical capsules, three spheres of radius 0.2 along that segment are a fine stand-in.

## Props

- `decoy.glb`: a painted wooden mallard decoy, 0.38 m long, origin at its middle (spin it about here when thrown), facing +Z. `LOD0` up to 15 m, `LOD1` beyond (to 80 m, then cull).
- `trap.glb`: origin at the center on the ground, radius 0.66 m. `Open` is the set trap (a framed net disc, four stakes, a blaze warning flag); swap to `Sprung` (the net pulled up into a 1.9 m dome with a rope knot, 2.15 m with the rope tail) when it catches a duck. Nothing is animated: the gameplay code can scale `Sprung` up from 0 for the snap.
- `hunter_fx.glb`: `Stars` (five chunky stars on a 0.25 m ring, flat) and `Poof` (a 0.45 m ring of dust puffs on the ground). See the attach table.

## Scripts

| File | Role |
| --- | --- |
| `blender/hp.py` | Proportions, skeleton anchors, palette, camo colors, LOD distances, the boss scale |
| `blender/mesh.py` | Mesh toolkit on top of the duck's `art/blender/geo.py`: parts with skin-weight rules, camo UVs, chamfered boxes, stars, the palette image |
| `blender/human.py` | The base body: head and face, torso, arms with mitten gloves, legs, boots |
| `blender/looks.py` | The four looks (clothes, hats, faces, gear) and the four guns |
| `blender/hrig.py` | The shared skeleton and its skin-weight rules |
| `blender/hpose.py` | The pose engine (character-axis rotations, analytic two-bone IK, world overrides for the hat and effects) |
| `blender/hclips.py` | Every hunter clip as code, events and authored speeds |
| `blender/dog.py` | The dog: skeleton, mesh, weights, clips, export, hitbox |
| `blender/props.py` | Decoy, trap, stars and poof |
| `blender/hbake.py` | Baking, glTF export, GLB post-processing (track pruning, hidden nodes, the boss scale), attach poses |
| `blender/measure.py` | Hitboxes and heights from the posed meshes, the `hunters.json` manifest |
| `blender/assemble.py` | Builds every look at every LOD on its own armature |
| `blender/hrender.py` | Review renders (toon look from `art/blender/render.py`) |
| `blender/build_hunters.py` | Entry point |
| `validate.py` | Contract check (plain Python) |
| `tools/load_test.mjs` | Headless three.js load and playback check |

## Review renders (`renders/`, WebP)

`lineup_with_duck.webp` (every hunter, the dog and the classic duck with measured heights), `minions_lineup.webp` (the two minions next to the classic duck and a rifleman, with heights and LOD0 triangle counts) and `minions_lineup_back.webp` (the duck from behind as the game camera sees it, the minions and the rifleman facing it), `beater_turnaround.webp`, `recruit_turnaround.webp`, `lineup_elevated.webp`, `<id>_turnaround.webp` (front, three-quarter, side, back), `lod_sheet.webp`, `dog_turnaround.webp`, `props_sheet.webp`, `defeat_frames.webp` (rifleman and boss defeats, eight moments each), `anim_contact_sheet.webp` (every clip, eight frames each) and one strip per clip in `anim/`.

## Known weak spots

- Clips are procedural (sine cycles, eased keys, IK): clean and consistent, without the small irregularities of hand keying.
- IK reach: in `Bonk` the left hand falls 0.5 cm short and in `Stagger` 0.7 cm; in `Throw` the left hand falls up to 7 cm short of its path at full stretch, the dog's paws slide up to 5 cm in `Run` and 6.5 cm in the `Bite` lunge, and `Aim_Up` misses the forend by 1.4 cm. All other clips reach exactly (`export/stats.json` `ik_reach_error_m`).
- `Defeat` is FK: the feet slide a little as the hunter tips over. The hat lands where the flight ends, not on the real ground: on a slope it can float or sink a few centimeters.
- In `Idle`/`Walk`/`Run` the gun is carried at low ready pointing forward, so from straight ahead it is foreshortened.
- The camo is a 128 px tile with nearest filtering: up close its blotch edges are pixel steps (a deliberate chunky "digital camo" look).
- LOD switches are hard cuts.
- `Launched` and `Get_Up` are FK where the body is off its feet: the feet slide a little as the minion lands and as it gets up.
- The recruit is a scaled adult rig (`Root` 0.72) with a kid's clothes: his limbs keep adult proportions.
