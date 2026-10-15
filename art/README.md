# Qwakk duck art

The hero duck for the Qwakk battle royale, built entirely by Python scripts driving Blender. No third-party models, no hand sculpting: every shape, bone and weight comes from `blender/`.

## Rebuild everything (one command)

```sh
sh qwakk-game/art/build.sh
```

This needs Blender 5.2 at `/Applications/Blender.app` (`brew install --cask blender`), or set `BLENDER=/path/to/blender`. The turnaround sheet also needs `ffmpeg` on the PATH (`brew install ffmpeg`). A full build with all renders takes about 5 seconds on an M4 Pro.

Options: `--no-render` (mesh, rig and exports only), `--quick` (fewer render samples), `--only NAME` (only render shots whose name contains NAME: `turnaround`, `face`, `size`, `pose`, `beanie`).

## Outputs

| Path | What |
| --- | --- |
| `export/duck.glb` | Skinned duck, T-pose rest, palette texture embedded. Copied to `apps/client/public/models/duck.glb` |
| `export/acc_beanie.glb` | Doomer beanie, rigid head-slot cosmetic, in model space |
| `export/palette.png` | 256 px palette, 16 px cells (layout in `blender/params.py`) |
| `export/stats.json` | Triangle, vertex, bone counts and file sizes from the last build |
| `export/duck.blend` | The built scene, for inspection in the Blender UI |
| `renders/` | Turnaround (front, 3/4, side, back plus a sheet), face close-up, quack, size check, arms-up and run poses, beanie |

## Scripts

| File | Role |
| --- | --- |
| `blender/params.py` | All proportions, colors and look constants. Change shapes here |
| `blender/geo.py` | Ring-stack mesh toolkit: lathe, swept tube with rounded caps, ellipsoid, palette UVs |
| `blender/duck.py` | Builds every duck part and the beanie |
| `blender/rig.py` | Skeleton, skin weights, pose helpers and the test poses |
| `blender/render.py` | Toon material, inverted-hull outline, cameras |
| `blender/build_all.py` | Entry point: build, skin, export, render |

## Design notes

- **Brand match.** Duck yellow `#ffd43b`, beak orange `#ff8a3d`, brand dark `#151619` for the pupils and the outline. The round head and the huge dark eyes with a light catchlight echo the ring Q and dot eye of the brand mark. The tuft curl on top is the mark's curl, plus a smaller second feather.
- **Shapes.** Vinyl-toy proportions: a big squashed-ball head sitting straight on a pear body, a lighter belly oval, a plump upturned tail, chunky wing arms with three trailing feathers, a wing-hand with a thumb and two feathered fingers, yellow feather thighs ending in a rounded knee roll, orange shins and wide webbed feet.
- **Bill.** A wide upper bill with a slight smile, a smaller lower bill on its own `Jaw` bone, and a dark mouth that is half weighted to the jaw so it stretches open when the duck quacks.
- **Construction.** Every part is a closed stack of rings (quads, with triangle fans only at poles). Parts overlap instead of being welded, like a toy built from pieces. This keeps the topology clean, the silhouette smooth and the skin weights predictable. Limbs start with a ball centered on their joint, so a rotating limb never opens a gap at the shoulder or hip.
- **One material.** A single material with the 256 px palette texture and flat colors. A skin can be a different palette image with the same cell layout.
- **Toon look (renders, and the recipe for the game shader).** Two bands: `dot(normal, light)` above a threshold shows the base color, below it shows the base color multiplied by `TOON_SHADOW_TINT`. The outline is an inverted hull: the mesh pushed out along its normals by `OUTLINE_WIDTH` (7.5 mm), faces flipped, back faces culled, drawn in `#151619`. The `outline` vertex group in the .blend sets the width per vertex (0 for catchlights, blush, belly and mouth); it is not exported to the GLB.

## Budgets hit (from the last build)

| Item | Budget | Result |
| --- | --- | --- |
| Duck LOD0 | 6k to 10k triangles | 9,968 triangles, 5,058 vertices |
| Beanie | small rigid prop | 1,152 triangles |
| Bones | 50 to 65 | 41 deform bones (42 with `HeadTop_End`) |
| Weights | 4 per vertex | max 4 bones per vertex |
| Texture | 256 palette | one 256 px PNG, 1.3 KB |
| File size | under 1 MB per duck | `duck.glb` 346 KB uncompressed, no meshopt or Draco |
| Height | | 1.79 m to the tuft tip, 1.62 m to the top of the head |

## Rig

- Mixamo bone names without the `mixamorig:` prefix: `Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, `Left/RightShoulder`, `Arm`, `ForeArm`, `Hand`, `Left/RightHandThumb1-3`, `HandIndex1-3`, `HandMiddle1-3`, `Left/RightUpLeg`, `Leg`, `Foot`, `ToeBase`, plus `Jaw` (child of `Head`). The duck has three fingers, so Mixamo ring and pinky tracks have nothing to drive and are dropped.
- Rest pose is a T-pose, facing +Z after export (Blender -Y). Bone rolls are our own, not Mixamo's, so retarget with a rest-pose aware retargeter (three.js `SkeletonUtils.retargetClip`, or Blender with a rest-pose bake) rather than copying local rotations one to one.
- Weights: the torso uses Blender automatic weights (bone heat), run on the torso shell alone against the torso bones. On the whole joined mesh bone heat fails, because the separate head and limb shells hide the bones from most torso vertices. Every other part gets procedural weights: rigid on its bone for the head, bill, eyes and tail, and smooth blends along the bone chain for arms, fingers, legs and feet.

## Using the beanie in the engine

`acc_beanie.glb` is in model space at the rest pose. Load it, put the duck skeleton in its rest pose (`skinnedMesh.skeleton.pose()`), then `headBone.attach(beanie)` so it keeps its world placement and follows the `Head` bone from then on.

## Known weak spots

- The thighs read a little like shorts from the front and back.
- Hands are readable but small; gun grips will need a tuned grip pose and probably hand IK.
- Low ring counts show as small facets on the toon terminator in close-ups (fine at gameplay distance).
- The bill and eyes are separate shells on the head, so a very tight close-up from the side can show an eye edge past the head outline.
- The back of the head is a big plain yellow area.
