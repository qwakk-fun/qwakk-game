# Qwakk duck art

The hero duck, its weapons and its animations for the Qwakk battle royale, built entirely by Python scripts driving Blender. No third-party models or clips, no hand sculpting or keying in the UI: every shape, bone, weight and keyframe comes from `blender/` (see `LICENSES.md`).

## Rebuild everything (one command)

```sh
sh qwakk-game/art/build.sh
```

This needs Blender 5.2 at `/Applications/Blender.app` (`brew install --cask blender`), or set `BLENDER=/path/to/blender`. The turnaround sheet, the clip strips and the MP4/GIF previews also need `ffmpeg` on the PATH (`brew install ffmpeg`); without it those images are skipped. A full build with every render and preview takes about 2.5 minutes on an M4 Pro; `--no-render` takes about 3 seconds.

Options:

- `--no-render`: mesh, rig, weapons, clips and exports only.
- `--quick`: fewer render samples, and no MP4/GIF previews.
- `--no-anim`: skip baking the clips (fast mesh iteration; leaves the old `duck_anims.glb` in place).
- `--only NAME`: render only shots whose name contains NAME: `turnaround`, `face`, `size`, `pose`, `beanie`, `weapon`, `hold`, `anim`, or a single clip such as `anim:Run_F` (repeatable).

Check the published files against the asset contract (plain Python, no Blender):

```sh
python3 qwakk-game/art/blender/validate_glb.py
```

## Published to the client (the asset contract)

| Path under `apps/client/public/models/` | What |
| --- | --- |
| `duck.glb` | Skinned duck, T-pose rest, facing +Z, meters, palette texture embedded |
| `duck_anims.glb` | Armature only, same bone names, all clips below |
| `weapons/rifle.glb`, `weapons/pistol.glb` | Weapons, origin at the right-hand grip, barrel +Z, with child nodes `Muzzle`, `Grip`, `Support`, `Eject` |
| `weapons/attach.json` | Weapon pose in `RightHand` joint space: `{ rifle: {position, quaternion}, pistol: {...} }` |

Nothing else under `models/` is written by this build (`models/props/` belongs to the map workstream).

Local outputs in `art/`: `export/` (the same GLBs, `acc_beanie.glb`, `palette.png`, `stats.json` with all counts and per-clip data, `duck.blend`), `renders/` (stills) and `renders/anim/` (one 8-frame strip per clip, MP4 and GIF previews of the key clips).

## Scripts

| File | Role |
| --- | --- |
| `blender/params.py` | All proportions, colors and look constants. Change shapes here |
| `blender/geo.py` | Ring-stack mesh toolkit: lathe, swept tube with rounded caps, ellipsoid, palette UVs |
| `blender/duck.py` | Builds every duck part and the beanie |
| `blender/rig.py` | Skeleton, skin weights, still poses |
| `blender/weapons.py` | Rifle and pistol from beveled boxes and cylinders, plus their empties |
| `blender/holds.py` | The fist grip frame, weapon attach math, support hand placement |
| `blender/posing.py` | Pose engine: rotations in character axes, analytic two-bone IK for feet and hands |
| `blender/clips.py` | Every clip as code (gait cycles, idles, jumps, deaths, weapon handling, quack) |
| `blender/bake.py` | Bakes clips into actions, exports and prunes `duck_anims.glb`, computes `attach.json` |
| `blender/render.py`, `blender/previews.py` | Toon renders, clip strips, MP4/GIF previews |
| `blender/build_all.py` | Entry point |
| `blender/validate_glb.py` | Contract check of the published GLBs |

## Skeleton

- Mixamo bone names without the `mixamorig:` prefix: `Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, `Left/RightShoulder`, `Arm`, `ForeArm`, `Hand`, `Left/RightHandThumb1-3`, `HandIndex1-3`, `HandMiddle1-3`, `Left/RightUpLeg`, `Leg`, `Foot`, `ToeBase`, plus two extras: `Jaw` (child of `Head`, opens the bill) and `Tail` (child of `Hips`, tail wiggle). 42 deform joints in the GLB.
- Rest pose is a T-pose, facing +Z after export (Blender -Y). Bone rolls are our own, so third-party clips need a rest-pose aware retargeter (three.js `SkeletonUtils.retargetClip`). Our own clips in `duck_anims.glb` play directly on `duck.glb` by bone name.
- Weights: the torso uses Blender automatic weights (bone heat) run on the torso shell alone against the torso bones. Every other part gets procedural weights: rigid on its bone for the head, bill, eyes and tail, and smooth blends along the chain for arms, fingers, legs and feet.

## Animation clips

All clips are baked at 30 fps. Looping clips have an identical first and last key. No root motion: the engine moves the capsule; `Hips` only bobs, sways and turns in place.

| Clip | Seconds | Loop | Layer | Notes |
| --- | --- | --- | --- | --- |
| `Idle` | 3.0 | yes | full | Breathing, weight shift, look around, a quick tail wag |
| `Walk_F/B/L/R` | 0.4 | yes | full | Authored for 2.6 m/s. Strafes are a side gallop so the feet never cross |
| `Run_F/B/L/R` | 0.367 | yes | full | Authored for 5.2 m/s, waddle roll, wing swing, tail wiggle |
| `Sprint` | 0.333 | yes | full | Authored for 7.0 m/s, wings swept back and fluttering, bill open |
| `Crouch_Idle` | 2.0 | yes | full | Squat, hips 0.30 m lower |
| `Crouch_Walk` | 0.467 | yes | full | Authored for 2.3 m/s |
| `Jump_Start` | 0.3 | no | full | Squash, then spring onto the toes, wings up |
| `Fall_Loop` | 0.533 | yes | full | Wings flapping, legs dangling, tail up |
| `Land` | 0.4 | no | full | Impact squash with overshoot |
| `Death_A` | 1.4 | no | full | Knocked onto the back, feet up, a last kick. Hold the last frame |
| `Death_B` | 1.333 | no | full | Face-plant, tail twitch. Hold the last frame |
| `Hit_React` | 0.4 | no | full | Head snaps back, wings flail, feet stay planted |
| `Rifle_Aim` | 2.0 | yes | upper | Rifle at the right hip, left hand on the magwell, breathing |
| `Pistol_Aim` | 2.0 | yes | upper | Two-handed pistol at the chest, breathing |
| `Rifle_Reload` | 1.8 | no | upper | Rifle tilts in, left hand pulls the mag down and slaps it back |
| `Pistol_Reload` | 1.4 | no | upper | Pistol tips up, fresh mag, slide rack |
| `Rifle_Fire` | 0.2 | no | upper | Short kick back and up |
| `Pistol_Fire` | 0.2 | no | upper | Wrist flick |
| `Equip` | 0.6 | no | upper | Rifle swings up from a low ready into the aim, with a settle |
| `Quack` | 1.0 | no | full | Two quacks on the `Jaw`, head tilt, wings, tail wag |

- **Speed matching.** Feet are placed by IK on a gait cycle whose stride equals the authored speed, so they stay planted when the duck moves at that speed (the previews scroll a checker floor to prove it). When the actual speed differs (accelerating, diagonal blends), set `timeScale = speed / authoredSpeed`. At stride ends the legs can run out of reach by up to 3 cm going forward and up to 6 cm in strafes, a small slip.
- **Tracks.** Full-body clips carry rotation tracks for every joint plus a `Hips` translation track. Upper-body clips carry rotation tracks only for `Spine` and everything below it in the hierarchy (arms, neck, head, jaw, fingers), so they can be layered over any locomotion clip by replacing those bones. There are no scale tracks and no other translation tracks; bones keep their bind positions.
- **Weapon layering.** Aim, reload, fire and equip clips assume the weapon rides on `RightHand` with `attach.json`. Because the left hand is baked into the clip, it stays on the gun as long as the upper-body layer is applied as a whole. The engine can add procedural aim pitch on `Spine1`/`Spine2` and recoil on top.

## Weapons

| | Rifle (toy carbine) | Pistol |
| --- | --- | --- |
| Triangles | 1,892 | 1,124 |
| GLB | 45.8 KB | 28.4 KB |
| Length | 0.70 m | 0.21 m |

- Built from beveled boxes and cylinders with hardened normals, sharing the duck's palette texture (gunmetal greys plus brand yellow magazine and orange handguard, grip and butt pad). No logos.
- The rifle is a compact carbine on purpose: the duck's short wings must reach around its round belly. The left hand holds the magwell, which is where `Support` sits.
- Empties (glTF nodes, children of the weapon node, identity rotation so +Z is forward): `Muzzle` at the barrel tip, `Grip` at the origin, `Support` for the left-hand IK target (rifle: magwell; pistol: left side of the grip), `Eject` on the right side of the receiver or slide.

### Attaching a weapon (three.js)

```js
const hand = duck.getObjectByName('RightHand');
const { position, quaternion } = attach.rifle;   // from weapons/attach.json
hand.add(rifle);
rifle.position.fromArray(position);
rifle.quaternion.fromArray(quaternion);          // [x, y, z, w]
```

Both weapons share one attach pose today (position `[0, 0.08, -0.07]`, quaternion `[-0.541675, 0.45452, 0.541675, 0.45452]`), because both have the grip at the origin and the same grip angle. They stay separate keys in the JSON so a future weapon can differ.

## Design notes

- **Brand match.** Duck yellow `#ffd43b`, beak orange `#ff8a3d`, brand dark `#151619` for the pupils and the outline. The round head and the huge dark eyes echo the ring Q and dot eye of the brand mark. The tuft curl on top is the mark's curl, and a raised deep-yellow spiral on the back of the head repeats that curl from behind.
- **Shapes.** Vinyl-toy proportions: a big squashed-ball head on a pear body, a lighter belly oval, a plump upturned tail, chunky wing arms with three trailing feathers, chunky wing-hands with a thumb and two feathered fingers, feather thighs ending in a knee roll with hanging feather points, orange shins and wide webbed feet.
- **Bill.** A wide upper bill with a slight smile, a smaller lower bill on the `Jaw` bone, and a dark mouth half weighted to the jaw so it stretches open on a quack.
- **Construction.** Every part is a closed stack of rings (quads, with triangle fans only at poles). Parts overlap like a toy built from pieces. Limbs start with a ball centered on their joint, so a rotating limb never opens a gap.
- **One material.** A single material with the 256 px palette texture and flat colors. A skin can be a different palette image with the same cell layout.

## Toon recipe (renders, and the spec for the game shader)

- Two bands: `dot(normal, lightDir)` above a threshold shows the base color; below it shows the base color multiplied by `#d9a6a0` (`TOON_SHADOW_TINT`).
- Outline: an inverted hull, the mesh pushed out along its normals by about 7.5 mm (`OUTLINE_WIDTH`), faces flipped, back faces culled, drawn in `#151619`. The `outline` vertex group in the .blend sets the width per vertex (0 for catchlights, blush, belly and mouth); it is not exported.
- Weapons have hard edges (split normals), so their hull should be pushed along smoothed normals, or drawn by scaling the hull slightly, to avoid cracks at corners.

## Budgets hit (from the last build)

| Item | Budget | Result |
| --- | --- | --- |
| Duck LOD0 | 6k to 10k triangles | 9,856 triangles, 5,004 vertices |
| Weapons | 1.5k to 4k triangles | rifle 1,892, pistol 1,124 (small by design) |
| Beanie | small rigid prop | 1,152 triangles |
| Bones | 50 to 65 | 42 deform joints (43 with `HeadTop_End`) |
| Weights | 4 per vertex | max 4 bones per vertex |
| Texture | 256 palette | one 256 px PNG, 1.3 KB |
| File size | under 1 MB per duck, 2 to 3 MB animations | `duck.glb` 343 KB, `duck_anims.glb` 671 KB (uncompressed) |
| Height | | 1.79 m to the tuft tip, 1.62 m to the top of the head |

## Using the beanie in the engine

`acc_beanie.glb` is in model space at the rest pose. Load it, put the duck skeleton in its rest pose (`skinnedMesh.skeleton.pose()`), then `headBone.attach(beanie)` so it keeps its world placement and follows the `Head` bone from then on.

## Known weak spots

- Clips are procedural (sine-based cycles, eased keys, IK), so they are clean and consistent but lack the small irregularities of hand-keyed or captured motion.
- The engine speeds are high for such short legs, so cadence is fast (a scurry). Feet stay planted at the authored speeds.
- Crouched, the head top sits at about 1.3 m, above the 1.15 m crouch capsule.
- The rifle hold is at the hip, not the shoulder: the big head and round belly leave no room to shoulder a stock.
- Deaths are FK only, so the feet slide a little in the first frames.
