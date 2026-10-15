# Qwakk WWII map kit

The prop kit and the first layout for the real battle royale map: Sainte-Canard, a Normandy-style coastal village and bocage countryside drawn in the duck's chunky vinyl-toy toon style. Every mesh, collider and placement comes from the Python scripts in this folder. No third-party models (see `LICENSES.md`).

The map design (zones, loot, flow, engine data formats, performance) is in `../../docs/map-design.md`.

## Rebuild everything (one command)

```sh
sh qwakk-game/art/map/build.sh
```

Needs Blender 5.2 at `/Applications/Blender.app` (or `BLENDER=/path/to/blender`), `python3` (standard library only), Node 24 with npm (the compression tool installs its own pinned packages into `tools/node_modules` on first run) and `ffmpeg` for the sheets. A full build takes about 2 minutes on an M4 Pro, most of it the top-down map render.

Options: `--no-render` (exports only), `--quick` (fewer render samples), `--only NAME` (build and render only props whose name contains NAME; skips the shared JSON), `--shots sheet,closeups,street,plane,lods,tint` (render groups), `--no-map` (skip the layout and the map render).

Steps:

1. `blender/build_props.py` builds every prop and its LODs, exports one uncompressed GLB per prop to `export/glb_src/`, writes `colliders.json`, `manifest.json` and `export/stats.json`, runs the checks (door, stair and furniture probes, collider bounds), then renders.
2. `tools/compress.mjs` (Node, glTF Transform 4.4.2 and meshoptimizer 1.0.1, pinned in `tools/package.json`) compresses every GLB into `apps/client/public/models/props/`, then decodes each one with three's own `MeshoptDecoder` (`three/examples/jsm/libs/meshopt_decoder.module.js`, three 0.186.1) and checks that the dequantized bounds match the source within 1 cm.
3. `layout/gen_map.py` (plain Python) reads the manifest and writes `export/map_v1.json`, `export/map_v1_heights.bin` and `export/map_v1_ground.bin`.
4. `blender/render_map.py` renders `renders/map_topdown.png` from those files. `layout/estimate_view.py` prints the triangles drawn from a camera position (default: the village square).

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
| `renders/lod_sheet.png` | LOD0, LOD1 and LOD2 side by side for 16 props, with triangle counts |
| `renders/tint_compare.png` | The street scene with the character shadow tint on everything (left) and with the environment tint (right) |
| `renders/street_scene.png`, `renders/scale_duck_at_door.png` | Mock street with the duck for scale, and the duck at the farmhouse door |
| `renders/map_topdown.png` | Top-down render of map_v1 with zones, loot tiers, roads, plane paths and final circle candidates |

## Scripts

| File | Role |
| --- | --- |
| `blender/kit.py` | Palette, the `Prop` builder (boxes, cylinders, tubes, blobs, hulls, prisms with one palette cell per face), walls with stacked openings, stairs, gable roofs, collider records and the glTF axis conversion |
| `blender/props_military.py` | Pillbox, hedgehog, beach obstacle, sandbags, wire, trench tiles, crates, ammo box, fuel barrel |
| `blender/props_buildings.py` | Farmhouse, townhouse, ruined house, church, barn, lighthouse, stone bridge |
| `blender/props_country.py` | Hedgerow, stone wall, fence, signpost, trees, bushes, rocks, crater, rubble |
| `blender/props_vehicles.py` | Tank wreck, truck wreck, landing craft, drop plane |
| `blender/toon.py`, `blender/render_kit.py`, `blender/render_map.py` | Toon look and the review renders |
| `layout/terrain.py` | Coastline, height features, river, and the same height lookup as `terrainHeightAt` |
| `layout/gen_map.py` | Zones, roads, building slots, scatter rules, loot, flight paths, circle hints; writes map_v1 |

## Conventions

- Meters. Blender authoring space is Z up with the front facing -Y; the GLB is Y up with the front facing +Z (the same as the duck). Origins sit on the ground. Buildings: the origin is the footprint center at ground level, the ground floor top is 0.15 m, the upper floor top is 3.15 m.
- Doors are 1.1 m wide and 2.1 m tall. Stairs rise 0.2 m per step (the controller steps up to 0.45 m). Ground floor windows have a 1.05 m sill (shoot through, not walk through).
- One material (`QwakkProps`) with the shared 256 px palette on every prop. The game swaps in the toon shader: 2-band ramp on a fixed light, shadow side multiplied by a tint. No outline on environment pieces; `manifest.json` flags `outline: true` on the loot containers (crates, ammo box) so the engine adds the 7.5 mm `#151619` inverted hull there only.
- Shadow tints: characters keep `#d9a6a0` (warm, the duck recipe). Environment props and the terrain use **`#b4bccf`** (cool neutral), so stone, plaster and concrete stay stone-colored in shadow instead of turning pink. The ducks then pop a little more against the set. Both values are in `manifest.json` (`shadowTint`) and `blender/kit.py`. See `renders/tint_compare.png`.
- Shading: organic parts (foliage blobs, trunks, the crater bowl, the fuselage and nacelles) use smooth normals; hard-surface parts (walls, roofs, crates, sandbags, wrecks, rocks) keep flat normals on purpose, because the faceted 2-band look is the style. Smoothing them would make the toon terminator wander across flat walls. Flat normals cost file size; meshopt and quantization absorb most of it.
- Brand accents are kept for readability: the yellow ring marks loot containers, the Pond Brigade insignia and the plane stripes; orange marks the Grey Gull Corps insignia and a few signpost stripes.
- Fictional factions only: **Pond Brigade** (olive drab, yellow ring insignia) and **Grey Gull Corps** (field grey, orange triangle insignia). No real national, Nazi or unit markings, no real text, no brand logos.
- The drop plane has two pivot nodes, `PropLeft` and `PropRight`, at the hubs (empties with the blade meshes as children); spin the pivots around their local Z (the flight axis).

## LODs and compression

- Every GLB has the same layout: root node `<prop>` (identity), children `LOD0` (full detail), `LOD1`, `LOD2` where they exist. Pick the LOD by camera distance with the `lods[].until` values in `manifest.json`; past the last `until` (`cullDistance`) the prop is not drawn. The distances are for desktop; multiply by about 0.6 on phones.
- LODs are modeled, not decimated: LOD1 keeps the silhouette and the main colors (buildings become closed shells with flat window and door decals, trees keep three canopy blobs, wrecks lose wheels and hatches), LOD2 is a block that holds the shape at 150 m and beyond (one canopy blob per tree, one rounded hedge block, a box and roof per house with its windows).
- Trees use low-poly geometry for LOD2 instead of a billboard: at 26 triangles it costs less than an alpha-tested impostor would cost in overdraw, needs no extra texture, and keeps the toon shading (a flat card cannot take the 2-band light).
- Compression: `EXT_meshopt_compression` plus `KHR_mesh_quantization` (positions 14 bit over one volume per file, normals 10 bit, UVs 12 bit, which keeps the 16 px palette cell centers exact). Load with `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)` from `three/examples/jsm/libs/meshopt_decoder.module.js`.
- **Engine note:** quantization stores positions as normalized integers and puts one scale and translation on each `LOD` node (the same values on every LOD of a file). Three's loader applies it, but when you take `mesh.geometry` out to build an `InstancedMesh`, bake the node transform first (`geometry.applyMatrix4(lodNode.matrix)`) or put it in the instance matrices. Colliders and loot points are in the root's space, not affected.
- Sizes: 2,675 KB uncompressed to 794 KB compressed for all 38 files (3.4 times smaller), before any gzip or brotli on the server.

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
| `farmhouse` | 3,750 / 156 / 72 | 60 / 180 / 700 | 280 KB | 59.3 KB | 94 | 11.0 x 11.8 x 8.9 | 10 |
| `townhouse` | 3,234 / 150 / 70 | 60 / 180 / 700 | 242 KB | 51.9 KB | 74 | 9.0 x 10.8 x 8.3 | 14 |
| `house_ruined` | 2,380 / 228 / 70 | 60 / 180 / 700 | 194 KB | 48.2 KB | 97 | 11.8 x 6.6 x 9.4 | 8 |
| `church` | 3,208 / 112 / 64 | 70 / 220 / 1200 | 230 KB | 50.4 KB | 167 | 10.3 x 26.1 x 25.7 | 1 |
| `barn` | 2,776 / 100 / 46 | 60 / 180 / 700 | 208 KB | 47.2 KB | 59 | 10.3 x 9.7 x 15.3 | 5 |
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

All 38 props at LOD0: 36,630 triangles. GLBs: 2,675 KB uncompressed, 794 KB compressed. `colliders.json` 62 KB.

### Building notes

- **Farmhouse** (stone, slate roof, green shutters): two rooms per floor, front door to the west room, back door to the east room, 15-step stair along the back wall, stairwell rails, attic sealed by a ceiling slab. Furniture: kitchen table with two benches and a chest (west room), a shelf unit, a small table and a chair (east room), two beds, a wardrobe and a desk upstairs. 8 loot points, most on furniture tops (the shelf, the tables, the beds).
- **Townhouse** (plaster, tile roof, blue shutters): a cafe on the ground floor (counter, two round tables with chairs, a shelf unit on the back wall), stairs along the west wall, upstairs a bed, a wardrobe and a table. 6 loot points.
- **Ruined house**: the farmhouse footprint with jagged walls (cut into 0.7 m strips), the west half keeps its upper floor and stairs, the east half is rubble. Good half-cover fights.
- **Church**: nave with pews (cover), side doors, chancel with the altar, and a climbable bell tower: front and west doors, 8 flights of 7 steps around an open shaft up to the belfry at 11.35 m, sniper openings on all four sides. The weathervane is a yellow duck.
- **Barn**: big open front door (leaves swung open as cover), back door, hay loft at 2.9 m over the back half reached by stairs along the west wall, hay bales as cover, a hay cart, a workbench with tools, barrels and a shelf in the loft. 7 loot points.
- All furniture has `cover` colliders (boxes, the round cafe tables are cylinders). The probes check that no furniture blocks a door, a stair foot or the upper floor paths.
- **Lighthouse**: exterior landmark only, with a keeper's hut.
- **Stone bridge**: a 20 m deck spanning a river 3 m deep, parapets as cover, arch underneath (2.5 m clear).

### Trench kit

Tiles snap to a 4 m grid. The trench floor is at ground level and the revetment is 1.25 m tall with earth berms to a 1.35 m crest that slope down outside (walkable, about 30 degrees): a crouched duck is hidden, a standing duck can shoot over. Players cannot jump out of the trench (1.25 m wall, 1.09 m jump), so every run ends in a `trench_end`, a ramp up to the crest and down the outside bank. The end bank and all berms reach 2.4 m past the tile edge. Corner yaw by the two directions it joins: south and east 0, east and north 90 degrees, north and west 180, west and south -90.

## Known weak spots

- Flat normals on hard-surface props keep files larger than smooth ones would be (by design, see Conventions).
- LOD switches are hard cuts. A short dither or alpha fade in the shader would hide the pop, mostly on hedgerows at 35 m and trees at 45 m.
- Rocks are very low poly (about 64 triangles) and plain; fine at distance, flat up close.
- Interiors are simple furniture blocks: they give cover and loot spots, not much story.
- Trench berms are hulls per tile, so the inside corners overlap a little and long runs on slopes step at tile joints (the generator flattens a pad under each tile).
- The tank and truck wrecks are boxy; they read at gameplay distance but not as hero pieces.
- The house LOD1 and LOD2 shells are closed boxes: from far away you cannot see through windows into lit rooms, which is fine for this style.
