# Qwakk WWII map kit

The prop kit and the first layout for the real battle royale map: Yelova, a Normandy-style coastal village and bocage countryside drawn in the duck's chunky vinyl-toy toon style. Every mesh, collider and placement comes from the Python scripts in this folder. No third-party models (see `LICENSES.md`).

The map design (zones, loot, flow, engine data formats, performance) is in `../../docs/map-design.md`.

## Rebuild everything (one command)

```sh
sh qwakk-game/art/map/build.sh
```

Needs Blender 5.2 at `/Applications/Blender.app` (or `BLENDER=/path/to/blender`), `python3` (standard library only), Node 24 with npm (the compression tool installs its own pinned packages into `tools/node_modules` on first run) and `ffmpeg` for the sheets. A full build takes about 2 minutes on an M4 Pro, most of it the top-down map render.

Options: `--no-render` (exports only), `--quick` (fewer render samples), `--only NAME` (build and render only props whose name contains NAME; skips the shared JSON), `--shots sheet,closeups,street,plane,lods,tint` (render groups; also `interiors`), `--no-map` (skip the layout and the map render).

Steps:

1. `blender/build_props.py` builds every prop and its LODs, exports one uncompressed GLB per prop to `export/glb_src/`, writes `colliders.json`, `manifest.json` and `export/stats.json`, runs the checks (door, stair and furniture probes, collider bounds), then renders.
2. `tools/compress.mjs` (Node, glTF Transform 4.4.2 and meshoptimizer 1.0.1, pinned in `tools/package.json`) compresses every GLB into `apps/client/public/models/props/`, then decodes each one with three's own `MeshoptDecoder` (`three/examples/jsm/libs/meshopt_decoder.module.js`, three 0.186.1) and checks that the dequantized bounds match the source within 1 cm.
3. `layout/gen_map.py` (plain Python) reads the manifest and writes `export/map_v1.json`, `export/map_v1_heights.bin` and `export/map_v1_ground.bin`.
4. `blender/render_map.py` renders `renders/map_topdown.png` from those files. `layout/estimate_view.py` prints the triangles drawn from a camera position (default: the village square).
5. `layout/gen_quarter.py` writes the Kavren deathmatch arena to `export/canard-quarter/` and `blender/render_arena.py` renders it to `renders/canard-quarter/` (see Deathmatch arena below).
6. `layout/gen_pond.py` writes Pond Keep, the Hunt Season castle map, to `export/pond-keep/` and `blender/render_pond.py` renders it to `renders/pond-keep/` (see Hunt Season castle below; `--pond-shots topdown,eye,beauty,pieces` picks render groups).

Reproducible: two builds give byte-identical GLBs, `colliders.json` and map files (checked with md5).

## Outputs

| Path | What |
| --- | --- |
| `apps/client/public/models/props/<prop>.glb` | One compressed GLB per prop (meshopt + quantization): a root node named after the prop with `LOD0`, `LOD1`, `LOD2` children, palette texture embedded |
| `apps/client/public/models/props/colliders.json` | Collision shapes per prop (format below), from LOD0 |
| `apps/client/public/models/props/manifest.json` | Per prop: category, triangles, bounds, `lods` (node, switch distance, triangles), `cullDistance`, `glbBytes`, loot points, `outline`, container type, notes; plus the recommended shadow tints |
| `export/glb_src/<prop>.glb` | The same GLBs uncompressed (float positions, no extensions), for inspection in any viewer |
| `export/props_palette.png` | 256 px palette, 16 px cells (names in `blender/kit.py`) |
| `export/stats.json` | Triangles, vertices, GLB bytes and collider count per prop |
| `export/map_v1.json`, `map_v1_heights.bin`, `map_v1_ground.bin` | The placement data for the engine (see the map design doc) |
| `renders/kit_overview.png` | All props on one sheet with triangle counts (`renders/thumbs/` has the single tiles) |
| `renders/closeup_*.png` | Close-ups of buildings, wrecks, the pillbox, the trench set, the plane |
| `renders/cutaway_*.png`, `renders/cutaway_ground_*.png`, `renders/colliders_*.png` | Buildings cut open at the upper floor and at the ground floor (furniture), and the ground floor cut with the collider shapes drawn over the mesh (blue: floors and ramps, orange: stairs, yellow: walls, cover, furniture) |
| `renders/interior_<house>_<room>.png` | Eye-level shots inside each house and one from the street (`--shots interiors`, cameras in each house's `meta["cams"]`) |
| `renders/lod_sheet.png` | LOD0, LOD1 and LOD2 side by side for 16 props, with triangle counts |
| `renders/tint_compare.png` | The street scene with the character shadow tint on everything (left) and with the environment tint (right) |
| `renders/street_scene.png`, `renders/scale_duck_at_door.png` | Mock street with the duck for scale, and the duck at the farmhouse door |
| `renders/map_topdown.png` | Top-down render of map_v1 with zones, loot tiers, roads, plane paths and final circle candidates |
| `export/canard-quarter/map_v1.json`, `map_v1_heights.bin`, `map_v1_ground.bin` | The Kavren deathmatch arena, same format and kit |
| `renders/canard-quarter/` | `topdown.png` (play area ring, callouts, spawns with their facing), `overview.png`, `eye_*.png` street-level shots with ducks for scale |
| `export/pond-keep/map_v1.json`, `map_v1_heights.bin`, `map_v1_ground.bin` | Pond Keep, the Hunt Season castle map, with its `raid` markup (`docs/pond-keep.md`) |
| `renders/pond-keep/` | `topdown.png` and `topdown_castle.png` (the raid markup drawn over the plan), `eye_*.png` (wall walk, gatehouse top, a cannon, a watchtower, a trench exit, the courtyard), `beauty_*.png`, `overview.png`, `closeup_core.png`, `pieces.png` (the animated GLBs: gate states, cannon poses, drawbridge down and up, the lever) |

## Scripts

| File | Role |
| --- | --- |
| `blender/kit.py` | Palette, the `Prop` builder (boxes, cylinders, tubes, blobs, hulls, prisms with one palette cell per face), walls with stacked openings, stairs, gable roofs, collider records and the glTF axis conversion |
| `blender/props_military.py` | Pillbox, hedgehog, beach obstacle, sandbags, wire, trench tiles, crates, ammo box, fuel barrel |
| `blender/house_kit.py` | Shared house parts: two-tone walls (outside stone or plaster, inside lining in height bands), windows with lintels, casements and shutters, doorways, tiled roofs with courses, fascias and gutters, dormers, chimneys, stair flights with their ramp collider, plank and flagstone floors, beams, rails, ruin helpers, LOD shell decals |
| `blender/furniture.py` | The furniture and decoration library (tables, beds, wardrobes, hearth, range, sink, shop counter and shelves, bookcases, piano, stalls...), each piece built in its own frame with one cover collider |
| `blender/house_farm.py`, `house_town.py`, `house_ruin.py`, `house_barn.py` | The four enterable houses (layout, furniture, loot spots, probes, walk paths, review cameras) and their LODs |
| `blender/props_buildings.py` | Lighthouse, stone bridge, and the list of all building builders |
| `blender/qorechain_tower.py` | The QoreChain Tower (the Kavren centerpiece): arcade hall, solid lettered shaft, crown, and the QORECHAIN glyphs built from convex quads |
| `blender/props_country.py` | Hedgerow, stone wall, fence, signpost, trees, bushes, rocks, crater, rubble |
| `blender/props_vehicles.py` | Tank wreck, truck wreck, landing craft, drop plane |
| `blender/toon.py`, `blender/render_kit.py`, `blender/render_map.py` | Toon look and the review renders |
| `layout/terrain.py` | Coastline, height features, river, and the same height lookup as `terrainHeightAt` |
| `layout/gen_map.py` | Zones, roads, building slots, scatter rules, loot, flight paths, circle hints; writes map_v1 |
| `layout/gen_quarter.py`, `blender/render_arena.py` | The Kavren deathmatch arena and its review renders (reuses the RNG, footprint and trench helpers of `gen_map.py` and the terrain helpers of `render_map.py`) |
| `blender/castle.py` | Pond Keep's castle: corner tower, curtain walls, gatehouse, drawbridge quays, the QoreChain core, the well; the animated drawbridge, gate, lever, bread cannon and loaf |
| `blender/props_pond.py` | Moat reeds, raft lanes, beached rafts, trench dugouts, hunters' watchtowers, hay bales, the hay cart |
| `blender/emblem.py` | Flat decals: the Qwakk duck mark (traced from `apps/client/public/ui/brand-mark.svg`) and the QORECHAIN word (the tower's glyphs) |
| `layout/gen_pond.py`, `blender/render_pond.py` | Pond Keep (terrain with the moat, castle, crossings, reeds, trench ring, perches, the `raid` markup) and its review renders |

## Deathmatch arena: Kavren (`canard-quarter`)

A compact village quarter for the 24-duck deathmatch, built from the same kit plus one landmark of its own, the QoreChain Tower (Yelova does not place it). `npm run map:sync` copies it to `packages/shared/src/maps/canard-quarter/`.

- Size: terrain 288 x 288 m (72 cells of 4 m); the play area is the inside of a closed hedgerow ring about 162 x 162 m (25,100 m2). Outside the ring: a second hedge line, crop fields and tree lines on rising ground (scenery, never reachable). The loader's invisible walls (138 m) stay as a backstop.
- Layout: Kavren Square on the crossroads with the QoreChain Tower in its middle (an open arcade hall under a 34 m tower with QORECHAIN on all four faces; nothing above the hall can be reached), a townhouse bakery (west) and the ruined house (east) on the square, a second townhouse on the south-west corner, a farmhouse on the south road, the barn over a fenced farmyard (north-east). Around them: Tower Park behind the tower (a terrace wall with a gap, apple trees, crates, a sandbag nest), the Walled Garden, an apple orchard behind a hedge, bombed lots with craters, rubble, a tank and sandbag nests (south-west), a zigzag trench field with wire (south-east), inner hedges with gates that cut the long diagonals. Two long lanes (the 162 m Rue du Canard and the south road) have wrecks and barricades along their edges.
- Counts: 603 props (6 buildings: the QoreChain Tower, 2 townhouses, farmhouse, ruin, barn; 253 hedgerow pieces, 110 of them in the ring; 170 trees; 13 trench tiles; wrecks, walls, sandbags, crates), 1,498 colliders.
- Extra fields in `map_v1.json`: `mode: "deathmatch"`; `playArea.ring` (the ring's center line, inset 1.4 m); `dmSpawns`, 48 points `[x, y, z, yaw]` at least 15 m apart on free open ground (y is terrain + 0.1 m; yaw is the player yaw: 0 looks north, the duck looks along (-sin yaw, -cos yaw)); `zones` hold callout names only. No loot, plane or circle data.
- Checks: `apps/server/test/canardQuarter.test.ts` (determinism, heightfield, stale copy, the tower in the middle with an open hall and no walkable top, every spawn free and on the ground, a duck running and jumping at the ring from 108 points, straight and at two angles (324 runs), never gets out), `nav.test.ts` (bots route around and through the tower, never through its core or piers) and `houses.test.ts` (every house walk path on this map too). The generator asserts that the ground under every building stays below its floor.

## Hunt Season castle: Pond Keep (`pond-keep`)

A storybook stone duck castle on an island in a pond for Hunt Season; `docs/pond-keep.md` has the layout, the `raid` markup contract with real numbers, the animated GLBs and what the tests guarantee. `npm run map:sync` copies it to `packages/shared/src/maps/pond-keep/`; `deploy/server/build-navmesh.ts` bakes its navmesh (`RAID.mapId`).

- Size: terrain 400 x 400 m in 2 m cells (finer than Kavren's 4 m, for the moat banks); the play area is the inside of a hedgerow ring about 300 m across.
- The castle (one LOD each, 30,553 triangles in all): four 9 x 9 m corner towers (courtyard door, two flights to the wall walk doorways at 5.2 m, two more to the 9.8 m top with a bread cannon barbette at the outer corner and a duck flag), three 28 m curtain walls with a stone stair from the courtyard, two 8 m ones by the gatehouse, the gatehouse (4 x 4.2 m gate, an iron grate over it on the top, cone-roofed turrets), the drawbridge quays with the deck collider, the QoreChain core (a stepped plinth, a floating yellow crystal, two banners with QORECHAIN, text only).
- Battlements: a 1.0 m `wall` sill and 2.2 m `wall` merlons; every crenel holds a `fence` box to the merlon top, so shots and sight pass and no duck climbs out. Wall walk kerbs on the courtyard side are 0.35 m (step or drop down).
- The moat: reeds (`moat_reeds`, `fence`) on both banks keep ducks out of the water; the drawbridge and four raft lanes cross it.
- Animated GLBs are not in `props`: the game places them from `raid.props` (`castle_drawbridge` with a `Hinge`, `castle_gate` with `Intact`, `Damaged`, `Broken`, `Planks`, `bread_cannon` with `Yaw`, `Pitch`, `Muzzle`, `castle_lever` with `Handle`, `bread_loaf`). The manifest lists each one's `nodes` and every castle piece's `anchors` (named points in glTF space, which `gen_pond.py` turns into the markup). Collider records may carry `states` (the gate's).
- Checks: `apps/server/test/pondKeep.test.ts` (determinism, heightfield, stale copy, the markup, the cannons' line of fire, the moat crossing for ducks and for the navmesh) and `houses.test.ts` (every castle, raft lane and watchtower walk path).

## Conventions

- Meters. Blender authoring space is Z up with the front facing -Y; the GLB is Y up with the front facing +Z (the same as the duck). Origins sit on the ground. Buildings: the origin is the footprint center at ground level, the ground floor top is 0.15 m, the upper floor top is 3.15 m.
- Doors are 1.1 m wide and 2.1 m tall (open doorways; the leaf is swung flat against the inside wall, mesh only). House stairs rise 0.2 m per step visually, but their collider is one smooth ramp hull per flight through the step noses (33 to 37 degrees): Rapier's autostep never fires at walking or crouching speed on 0.27 m treads, a ramp is climbed at every gait. Ground floor windows have a 1.05 m sill (shoot through, not walk through); windows are open holes (bullets and sight pass), the casement leaves, shutters, mullions and frames are mesh only.
- One material (`QwakkProps`) with the shared 256 px palette on every prop. The game swaps in the toon shader: 2-band ramp on a fixed light, shadow side multiplied by a tint. No outline on environment pieces; `manifest.json` flags `outline: true` on the loot containers (crates, ammo box) so the engine adds the 7.5 mm `#151619` inverted hull there only.
- Shadow tints: characters keep `#d9a6a0` (warm, the duck recipe). Environment props and the terrain use **`#b4bccf`** (cool neutral), so stone, plaster and concrete stay stone-colored in shadow instead of turning pink. The ducks then pop a little more against the set. Both values are in `manifest.json` (`shadowTint`) and `blender/kit.py`. See `renders/tint_compare.png`.
- Shading: organic parts (foliage blobs, trunks, the crater bowl, the fuselage and nacelles) use smooth normals; hard-surface parts (walls, roofs, crates, sandbags, wrecks, rocks) keep flat normals on purpose, because the faceted 2-band look is the style. Smoothing them would make the toon terminator wander across flat walls. Flat normals cost file size; meshopt and quantization absorb most of it.
- Brand accents are kept for readability: the yellow ring marks loot containers, the Pond Brigade insignia and the plane stripes; orange marks the Grey Gull Corps insignia and a few signpost stripes.
- Fictional factions only: **Pond Brigade** (olive drab, yellow ring insignia) and **Grey Gull Corps** (field grey, orange triangle insignia). No real national, Nazi or unit markings, no real text, no brand logos. The one exception is the owner-requested QORECHAIN lettering on the Kavren tower (text only, no logo). No religious buildings.
- The drop plane has two pivot nodes, `PropLeft` and `PropRight`, at the hubs (empties with the blade meshes as children); spin the pivots around their local Z (the flight axis).

## LODs and compression

- Every GLB has the same layout: root node `<prop>` (identity), children `LOD0` (full detail), `LOD1`, `LOD2` where they exist. Pick the LOD by camera distance with the `lods[].until` values in `manifest.json`; past the last `until` (`cullDistance`) the prop is not drawn. The distances are for desktop; multiply by about 0.6 on phones.
- LODs are modeled, not decimated: LOD1 keeps the silhouette and the main colors (buildings become closed shells with flat window and door decals, trees keep three canopy blobs, wrecks lose wheels and hatches), LOD2 is a block that holds the shape at 150 m and beyond (one canopy blob per tree, one rounded hedge block, a box and roof per house with its windows).
- Trees use low-poly geometry for LOD2 instead of a billboard: at 26 triangles it costs less than an alpha-tested impostor would cost in overdraw, needs no extra texture, and keeps the toon shading (a flat card cannot take the 2-band light).
- Compression: `EXT_meshopt_compression` plus `KHR_mesh_quantization` (positions 14 bit over one volume per file, normals 10 bit, UVs 12 bit, which keeps the 16 px palette cell centers exact). Load with `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)` from `three/examples/jsm/libs/meshopt_decoder.module.js`.
- **Engine note:** quantization stores positions as normalized integers and puts one scale and translation on each `LOD` node (the same values on every LOD of a file). Three's loader applies it, but when you take `mesh.geometry` out to build an `InstancedMesh`, bake the node transform first (`geometry.applyMatrix4(lodNode.matrix)`) or put it in the instance matrices. Colliders and loot points are in the root's space, not affected.
- Sizes: 4,952 KB uncompressed to 1,261 KB compressed for all 38 files (3.9 times smaller), before any gzip or brotli on the server.

## Collider format (`colliders.json`)

```json
{
  "version": 1, "units": "meters",
  "space": "prop local, glTF axes: +X right, +Y up, +Z front. Origin on the ground.",
  "kinds": { "wall": { "move": true, "bullets": true, "sight": true, "note": "building and bunker walls, gables" } },
  "props": {
    "farmhouse": [
      { "type": "box", "kind": "wall", "c": [-4.5, 3.0, 3.6], "h": [0.5, 3.0, 0.2] },
      { "type": "box", "kind": "roof", "c": [0.0, 7.954, 2.229], "h": [5.45, 0.14, 3.1758], "q": [0.4067, 0.0, 0.0, 0.9135] }
    ],
    "trench_straight": [
      { "type": "hull", "kind": "berm", "points": [[0.84, 0.0, 2.0], [0.84, 1.25, 2.0], [1.3, 1.35, 2.0], [3.7, 0.0, 2.0], [0.84, 0.0, -2.0], [0.84, 1.25, -2.0], [1.3, 1.35, -2.0], [3.7, 0.0, -2.0]] }
    ],
    "tree_oak": [{ "type": "capsule", "kind": "trunk", "c": [0.0, 1.65, 0.0], "r": 0.4, "halfHeight": 1.35 }],
    "fuel_barrel": [{ "type": "cylinder", "kind": "block", "c": [0.0, 0.44, 0.0], "r": 0.29, "halfHeight": 0.44 }]
  }
}
```

- `box`: center `c`, half extents `h`, rotation `q` as `[x, y, z, w]` (left out when identity).
- `capsule` and `cylinder`: center, radius, half height of the straight part, along local +Y after `q`.
- `hull`: convex hull points (Rapier `ColliderDesc.convexHull`).
- `kind` says what the shape blocks: see the `kinds` table in the file. `wire` and `fence` block movement only, `hedge` blocks movement and sight but not bullets, `foliage` (bushes) only hides players.
- World transform for an instance: rotate the shape by the instance yaw (a quaternion around +Y built with `dsin`/`dcos`), scale center and size by the instance scale, then translate.
- Checks run on every build: door, stair and floor probes (a 0.35 m capsule path at 0.3, 0.9 and 1.6 m) must not hit a wall or cover shape, and every collider must stay inside its prop's mesh bounds.
- Each house also exports `walk` paths in `manifest.json` (glTF space waypoints: in through the door, up the stairs or the ruin's debris ramp, onto the upper floor). `apps/server/test/houses.test.ts` walks a sim duck along every path on every placed house, running and crouched, with the game's own movement code and colliders.

## Props

Triangles per LOD (LOD0 / LOD1 / LOD2), the distance in meters up to which each LOD is drawn (the last one is the cull distance), uncompressed and compressed GLB size, collider count, bounds (width x height x depth) and the instance count in map_v1.

| Prop | Triangles | Until (m) | Source | Compressed | Colliders | Bounds (m) | map_v1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bunker_pillbox` | 1,400 / 94 / 56 | 50 / 150 / 600 | 114 KB | 33.2 KB | 25 | 6.9 x 3.5 x 8.1 | 13 |
| `czech_hedgehog` | 212 / 36 | 40 / 250 | 22 KB | 11.2 KB | 3 | 1.9 x 1.5 x 1.9 | 79 |
| `beach_obstacle` | 196 | 200 | 16 KB | 7.6 KB | 4 | 1.5 x 2.3 x 4.6 | 20 |
| `sandbag_wall` | 792 / 46 / 10 | 30 / 90 / 200 | 68 KB | 22.8 KB | 1 | 3.1 x 0.9 x 0.5 | 12 |
| `sandbag_corner` | 1,232 / 92 / 20 | 30 / 90 / 200 | 104 KB | 32.0 KB | 2 | 2.3 x 0.9 x 2.7 | 23 |
| `barbed_wire` | 534 / 90 | 30 / 120 | 47 KB | 17.1 KB | 1 | 3.4 x 1.2 x 0.9 | 80 |
| `trench_straight` | 618 / 78 / 34 | 35 / 110 / 300 | 58 KB | 18.5 KB | 4 | 7.4 x 1.5 x 4.0 | 72 |
| `trench_corner` | 950 / 180 / 80 | 35 / 110 / 300 | 92 KB | 26.5 KB | 9 | 7.5 x 1.5 x 7.5 | 19 |
| `trench_end` | 550 / 74 / 54 | 35 / 110 / 300 | 54 KB | 18.0 KB | 6 | 7.4 x 1.4 x 6.8 | 10 |
| `crate_small` | 512 | 120 | 34 KB | 11.0 KB | 1 | 0.8 x 0.7 x 0.8 | 83 |
| `crate_large` | 536 | 140 | 36 KB | 11.3 KB | 1 | 1.6 x 0.9 x 0.9 | 23 |
| `ammo_box` | 122 | 80 | 13 KB | 6.8 KB | 1 | 0.5 x 0.4 x 0.3 | 50 |
| `fuel_barrel` | 166 | 100 | 14 KB | 7.2 KB | 1 | 0.6 x 0.9 x 0.6 | 30 |
| `farmhouse` | 12,306 / 212 / 84 | 60 / 180 / 700 | 872 KB | 176.7 KB | 100 | 12.0 x 12.3 x 9.4 | 9 |
| `townhouse` | 12,956 / 210 / 82 | 60 / 180 / 700 | 979 KB | 205.3 KB | 93 | 9.6 x 11.1 x 9.7 | 11 |
| `house_ruined` | 8,126 / 266 / 86 | 60 / 180 / 700 | 596 KB | 133.2 KB | 99 | 13.2 x 12.3 x 10.0 | 4 |
| `qorechain_tower` | 5,786 / 652 / 568 | 80 / 260 / 1200 | 492 KB | 100.3 KB | 112 | 16.7 x 34.6 x 16.7 | 0 (Kavren: 1) |
| `barn` | 6,642 / 120 / 46 | 60 / 180 / 700 | 484 KB | 103.2 KB | 57 | 11.7 x 11.4 x 15.3 | 4 |
| `lighthouse` | 678 | 1200 | 47 KB | 13.8 KB | 5 | 6.0 x 20.2 x 9.6 | 1 |
| `bridge_stone` | 418 | 600 | 32 KB | 10.5 KB | 19 | 5.6 x 4.9 x 20.0 | 2 |
| `hedgerow` | 912 / 156 / 72 | 35 / 110 / 320 | 35 KB | 17.1 KB | 2 | 9.0 x 3.3 x 2.7 | 394 |
| `stone_wall` | 1,220 / 22 / 10 | 30 / 90 / 220 | 98 KB | 30.3 KB | 1 | 4.0 x 1.0 x 0.8 | 32 |
| `wood_fence` | 232 | 150 | 21 KB | 9.0 KB | 1 | 3.2 x 1.1 x 0.2 | 16 |
| `signpost` | 182 | 150 | 17 KB | 7.9 KB | 1 | 2.3 x 3.0 x 2.2 | 3 |
| `tree_oak` | 788 / 118 / 26 | 45 / 140 / 450 | 26 KB | 14.8 KB | 1 | 6.7 x 8.6 x 6.0 | 261 |
| `tree_poplar` | 402 / 80 / 26 | 45 / 140 / 450 | 17 KB | 11.5 KB | 1 | 3.1 x 14.0 x 2.8 | 226 |
| `tree_apple` | 878 / 100 / 26 | 40 / 120 / 350 | 54 KB | 20.1 KB | 1 | 4.1 x 4.5 x 3.7 | 139 |
| `bush_round` | 360 / 56 / 20 | 30 / 90 / 220 | 15 KB | 11.1 KB | 1 | 2.1 x 1.6 x 1.6 | 137 |
| `bush_wide` | 450 / 108 / 20 | 30 / 90 / 220 | 18 KB | 12.1 KB | 1 | 4.6 x 1.3 x 1.9 | 131 |
| `rock_boulder` | 64 | 300 | 10 KB | 6.8 KB | 1 | 2.2 x 1.4 x 1.8 | 46 |
| `rock_slab` | 62 | 300 | 9 KB | 6.6 KB | 1 | 3.3 x 0.7 x 2.1 | 59 |
| `rock_spire` | 68 | 350 | 10 KB | 7.0 KB | 1 | 2.0 x 3.6 x 1.4 | 9 |
| `crater` | 360 | 150 | 24 KB | 10.2 KB | 0 | 6.9 x 0.4 x 7.0 | 31 |
| `rubble_pile` | 438 | 200 | 36 KB | 13.8 KB | 1 | 3.6 x 1.2 x 2.9 | 7 |
| `tank_wreck` | 1,072 / 122 / 66 | 45 / 140 / 450 | 85 KB | 25.8 KB | 7 | 3.7 x 2.7 x 7.8 | 5 |
| `truck_wreck` | 908 / 174 / 60 | 45 / 140 / 450 | 76 KB | 25.6 KB | 5 | 3.7 x 3.2 x 7.2 | 10 |
| `landing_craft` | 594 / 80 / 64 | 45 / 140 / 450 | 52 KB | 17.2 KB | 7 | 3.4 x 2.6 x 12.7 | 3 |
| `transport_plane` | 3,376 | 2000 | 168 KB | 42.1 KB | 0 | 29.5 x 5.3 x 19.9 | flyover |
| `castle_tower` | 4,590 | 1200 | 300 KB | 61.1 KB | 76 | 10.9 x 17.4 x 9.7 | 0 (Pond Keep: 4) |
| `castle_wall` | 2,097 | 1200 | 127 KB | 28.1 KB | 51 | 28.0 x 8.0 x 5.4 | 0 (Pond Keep: 3) |
| `castle_wall_short` | 602 | 1200 | 35 KB | 11.5 KB | 16 | 8.0 x 8.0 x 4.0 | 0 (Pond Keep: 2) |
| `castle_gatehouse` | 2,782 | 1200 | 171 KB | 37.9 KB | 41 | 15.0 x 15.2 x 8.5 | 0 (Pond Keep: 1) |
| `castle_bridge` | 496 | 900 | 35 KB | 11.3 KB | 17 | 7.3 x 11.0 x 17.1 | 0 (Pond Keep: 1) |
| `castle_core` | 1,236 | 1200 | 92 KB | 21.7 KB | 10 | 18.1 x 5.9 x 5.5 | 0 (Pond Keep: 1) |
| `castle_well` | 184 | 250 | 15 KB | 7.5 KB | 1 | 2.6 x 2.7 x 2.4 | 0 (Pond Keep: 1) |
| `castle_drawbridge` | 752 | 900 | 57 KB | 16.5 KB | 0 | 5.2 x 6.8 x 9.0 | animated (Pond Keep `raid.props`) |
| `castle_gate` | 2,076 | 600 | 146 KB | 38.5 KB | 3 | 4.5 x 4.2 x 3.5 | animated (Pond Keep `raid.props`) |
| `castle_lever` | 280 | 250 | 25 KB | 11.0 KB | 0 | 1.4 x 3.4 x 1.9 | animated (Pond Keep `raid.props`) |
| `bread_cannon` | 762 | 500 | 42 KB | 17.1 KB | 0 | 1.6 x 1.4 x 2.7 | animated (Pond Keep `raid.props`) |
| `bread_loaf` | 136 | 250 | 9 KB | 6.2 KB | 0 | 0.3 x 0.3 x 0.5 | animated (the cannon's shot) |
| `moat_reeds` | 552 / 48 | 35 / 260 | 32 KB | 13.7 KB | 1 | 4.1 x 2.2 x 1.0 | 0 (Pond Keep: 132) |
| `raft_lane` | 2,054 | 600 | 137 KB | 34.8 KB | 5 | 3.4 x 3.2 x 16.4 | 0 (Pond Keep: 4) |
| `raft` | 172 | 250 | 10 KB | 6.7 KB | 1 | 3.0 x 0.5 x 4.2 | 0 (Pond Keep: 10) |
| `trench_dugout` | 2,498 | 400 | 186 KB | 48.0 KB | 4 | 6.8 x 2.2 x 5.8 | 0 (Pond Keep: 6) |
| `hunter_watchtower` | 1,548 | 900 | 73 KB | 21.4 KB | 26 | 6.9 x 9.4 x 6.4 | 0 (Pond Keep: 4) |
| `hay_bales` | 204 | 250 | 19 KB | 8.3 KB | 3 | 1.4 x 1.1 x 1.3 | 0 (Pond Keep: 13) |
| `hay_cart` | 254 | 300 | 20 KB | 9.0 KB | 2 | 2.4 x 2.0 x 4.2 | 0 (Pond Keep: 4) |

All 57 props at LOD0: 90,373 triangles (the 38 WWII kit props 67,098 of that). GLBs: 6,485 KB uncompressed, 1,671 KB compressed (the four houses are 618 KB of that). `colliders.json` 88 KB.

### Building notes

Four enterable house types, each with a real interior (rooms, furniture with cover colliders, loot on furniture tops), placed 28 times on map_v1 (9 farmhouses, 11 townhouses, 4 ruins, 4 barns; the first layout had 37 plainer houses). The farmhouse at the head of the village square keeps 5 of its 10 loot spots, the count of the landmark that stood there before. Shared look: two-tone walls (outside stone or plaster with proud stones, plaster patches and quoins; inside a lining in height bands: panelling, plaster, wallpaper), lintels and sills, casement windows swung open, open shutters, flower boxes, plank and flagstone floors, ceiling beams, pendant lamps, pictures, rugs. Review shots: `renders/closeup_*`, `cutaway_*` and `interior_<house>_<room>.png`.

- **Farmhouse** (stone, slate roof with two dormers, a slate porch canopy over the front door, green shutters, chimney on the west gable): a farm kitchen on flagstones (stone hearth with logs and a pot, long table with benches, a plate dresser, a stone sink with a hand pump, a barrel and sacks) and a parlour (sofa, two armchairs, coffee table, radio table, bookcase, grandfather clock). A 15-step stair along the back wall climbs to the main bedroom (double bed, chest of drawers with a mirror, wardrobe, trunk) and a study bedroom (single bed, desk with a typewriter, bookcase, washstand). Outside: a woodpile on the east gable, a bench by the door, a rain barrel, a ladder. 10 loot spots.
- **Townhouse** (plaster, tile roof, blue shutters): a bakery. The shop has a display window with mullions, a red and cream striped awning, a painted sign (a loaf and wheat ears, no lettering), terracotta and cream tiles, a glass display case, a counter with a till, shelves of bread and jars and a cafe table; behind it a bakehouse with a brick bread oven, a kneading table and a range. A 15-step stair along the west wall climbs to a living room with two Juliet balconies (French windows with iron rails: cover colliders, shoot over them), a piano, a sofa and a sideboard with a radio, and a bedroom. Outside: a produce stand under the awning, a cafe table, a wall lamp. 10 loot spots.
- **Ruined house** (the farmhouse footprint after shelling): the west half stands to the eaves under a holed slate roof with charred rafters; the east half is broken down to waist and chest height and full of rubble mounds and fallen beams. Part of the upper floor has collapsed into a solid debris ramp (33 degrees, `ramp` collider), a second way up beside the stairs; a shell breach opens the west gable and a gap the east wall. Upstairs: a sandbagged firing position at the broken floor edge (cover) with an ammo box, a bed and a toppled wardrobe. 8 loot spots.
- **Barn** (timber on a stone base, tile roof with a louvred ridge vent and a duck vane, X-braced door leaves swung open as cover, a hay door with a hoist beam and pulley in the front gable): two cattle stalls with a feed trough, the hay cart, a workbench and tool racks, milk churns, barrels and bales; exposed posts, tie beams and rafters. Hay loft at 2.9 m over the back half (13-step stair along the west wall) with bales, a shelf and a supply cache of crates. 8 loot spots.
- All furniture has `cover` colliders (one box or cylinder per piece). The probes check that no furniture blocks a door, a stair foot or the upper floor paths, and the walk test climbs every staircase.
- **QoreChain Tower** (Kavren only): a 16 x 16 m Art Deco tower. The ground floor is an open arcade hall: three round arches (3 m wide, 4.4 m high) on every side, a solid 4 x 4 m core with yellow-banded lift doors, four columns and four waist-high planters (`cover`). Over the hall the shaft is one solid `wall` block to 18 m with sheer faces and no ledge, and the crown is a 60 degree pyramid (hip lines 51 degrees, both steeper than the 46 degree climb limit) with yellow hips and a yellow beacon at 34 m: no stairs and no walkable top, so it is cover and a landmark, never a perch. QORECHAIN runs across all four faces in 2.7 m yellow letters on a dark band at 12.4 to 16.4 m (above the house ridges, readable across the arena); the letters, window strips and trims are mesh only, so nothing snags a duck. The glyphs are our own convex quads (no font file). LOD1 and LOD2 keep the lettering as flat quads.
- **Lighthouse**: exterior landmark only, with a keeper's hut.
- **Stone bridge**: a 20 m deck spanning a river 3 m deep, parapets as cover, arch underneath (2.5 m clear).

### Trench kit

Tiles snap to a 4 m grid. The trench floor is at ground level and the revetment is 1.25 m tall with earth berms to a 1.35 m crest that slope down outside (walkable, about 30 degrees): a crouched duck is hidden, a standing duck can shoot over. Players cannot jump out of the trench (1.25 m wall, 1.09 m jump), so every run ends in a `trench_end`, a ramp up to the crest and down the outside bank. The end bank and all berms reach 2.4 m past the tile edge. Corner yaw by the two directions it joins: south and east 0, east and north 90 degrees, north and west 180, west and south -90.

## Known weak spots

- Flat normals on hard-surface props keep files larger than smooth ones would be (by design, see Conventions).
- LOD switches are hard cuts. A short dither or alpha fade in the shader would hide the pop, mostly on hedgerows at 35 m and trees at 45 m.
- Rocks are very low poly (about 64 triangles) and plain; fine at distance, flat up close.
- The four houses are 2 to 4 times the triangles of the first ones (6.6k to 13k at LOD0) and 618 KB of the compressed props: flat normals keep vertices unshared. They are drawn at LOD0 only within 60 m.
- Casement leaves inside the windows stick about 15 cm into the room and have no collider, so a duck can clip through them.
- Trench berms are hulls per tile, so the inside corners overlap a little and long runs on slopes step at tile joints (the generator flattens a pad under each tile).
- The tank and truck wrecks are boxy; they read at gameplay distance but not as hero pieces.
- The house LOD1 and LOD2 shells are closed boxes: from far away you cannot see through windows into lit rooms, which is fine for this style.
