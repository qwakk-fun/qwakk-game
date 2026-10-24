# Pond Keep (Gölet Kalesi)

The Hunt Season map (map id `pond-keep`): a storybook stone duck castle on an island in a pond. The ducks hold the QoreChain core in the courtyard; hunters come out of a ring of WWI trenches around the pond, snipe from watchtowers and hills, and cross the moat over the drawbridge or, when it is up, on raft lanes. Built by `art/map/layout/gen_pond.py` from the prop kit (castle pieces in `art/map/blender/castle.py`, pond props in `art/map/blender/props_pond.py`), everything procedural. Review renders: `art/map/renders/pond-keep/`.

## Layout

All positions are map coordinates: x east, y up, z south (north is -z), meters, the core at the origin. Every yaw in the markup is the player yaw (as `dmSpawns`): 0 looks north, a duck looks along (-sin yaw, -cos yaw). A prop's `rotY` (its GLB front, +Z, faces (sin rotY, cos rotY)) is yaw + PI.

| Part | Where |
| --- | --- |
| Terrain | 400 x 400 m, 2 m cells (201 x 201 samples). Island, berm and banks at y 1.0; the moat bed at -2.4 under the water surface at 0 (the map's sea level); the meadow rises to about 3 to 4 m at the watchtowers, hills to about 8.5 m; scenery hills past the hedge ring to 16.5 m. |
| Play area | Hedgerow ring about 150 m from the core (`playArea.ring`, 302 x 296 m, 69,600 m2), a second hedge line and woods outside it. |
| Castle | Curtain walls on center lines at x, z = +-18.5 (3 m thick, the courtyard is 34 x 34 m inside), 9 x 9 m corner towers centered on the corners, the gatehouse on the south wall (gate opening at z 23.1), the core at (0, 1, 0). |
| Heights | Courtyard 1.0, tower floors 1.15, wall walk 6.2 (5.2 over the courtyard), tower tops 10.8. Parapets: a 1.0 m sill (a standing duck shoots over it, a crouched one ducks behind it) and 2.2 m merlons, 1.4 m merlons and 1.2 m crenels. |
| Island and moat | The island is a rounded square, half size 30 m, corner radius 12 m (`raid.island`). The moat is 14 m wide (outer bank half size 44 m). The berm between the walls and the water is 10 m wide at the wall middles, 5 m at the tower corners; the gate apron is 6 m deep. |
| Crossings | The drawbridge (south, hinge at z 32.5, 8.4 m span, stone quays on both banks) and four raft lanes (east, west, north-east, north-west), each a 3 m deck of lashed log rafts at 0.45 m over the water with gangplanks to both banks and 2.4 m rope fences. |
| Moat barrier | Reed beds (`moat_reeds`, a 4.4 x 0.7 x 1.9 m `fence` collider per 4 m strip, 132 strips) on both banks, edge to edge, ending against the quay parapets (1.3 m) and the raft lane rope fences. No duck walks or jumps into the water; bullets and sight pass over the reeds. |
| Trenches | Six WWI trench lines (11 tiles of the trench kit each, zigzag with traverses toward the castle) at 70 to 78 m, centered every 60 degrees from east (the south-east and south-west ones flank the drawbridge road); a sandbagged dugout 86 m out behind each; barbed wire coils with gaps at 61 m; sandbag nests by the trench ends; shell craters. |
| Snipers | Four hunters' watchtowers (5 m platforms, plank walls, two flights of stairs, a roof) at 118 m on the diagonals, three hills with rock and sandbag nests at 126 m (east, west, north). |
| Cover | The meadow between the moat road and the trenches has low cover only (rocks, bushes, hay bales, hay carts, crates, fences, beached rafts); trees stand past 95 m, off the sight lines, so the walls see the trenches. |
| Paths | The hunters' road from the south ring to the drawbridge, a moat road around the outer bank, and a path from behind every trench segment past its end to the moat road (ground paint only). |

## The `raid` markup (`map_v1.json`)

Read by `packages/shared/src/raid/markup.ts`. Example values are the real ones.

| Field | Meaning | Value |
| --- | --- | --- |
| `core` | the core's base [x, y, z] | `[0, 1, 0]` |
| `coreRadius` | hunters stand this far from the core to hit it (the plinth's lowest step is 3.0 m) | `3.8` |
| `gate` | the gate opening: the middle of its foot, `yaw` the outward facing, its width and height | `{x: 0, y: 1, z: 23.1, yaw: -PI, width: 4, height: 4.2}` |
| `gateFront` | where hunters stand to hammer the gate (outside, on the apron) | `[0, 1, 25]` |
| `drawbridge` | the hinge (at the inner quay tip, deck top 0.12 m over it), `yaw` toward the far end, span, deck width, and the deck outline `walk` [[x, z], ...] | `{hingeX: 0, hingeY: 1, hingeZ: 32.5, yaw: -PI, length: 8.4, width: 4.4, walk: [[-2.2, 32.5], [2.2, 32.5], [2.2, 40.9], [-2.2, 40.9]]}` |
| `cannons` | four mounts [x, y, z, yaw]: the top of each tower's cannon drum (the `bread_cannon` GLB origin), yaw straight out from the core | `[21.95, 11.7, 21.95, -2.3562]` (south-east), and mirrored |
| `cannonUse` | where a duck stands to man each cannon (on the tower top, 1.6 m behind the mount) | `[20.82, 10.8, 20.82]`, ... |
| `towerTops` | a free spot on each tower top (markers, AI goals) | `[15.9, 10.8, 15.9]`, ... |
| `lever` | the drawbridge winch in the courtyard, beside the gate passage | `[-3.8, 1, 15.6]` |
| `duckSpawns` | 16 [x, y, z, yaw]: 10 around the core (y 1.1), 6 on the north, east and west wall walks (y 6.3, looking out) | `[0, 1.1, -9.5, 0]`, `[-18.35, 6.3, 5.48, 1.5708]` |
| `hunterSpawns` | 18 [x, y, z, yaw]: both ends of each trench line (just past the exit ramp) and each dugout door, facing the core | `[74, 2.05, 22.8, 1.2719]`, `[81.4, 2.5, 0, 1.5708]` |
| `sniperPerches` | 7 [x, y, z, yaw]: the 4 watchtower platforms (y about 10) and the 3 hill nests, facing the core; each sees parts of the wall walk | `[101.67, 10.15, 58.7, 1.0472]`, `[126.6, 8.62, 0, 1.5708]` |
| `raftLanes` | 4 `{name, from: [x, z], to: [x, z]}`: `from` on the outer bank past the gangplank, `to` on the berm | `{name: "East Lane", from: [45.6, 0], to: [28.4, 0]}` |
| `trenches` | 6 trench center polylines [[x, z], ...] (tile centers, 4 m apart) | `[[74, 16], [74, 12], [74, 8], ...]` |
| `wallWalk` | 6 polylines [[x, y, z], ...] along the battlements at the walk height (each curtain wall and the gatehouse top) | `[[13.7, 6.2, -18.35], [-13.7, 6.2, -18.35]]` |
| `keep` | the castle outline up to the gate line [[x, z], ...] (outer wall faces, the gatehouse to the gate) | 8 points |
| `island` | the inner bank [[x, z], ...] | 72 points |
| `props` | the animated GLBs to place in code (never in `props`): `{prop, role, x, y, z, rotY}` | drawbridge, gate, 4 bread cannons, lever |

`dmSpawns` holds the duck spawns too (a fallback for code that reads it), and `plaza` is the courtyard. `nameTr` is the Turkish name.

## Static colliders and the moving parts

The static map (props in `props`, through `colliders.json`) leaves the gate opening open and always has the drawbridge deck: the `castle_bridge` prop carries a `floor` box under the deck (top 0.12 m over the hinge) and two 1.5 m `fence` rails along its sides. What blocks or lifts while a run plays is the game's job (`raid/keep.ts` adds its own colliders after the props).

| GLB (`apps/client/public/models/props/`) | Nodes | Use |
| --- | --- | --- |
| `castle_drawbridge.glb` | `Hinge` (deck, rails); `ChainAnchorL/R` under it (the rings at the deck tip); `ChainL/R` (at the lifting frame's pulleys) | Turn `Hinge` about its local X, negative angles raise the deck (three.js: `hinge.rotation.x = -angle`). Each chain has a 1 m chain mesh along its local +Z: `chain.lookAt(anchor world position)` and `chain.scale.z = distance`. The file has them in the down pose. |
| `castle_gate.glb` | `Intact`, `Damaged`, `Broken`, `Planks` | Show one state, plus `Planks` (a nailed barricade that leaves the wicket clear) over `Damaged` or `Broken` for repairs. The leaves have an open 1.5 x 2.2 m wicket door in the middle, matching `KEEP.wicketHalf` and `wicketHeight`. The collider records in `colliders.json` carry `states` (the leaves beside and above the wicket). |
| `bread_cannon.glb` | `Yaw` > `Pitch` (0.95 m up) > `Muzzle` (1.55 m out) | `Yaw` turns about local Y, `Pitch` about local X (negative raises the muzzle), the GLB +Z is the shot. Place at `raid.cannons` with rotY = yaw + PI. |
| `bread_loaf.glb` | none | The shot: a 0.5 m loaf, origin at its bottom middle. |
| `castle_lever.glb` | `Handle` (on the drum axle, 0.9 m up) | Turn about local X; positive pulls the handle toward the gate. Place at `raid.lever`, rotY 0. |

The cannon mounts sit at the outer corner of each tower top, which is a barbette: no merlons on the outer half of the two outer sides, just the 1.0 m sill with a `fence` collider above it to 2.2 m (shots and sight pass, ducks cannot climb out). The barrel (1.85 m over the platform) reaches past the sill, so shots across the outer quarter clear the parapet level, upward, or down at the berm to about 23 degrees (`apps/server/test/pondKeep.test.ts` checks it). Turned toward the courtyard, the barrel points at merlons.

## Movement rules the map guarantees (tested)

- Walk paths (`houses.test.ts`, running and crouched): the courtyard door of every tower, flights A to D (28 to 34 degree ramp colliders under stone steps) up to the wall walk doorways and the top, onto every cannon's gunner spot; every curtain wall's courtyard stair onto the wall walk and along it; the gate passage; the gatehouse top and its grate; both quays over the deck; every raft lane both ways; every watchtower up to its platform.
- The moat (`pondKeep.test.ts`): ducks running and jumping at it from more than 100 spots on the meadow and the berm, straight and at two angles, never get past the reeds; the drawbridge and every raft lane get a duck across.
- The navmesh crosses the moat only on the raft lanes and the drawbridge (paths from the meadow to the berm and to the courtyard, every point over the water inside a crossing).
- Spawns are free and on the ground; the lever spot is free; every perch sees parts of the wall walk; each cannon fires clear over its barbette.
- The gatehouse top over the gate is an iron grate (`fence`): ducks stand on it, shots go through it at hunters hammering the gate.
- Inner kerbs on the wall walks are 0.35 m: a duck steps or drops into the courtyard. Crenels are fenced: no duck leaves the castle over the walls.

## Numbers

| Prop | Triangles | Colliders | Placed |
| --- | --- | --- | --- |
| `castle_tower` | 4,590 | 76 | 4 |
| `castle_wall` (28 m, with the courtyard stair) | 2,097 | 51 | 3 |
| `castle_wall_short` (8 m) | 602 | 16 | 2 |
| `castle_gatehouse` | 2,782 | 41 | 1 |
| `castle_bridge` | 496 | 17 | 1 |
| `castle_core` | 1,236 | 10 | 1 |
| `castle_well` | 184 | 1 | 1 |
| `moat_reeds` | 552 / 48 | 1 | 132 |
| `raft_lane` | 2,054 | 5 | 4 |
| `raft` | 172 | 1 | 10 |
| `trench_dugout` | 2,498 | 4 | 6 |
| `hunter_watchtower` | 1,548 | 26 | 4 |
| `hay_bales` | 204 | 3 | 13 |
| `hay_cart` | 254 | 2 | 4 |
| `castle_drawbridge`, `castle_gate`, `castle_lever`, `bread_cannon`, `bread_loaf` (animated, not placed) | 752, 2,076, 280, 762, 136 | 0, 3 (with `states`), 0, 0, 0 | from `raid.props` |

The castle is 30,553 triangles at LOD0 (one LOD, drawn to 1,200 m). The map places 911 props (345 hedgerows, 192 trees, 132 reed strips, 66 trench tiles) and builds 2,309 colliders (2,303 from the props, 6 from the keep's own code). The navmesh bake (`deploy/server/build-navmesh.ts`, which bakes `RAID.mapId`) takes about 21 s.

## Rebuild

`sh art/map/build.sh` (or `--no-render`), then `npm run map:sync`. The generator alone: `python3 art/map/layout/gen_pond.py` (byte-identical output run to run). The renders alone: `Blender -b --factory-startup -P art/map/blender/render_pond.py -- [--quick] [--pond-shots topdown,eye,beauty,pieces]`.
