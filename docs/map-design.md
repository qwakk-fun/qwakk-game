# Map design: Sainte-Canard (map_v1)

The real battle royale map for Phase 2: a Normandy-style coastal village and bocage countryside in the toon style, with ducks. Phase 1 keeps the greybox island in `packages/shared/src/map.ts`; this document is the brief for replacing it.

- Prop kit (meshes, colliders, renders): `art/map/README.md`
- Placement data: `art/map/export/map_v1.json` (format version 2), `map_v1_heights.bin`, `map_v1_ground.bin`
- Top-down render: `art/map/renders/map_topdown.png`
- Rebuild everything: `sh art/map/build.sh` (deterministic: same files, same bytes)

## 1. Theme and rules

- World War II flavor without real-world politics: a fictional coast called Sainte-Canard ("canard" is French for duck). Two fictional factions appear only as set dressing on wrecks and crates: the **Pond Brigade** (olive drab, yellow ring) and the **Grey Gull Corps** (field grey, orange triangle). Players are all ducks and are not split by faction.
- Never real Nazi symbols, national markings, unit markings, real place names or real text on signs. No brand or token logos on loot.
- Readability first: buildings and landmarks have distinct silhouettes (church spire, lighthouse, poplar rows, hedgerows), loot containers carry the yellow ring and an outline.

## 2. Size and players

- Square map 840 x 840 m (the current `MAP_SIZE`), island of about 0.54 km2 of land, sea margin all around. Map bounds stay where the greybox has them (boundary walls 6 m inside the edge).
- Built for 16 players first and 32 later. 634 loot points in v1: about 39 per player at 16, 19 at 32. Turn density up by zone if 32-player matches feel starved (section 5).
- Coordinates: x east, y up, z south (north is -z), meters, centered at the origin, sea surface y = 0. Same as `map.ts`.

## 3. Layout

Top-down (north up). Named zones, their centers and character:

```
 z=-400 +-------------------------------------------------------------------+
        | Pointe du Bec   |        Mallard Beach (sand, hedgehogs)    | R  |
        | lighthouse,     |   landing craft    bunker line on bluff   | i  |
        | cliffs, bunkers |-------------------------------------------| v  |
        |       coast road  \     Sainte-Canard (church square)   Pont | e  |
        |                    \--- village street --------------- Vieux | r  |
        |  bocage fields         |  main road                     |    |    |
        |                        |                                | Feather   |
        |   Ferme Colvert ---- Convoy Crossroads --------- ford --+ Ridge    |
        |   farm, orchard         (wrecked convoy)                | trenches  |
        |                        |                                |           |
        |  Bois des Plumes       |   Le Verger (orchard)          | Hameau Sud|
        |  (forest)              |                                |           |
 z=+400 +-------------------------------------------------------------------+
      x=-400                                                             x=+400
```

| Zone (id) | Center | Area | Tier | Drop | Loot points (containers) | Main props |
| --- | --- | --- | --- | --- | --- | --- |
| Mallard Beach (`beach`) | (35, -305) | 0.037 km2 | 2 | medium | 44 (7) | 6 pillboxes on the bluff, 79 hedgehogs, 20 log obstacles, 57 wire segments, 3 landing craft, 3 trench lines (21 tiles), 14 craters, 1 tank, 1 truck |
| Pointe du Bec (`headland`) | (-300, -300) | 0.041 km2 | 3 | medium | 72 (10) | lighthouse, 4 pillboxes, trench zigzag (16 tiles), keeper's townhouse, barn, wire, rocks, bushes |
| Sainte-Canard (`village`) | (45, -185) | 0.033 km2 | 3 | hot | 211 (22) | church, 14 houses with full interiors (8 townhouses with a bakery, 4 farmhouses, 2 ruins), kitchen gardens and a bombed lot where plainer houses stood, cobbled square, tank in the square, 2 trucks, rubble, garden walls, poplar avenue |
| Pont Vieux (`bridge`) | (202, -150) | 0.005 km2 | 2 | medium | 7 (2) | stone bridge, sandbag nests at both ends, tank wreck on the approach |
| Feather Ridge (`ridge`) | (284, 33) | 0.026 km2 | 3 | medium | 53 (12) | 64-tile zigzag trench on the crest, 3 pillboxes facing west, wire on the west slope, supply dump and truck on the reverse slope, 9 craters |
| Ferme Colvert (`farm`) | (-160, 46) | 0.012 km2 | 2 | medium | 33 (6) | farmhouse, barn, walled yard, a kitchen garden, small apple orchard, fences |
| Convoy Crossroads (`crossroads`) | (20, 62) | 0.010 km2 | 3 | hot | 57 (9) | 4 trucks and 2 tanks along the roads, corner townhouse, farmhouse and ruin, 3 sandbag nests, craters, signpost |
| Bois des Plumes (`forest`) | (-245, 235) | 0.046 km2 | 1 | quiet | 25 (6) | 300 oaks and poplars with two clearings, 77 bushes, rocks, a ruined lodge |
| Le Verger (`orchard`) | (42, 245) | 0.016 km2 | 1 | quiet | 26 (2) | 110 apple trees in rows, farmhouse and barn |
| Hameau Sud (`hamlet`) | (240, 274) | 0.006 km2 | 2 | quiet | 36 (3) | townhouse, farmhouse, barn, a bombed lot, walls |
| Bocage (`countryside`, the rest) | everywhere else | about 0.3 km2 | 1 | quiet | 70 (70) | 349 hedgerow blocks on a 54 m field grid with gates, lone trees, bushes, rocks, crates in the fields |

Roads (dirt, cobbles in the village): the main road runs north to south from the beach exit through the church square and the crossroads to the south coast; the village street runs west to the headland (coast road) and east over Pont Vieux to the ridge; the farm road runs west to east through Ferme Colvert, the crossroads and a second bridge (the ford at (193, 120)) to the ridge; lanes lead to the hamlet and the forest edge.

The river La Mare runs from the southern hills north to the sea east of the beach, splitting the ridge from the rest of the island. Two bridges cross it; elsewhere players wade (0.6 m deep, banks about 40 degrees).

### Zone notes: sightlines, cover, heat

- **Mallard Beach.** Long open sand under the bunker line: the hedgehogs, log ramps, craters and the three landing craft are the only cover between the waterline and the bluff (about 6 m high, about 18 degrees, walkable). Wire along the bluff foot funnels players to gaps. Hot only for players who want the pillbox loot; good for a fast early fight, bad for final circles. The bunkers' slits look north, so the bluff top can be taken from the side or the trench lines behind.
- **Pointe du Bec.** A plateau 19 m up with sheer cliffs on three sides: the lighthouse is a landmark, not a building to enter. High tier loot in a corner of the map means players must cross the open coast road or the village to leave. Sightlines over the beach from the headland edge.
- **Sainte-Canard.** The main hot drop. Streets 6 m wide, houses door-to-street on both sides, the church square in the middle with a tank wreck for cover. The church tower belfry (11.35 m) sees the whole village, the beach exit and the road to the crossroads, but it has only two ground doors and one long stair: strong but trappable. Ruins give half cover and quick vertical lines. Garden walls and fences behind the houses make flanking routes.
- **Pont Vieux.** A chokepoint: the river banks are steep, so the bridge and the wade are the only ways east in the north. Sandbag nests on both ends.
- **Feather Ridge.** The highest ground (crest about 24 m). The trench line along the crest gives crouch cover with stand-up firing, three pillboxes overlook the river valley, and the reverse slope has a supply dump. Best medium-range fights on the map and a strong final circle.
- **Ferme Colvert.** A walled courtyard between a farmhouse and a barn (the barn loft gives height), orchard rows to the west, hedgerows all around. Medium heat, good mid-game.
- **Convoy Crossroads.** The center of the map: two roads cross among wrecked trucks and tanks, three buildings on the corners. Lots of hard cover at waist and chest height, many angles. Hot drop and a natural final circle.
- **Bois des Plumes.** Dense trees, little loot, two clearings. Quiet landing for players who want to gear up slowly. Short sightlines (under 40 m).
- **Le Verger and the bocage.** Hedgerows block sight and movement (gates every field), so the countryside plays as a maze of small fields: short to medium range, ambush-heavy. Apple rows give soft cover. Quiet.
- **Hameau Sud.** Four buildings in the south-east corner, quiet loot and a late-game rotation spot.

## 4. Flow

### Drop plane

- The plane (`transport_plane.glb`, a flyover visual only) crosses at 180 m at about 55 m/s. `map_v1.json` lists 8 straight path options (`drop.plane.paths`, from and to points 470 m from their center, offset up to 90 m from the island center). Pick one with the match seed, or any line through the 300 m center disc.
- Allow the jump only over land. With a glide of about 1:3 from 180 m a player reaches about 500 m sideways, so every zone is reachable from every path; the far corners (headland, hamlet) cost a long glide, which keeps them medium.
- Hot drops: village and crossroads. Medium: beach bunkers, headland, ridge, farm, bridge. Quiet: forest, orchard, hamlet, bocage.

### Zone (circle) shrink

For an 8 to 12 minute match on 0.54 km2 of land:

| Phase | Wait (s) | Shrink (s) | End radius (m) | Damage per second |
| --- | --- | --- | --- | --- |
| 0 (drop and loot) | 90 | none | first circle shown at 60 s, r 380 | 0 |
| 1 | 90 | 60 | 260 | 1 |
| 2 | 60 | 45 | 170 | 2 |
| 3 | 50 | 40 | 105 | 4 |
| 4 | 40 | 30 | 60 | 7 |
| 5 | 30 | 25 | 30 | 11 |
| 6 | 20 | 20 | 0 | 18 |

About 10 minutes in total. The same table is in `map_v1.json` (`circle.phases`) as a starting point; the tuned numbers belong in `constants.ts`.

Where final circles play well (`circle.finalCandidates`, weighted): Feather Ridge south (3), Convoy Crossroads (3), Ferme Colvert (2), Le Verger (2), Sainte-Canard south edge (2), Hameau Sud (1), the forest edge (1), Pont Vieux (1). Pick the final circle first from these, then grow outward so every circle contains the next one, keeping at least 70 percent land inside each circle. Avoid ending on the beach sand (no cover), on the headland (cliffs on three sides) or deep in the forest (too blind).

## 5. Loot

- 634 points: 211 village, 72 headland, 70 countryside crates, 57 crossroads, 53 ridge, 44 beach, 36 hamlet, 33 farm, 26 orchard, 25 forest, 7 bridge.
- By kind: 259 `building` (floors and furniture tops: tables, shelves, beds, the workbench, the hay cart), 149 `container` (crates and ammo boxes), 170 `ground`, 26 `bunker`, 24 `trench`, 6 `vehicle` (inside the landing craft).
- Each point is `{id, x, y, z, tier, kind, zone, chunk, container?}`. `id` is stable for this file (sorted by chunk, then z, then x) so the server can sync loot by id. Tier 1 to 4 (tier 4 points are the upstairs rooms and the belfry in tier 3 zones). `container` is `small`, `large` (one tier higher) or `ammo` when the point is the top of a crate prop: open the crate to spawn. The meaning of every kind is in `lootKinds`.
- Suggested spawn rule: roll each point once per match with the match seed, about 70 percent chance, the item table picked by tier. Server only.
- Density knobs live in `gen_map.py` (`scatter_loot` densities per zone, crate counts per zone) and buildings bring their own points (`manifest.json` `loot`).

## 6. Engine data

### Heightfield intent

- Grid: 211 x 211 samples, 4 m apart, from -420 to 420 (the same grid as the greybox, so `physics.ts` and `terrainHeightAt` keep working). Heights from -6 to 25 m.
- Coastline: a hand-drawn polygon with a profile per edge: `beach` (north: 75 m of shallow water, a 45 m sand flat at about 3 degrees, a bluff about 6 m high at about 18 degrees, then the plateau at about 8 m), `cliff` (north-west headland and the east coast below the ridge: plateau straight into deep water), `shore` (everything else: gentle sandy or grassy shore). The coast polygon is in `terrain.coast`.
- Inland: rolling bocage at about 8 m, the headland plateau at 19 m, Feather Ridge (north to south crest at x = 282, about 24 m), the forest hills (about 14 m), a swell under the orchard.
- River: centerline with bed heights in `water.river` (6 m at the source down to -2.5 m at the mouth), a 12 m flat bed, 3 m banks, water surface 0.6 m above the bed. Draw the water as a ribbon mesh along the centerline at the `water` height.
- Pads: every building, the church square, the crossroads, the bridge ends and every trench tile are flattened into the heights (smooth falloff), and every crater dents them by 0.55 m. Buildings sit exactly on their pad (`y` in the JSON).

### Files

| File | Format |
| --- | --- |
| `map_v1_heights.bin` | 89,058 bytes: a 16-byte header, then 211 x 211 int16 little endian, centimeters, row-major (row along z from north to south, column along x from west to east), the same order as `TerrainDef.heights`. Divide by 100 for meters. Integers, so client and server load identical floats |
| `map_v1_ground.bin` | 44,537 bytes: a 16-byte header, then 211 x 211 uint8 ground paint ids in the same order; legend in `terrain.groundLegend`: grass, grass_dark, sand, rock, dirt_road, cobble, wheat, green_crop, plowed, forest_floor, river_mud, seabed, orchard_grass. Use for vertex colors or a splat texture |
| `map_v1.json` | Everything else (below). 245 KB, 49 KB gzipped |

Binary header (16 bytes, little endian, Python struct `<4sHHhhHH`):

| Offset | Type | Heights file | Ground file |
| --- | --- | --- | --- |
| 0 | 4 bytes ASCII | `QWHF` | `QWGP` |
| 4 | uint16 | format version, 1 | 1 |
| 6 | uint16 | samples per side, 211 | 211 |
| 8 | int16 | origin x in meters, -420 | -420 |
| 10 | int16 | origin z in meters, -420 | -420 |
| 12 | uint16 | cell size in centimeters, 400 | 400 |
| 14 | uint16 | units per meter, 100 | legend length, 13 |

Sample `(row, col)` is at `x = originX + col * cell`, `z = originZ + row * cell`, index `row * 211 + col`, data starting at byte 16 (int16 heights at `16 + 2 * index`).

`map_v1.json` top level (format version 2):

```json
{
  "version": 2, "name": "Sainte-Canard", "seed": 4417, "size": 840, "seaLevel": 0,
  "coords": "x east, y up, z south ...",
  "terrain": { "cells": 210, "cellSize": 4, "origin": [-420, -420], "heights": "map_v1_heights.bin", "ground": "map_v1_ground.bin",
               "headerBytes": 16, "heightsEncoding": "...", "groundEncoding": "...", "groundLegend": ["grass", "..."],
               "min": -6.0, "max": 24.95, "coast": [[-160, -345, "beach"], "..."] },
  "chunks": { "grid": 4, "size": 210, "origin": [-420, -420], "id": "chunk = cz * 4 + cx ..." },
  "water": { "sea": 0, "river": [{ "x": 142, "z": 318, "bed": 6.0, "water": 6.6 }, "..."], "riverHalfWidth": 6.6 },
  "roads": [{ "id": "main", "width": 6, "pts": [[40, -296], "..."] }],
  "plaza": [22, -208, 58, -176],
  "zones": [{ "id": "village", "name": "Sainte-Canard", "tier": 3, "drop": "hot", "poly": [[-58, -262], "..."] }],
  "fields": [{ "crop": "wheat", "quad": [[x, z], [x, z], [x, z], [x, z]] }],
  "drop": {
    "plane": { "prop": "transport_plane", "altitude": 180, "speed": 55, "spinNodes": ["PropLeft", "PropRight"], "paths": [{ "from": [x, z], "to": [x, z] }] },
    "pathRule": "pick one of the paths with the match seed (index = seed mod 8) ...",
    "jump": { "allowedOver": "land (terrain height above 1 m)", "autoJumpAtPathEnd": true },
    "glide": { "ratio": 3.0, "note": "..." }
  },
  "groundSpawns": [[134.24, 7.17, -8.05], "... 48 points"],
  "circle": { "finalCandidates": [{ "name": "Convoy Crossroads", "x": 22, "z": 62, "r": 55, "weight": 3 }],
              "phases": [{ "phase": 1, "waitS": 90, "shrinkS": 60, "radius": 260, "dps": 1 }, "..."], "rule": "..." },
  "lootKinds": { "building": "...", "container": "...", "bunker": "...", "vehicle": "...", "trench": "...", "ground": "..." },
  "loot": [{ "id": 100, "x": 46.05, "y": 1.86, "z": -321.34, "tier": 2, "kind": "container", "zone": "beach", "chunk": 2, "container": "small" }],
  "propIndex": { "farmhouse": { "start": 655, "count": 10, "chunks": { "2": [655, 2], "5": [657, 1], "...": [0, 0] } } },
  "props": [{ "prop": "hedgerow", "x": -141.45, "y": 8.59, "z": -236.4, "rotY": -3.0202, "chunk": 1 }, { "prop": "tree_oak", "x": 1, "y": 2, "z": 3, "rotY": 0.4, "scale": 1.12, "chunk": 6 }],
  "stats": { "props": 2093, "byProp": { "...": 0 }, "loot": 634, "groundSpawns": 48 }
}
```

- A prop instance is `{prop, x, y, z, rotY, scale?, chunk}`. `prop` names a GLB in `apps/client/public/models/props/` and an entry in `colliders.json` and `manifest.json`. `rotY` is the three.js yaw (rotY 0: the prop front, +Z in the GLB, faces south). `y` is the origin height, already on the terrain (the lowest ground under the footprint, so nothing floats). `scale` is uniform and only used on trees and rocks.
- `props` is sorted by prop type, then chunk. `propIndex[type]` gives the `start` and `count` of that type in `props`, and `chunks[id] = [start, count]` for each chunk that has it. So "all hedgerows in chunk 5" is one slice: build one `InstancedMesh` per LOD per type per chunk straight from those slices.
- Chunks: a 4 x 4 grid of 210 m squares; `chunk = cz * 4 + cx` with `cx = floor((x + 420) / 210)` and `cz = floor((z + 420) / 210)`, clamped to 0..3. Chunk 0 is the north-west corner.
- `groundSpawns`: 48 points on open land at least 70 m apart, for late joins, bot fill and tests without the plane. The normal entry is the plane drop (`drop`).
- Numbers are rounded (centimeters, 1e-4 radians), so parsing gives the same doubles everywhere.
- Zone polygons are `[x, z]` lists; `countryside` has no polygon (everything on land outside the others).

Changes from format version 1 (the engine has not loaded v1 yet, so nothing breaks): both `.bin` files gained the 16-byte header; `flight` moved to `drop.plane`; props are sorted and carry `chunk`, with `propIndex`; loot points gained `id`, `kind` and `chunk`; `groundSpawns`, `circle.phases`, `chunks` and `lootKinds` are new.

### Loading it deterministically (proposal for the engine agent)

1. Ship the three files with the client (static assets) and the server (read from disk). The server sends the map id and a hash of the three files at join; the client refuses to play on a mismatch.
2. In `packages/shared`, a pure `buildMapDef(json, heightsInt16, colliders)` replaces `generateMap(seed)` for BR matches: check the `QWHF` header, read the int16 samples from byte 16, heights `int16 / 100` into the existing `TerrainDef`, then one collider per shape per instance. No randomness at load.
3. Instance transform: yaw quaternion `[0, dsin(rotY / 2), 0, dcos(rotY / 2)]` (use `dsin`/`dcos`, not `Math.sin`), shape center rotated by the yaw then scaled and offset by `(x, y, z)`, shape rotation = yaw quaternion times shape `q`, half extents and radii times `scale`.
4. Shapes map to Rapier: `box` to `cuboid`, `capsule` to `capsule(halfHeight, r)`, `cylinder` to `cylinder(halfHeight, r)`, `hull` to `convexHull(points)` (the same WASM on both sides, so the same hull). Kinds map to collision groups and to the hit rule: `wire` and `fence` block movement only, `hedge` blocks movement and sight, `foliage` only sight (no Rapier body needed, keep it for bots and visibility).
5. Extend the existing `terrainHeightAt` test to the loaded heights, and add a test that two loads give identical collider lists.
6. Loot, spawn points for bots and circles come from the same JSON on the server only.

Client rendering:

1. Load each prop GLB with `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)` (`three/examples/jsm/libs/meshopt_decoder.module.js`). Every GLB has a root node named after the prop with children `LOD0`, `LOD1`, `LOD2` (fewer for small props).
2. For each LOD node, take its geometry and **bake the node matrix into it** (`geometry.applyMatrix4(lodNode.matrix)`): quantization stores positions as normalized integers and puts the scale and offset on the node. Then build one `InstancedMesh` per LOD per type per chunk from the `propIndex` slices.
3. Each frame (or every few frames), per instance or per chunk: draw `lods[k]` while the camera distance is at most `lods[k].until` from `manifest.json`, nothing past `cullDistance`. On phones scale the distances by about 0.6.
4. Use the environment shadow tint `#b4bccf` (`manifest.shadowTint.environment`) in the props and terrain toon material, and keep `#d9a6a0` for the ducks.

v1 totals: 2,093 instances, 6,137 collider shapes (4,349 boxes, 973 hulls, 718 capsules, 97 cylinders), all static. That is fine for Rapier on the server. If needed, skip `foliage`, and merge hedgerow boxes that line up.

## 7. Performance

Targets: desktop first, mid-range phones later (phase 3) without a rewrite.

| Item | Target | map_v1 today |
| --- | --- | --- |
| Draw calls | under 150 desktop, under 100 mobile | estimated 80 to 140 small InstancedMeshes in view (37 prop types x up to 3 LODs x visible chunks), plus terrain chunks and water; not measured yet |
| Triangles drawn | under 600k desktop, under 200k mobile | 44k worst frame from the village square (below) |
| Materials | 1 for every prop (palette), 1 terrain, 1 water, plus the outline pass for 3 loot props | same |
| Prop downloads | as small as possible | 1,212 KB for all 38 GLBs (meshopt + quantization), 4,693 KB uncompressed; the four detailed houses are 618 KB of it |

### Triangles in view (`art/map/layout/estimate_view.py`)

Camera at eye height (1.6 m above the ground), 300 m view distance, LOD switch and cull distances from `manifest.json`. "All around" is everything within 300 m (what is resident around the player); "worst frame" is the heaviest 100 degree horizontal view over 36 directions. Terrain triangles within 300 m are included.

| Camera | Desktop all around | Desktop worst frame | Phone (distances x 0.6) all around | Phone worst frame |
| --- | --- | --- | --- | --- |
| Village square (40, -190) | 135k | 44k | 66k | 21k |
| Convoy Crossroads (22, 62) | 105k | 33k | 73k | 24k |
| Bois des Plumes (-245, 235) | 102k | 38k | 65k | 24k |
| Feather Ridge crest (282, 30) | 86k | 34k | 62k | 25k |

For comparison, the village square with LOD0 everywhere and no culling: 579k all around and 206k in the worst frame. Terrain is 26k to 35k of each "all around" number.

- **Instancing.** One `InstancedMesh` per LOD per prop type per chunk (4 x 4 chunks of 210 m, slices from `propIndex`). A single InstancedMesh per type would be culled as one block.
- **LODs.** Shipped in every GLB (see `art/map/README.md` and `renders/lod_sheet.png`). Distances: hedgerows 35 / 110 / 320 m, trees 45 / 140 / 450 m, bushes, sandbags and stone walls 30 / 90 / 200 to 220 m, buildings 60 / 180 / 700 m, the church 70 / 220 / 1200 m, wrecks 45 / 140 / 450 m; small props are culled at 80 to 150 m. Distance fog in the sky color hides the far cut; a short dither fade would hide the LOD pops.
- **Static merging.** Not needed at these numbers. Keep it as the fallback if profiling ever shows draw calls as the limit (merge the village per chunk with the palette material).
- **Shadows.** None in real time. The toon ramp does the shading; later, blob shadows under vehicles and trees can be baked into the ground paint.
- **Terrain.** 211 x 211 vertices with ground colors per vertex (88k triangles, one draw call per chunk). Roads can be drawn as thin ribbon meshes from `roads` for crisp edges.
- **Server.** Colliders are static; build them once per room. 6.7k shapes are cheap for character controller queries and raycasts.

## 8. Phase 2 checklist

1. Load map_v1 into the shared sim and Rapier (section 6), behind a map selector so the greybox stays for deathmatch.
2. Client: meshopt decoder, InstancedMeshes per LOD per type per chunk (bake the LOD node matrix), LOD selection by distance, toon material with the props palette and the environment shadow tint, outline pass for `outline: true` props, river ribbon and sea plane, ground colors from `map_v1_ground.bin`.
3. Plane flyover with spinning `PropLeft` and `PropRight`, jump and glide, the circle phases above.
4. Loot spawn from `loot`, containers that open.
5. Bot navmesh from the walkable kinds (`floor`, `stairs`, `ramp`, `berm`, terrain).
6. Profile on a mid-range phone; tune the LOD distances in `build_props.py` (`LOD_UNTIL`) if needed.

## 9. Known gaps

- Hedgerows cut the countryside into a maze on purpose; if rotations feel slow, raise the gate rate (`bocage()` in `gen_map.py`).
- The church keeps its original sparse interior (pews, altar, the tower stair); the four house types have full interiors (art/map/README.md, Building notes).
- The river has no current or swim state: it is a wading slow-down zone (engine rule).
- Craters dent the heightfield at 4 m resolution, so the dent is softer than the crater mesh rim.
- Beach waterline props (landing craft) sit in 0.3 m of water; the sea is cosmetic, there is no swimming.
- Loot counts and tiers are first guesses; tune after bot matches.
