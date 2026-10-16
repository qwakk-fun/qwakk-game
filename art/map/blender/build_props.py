"""Build the Qwakk WWII prop kit: meshes, GLB exports, colliders.json, manifest.json and review renders.

Run through art/map/build.sh, or directly:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P qwakk-game/art/map/blender/build_props.py -- [options]
Options after `--`:
  --no-render     build and export only
  --quick         fewer render samples
  --only NAME     build (and render) only props whose name contains NAME (repeatable); skips the shared JSON
  --shots LIST    comma separated render groups: sheet,closeups,interiors,street,plane,lods,tint (default all)
"""

import inspect
import json
import math
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import kit  # noqa: E402
import toon  # noqa: E402
import props_military  # noqa: E402
import props_buildings  # noqa: E402
import props_country  # noqa: E402
import props_vehicles  # noqa: E402

MAP_ART = os.path.dirname(HERE)
GAME = os.path.dirname(os.path.dirname(MAP_ART))
EXPORT = os.path.join(MAP_ART, "export")
RENDERS = os.path.join(MAP_ART, "renders")
THUMBS = os.path.join(RENDERS, "thumbs")
PROPS_OUT = os.path.join(GAME, "apps", "client", "public", "models", "props")
GLB_SRC = os.path.join(EXPORT, "glb_src")     # uncompressed sources; compressed copies go to PROPS_OUT

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
NO_RENDER = "--no-render" in argv
QUICK = "--quick" in argv
ONLY = [argv[i + 1] for i, a in enumerate(argv) if a == "--only" and i + 1 < len(argv)]
SHOTS = None
if "--shots" in argv:
    SHOTS = set(argv[argv.index("--shots") + 1].split(","))

BUILDERS = props_military.BUILDERS + props_buildings.BUILDERS + props_country.BUILDERS + props_vehicles.BUILDERS

# What each collider kind means for the engine. Rapier colliders are built from colliders.json only.
KINDS = {
    "wall": {"move": True, "bullets": True, "sight": True, "note": "building and bunker walls, gables"},
    "floor": {"move": True, "bullets": True, "sight": True, "note": "walkable slabs and floors"},
    "stairs": {"move": True, "bullets": True, "sight": True, "note": "house stairs: one smooth ramp hull per flight under the visual steps (33 to 37 deg); church tower: one box per step, rise <= 0.22 m"},
    "ramp": {"move": True, "bullets": True, "sight": True, "note": "walkable slopes <= 35 deg"},
    "roof": {"move": True, "bullets": True, "sight": True, "note": "roof slabs, too steep to stand on"},
    "cover": {"move": True, "bullets": True, "sight": True, "note": "sandbags, railings, pews, low walls"},
    "block": {"move": True, "bullets": True, "sight": True, "note": "solid props: wrecks, rocks, hedgehogs"},
    "berm": {"move": True, "bullets": True, "sight": True, "note": "earth banks, walkable slopes"},
    "crate": {"move": True, "bullets": True, "sight": True, "note": "loot containers"},
    "trunk": {"move": True, "bullets": True, "sight": True, "note": "tree trunks"},
    "wire": {"move": True, "bullets": False, "sight": False, "note": "barbed wire: blocks movement only"},
    "fence": {"move": True, "bullets": False, "sight": False, "note": "wooden fences: thin rails"},
    "hedge": {"move": True, "bullets": False, "sight": True, "note": "hedgerow foliage: blocks movement and sight, bullets pass"},
    "foliage": {"move": False, "bullets": False, "sight": True, "note": "bushes: walk-through, hides players"},
}


# Camera distance (m) up to which each LOD node is drawn; the last value is the cull distance.
# Desktop numbers; multiply by about 0.6 on phones. Props without LODs only have LOD0.
LOD_UNTIL = {
    "hedgerow": (35, 110, 320), "tree_oak": (45, 140, 450), "tree_poplar": (45, 140, 450), "tree_apple": (40, 120, 350),
    "bush_round": (30, 90, 220), "bush_wide": (30, 90, 220), "stone_wall": (30, 90, 220),
    "sandbag_wall": (30, 90, 200), "sandbag_corner": (30, 90, 200),
    "trench_straight": (35, 110, 300), "trench_corner": (35, 110, 300), "trench_end": (35, 110, 300),
    "farmhouse": (60, 180, 700), "townhouse": (60, 180, 700), "house_ruined": (60, 180, 700), "barn": (60, 180, 700),
    "church": (70, 220, 1200), "bunker_pillbox": (50, 150, 600),
    "tank_wreck": (45, 140, 450), "truck_wreck": (45, 140, 450), "landing_craft": (45, 140, 450),
    "czech_hedgehog": (40, 250), "barbed_wire": (30, 120),
    "crate_small": (120,), "crate_large": (140,), "ammo_box": (80,), "fuel_barrel": (100,), "signpost": (150,),
    "wood_fence": (150,), "beach_obstacle": (200,), "rock_boulder": (300,), "rock_slab": (300,), "rock_spire": (350,),
    "crater": (150,), "rubble_pile": (200,), "lighthouse": (1200,), "bridge_stone": (600,), "transport_plane": (2000,),
}


def export_material(palette):
    mat = bpy.data.materials.new("QwakkProps")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = palette
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def export_glb(path, objs):
    select_only(objs)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
        export_animations=False, export_extras=False, export_morph=False, export_skins=False,
    )


def make_objects(p, mat, lod_props):
    """Root empty (named after the prop on export) with LOD0..LODn mesh children. Propellers and other
    child parts hang off pivot empties under the root, so quantization never moves their pivots."""
    root = bpy.data.objects.new(p.name + "_root", None)
    bpy.context.scene.collection.objects.link(root)
    lods = []
    for k, lp in enumerate([p] + lod_props):
        o = lp.to_object(mat)
        o.name = f"{p.name}_LOD{k}"
        o.parent = root
        if k > 0:
            o.hide_render = True
        lods.append(o)
    extra = []
    for child, loc in getattr(p, "children", []):
        pivot = bpy.data.objects.new(child.name + "_pivot", None)
        bpy.context.scene.collection.objects.link(pivot)
        pivot.parent = root
        pivot.location = loc
        c = child.to_object(mat)
        c.name = child.name + "_mesh"
        c.parent = pivot
        extra += [pivot, c]
    p._root, p._lods, p._extra, p._lod_props = root, lods, extra, lod_props
    render_objs = [lods[0]] + [o for o in extra if o.type == "MESH"]
    return lods[0], render_objs


def bounds_gltf(objs):
    pts = []
    for o in objs:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            pts.append(kit.to_gltf_vec(o.matrix_world @ v.co))
    mn = [kit.r4(min(p[i] for p in pts)) for i in range(3)]
    mx = [kit.r4(max(p[i] for p in pts)) for i in range(3)]
    return mn, mx


# ---------------------------------------------------------------- validation
def _inside_box(c, pt, inflate):
    m = c["q"].to_matrix()
    local = m.transposed() @ (Vector(pt) - c["c"])
    h = c["h"]
    return abs(local.x) <= h.x + inflate and abs(local.y) <= h.y + inflate and abs(local.z) <= h.z


def check_probes(p):
    """Each probe is a segment the player capsule (r 0.35) must pass along at standing height."""
    problems = []
    for a, b, label in p.meta.get("probes", []):
        a, b = Vector(a), Vector(b)
        n = max(2, int((b - a).length / 0.1))
        for i in range(n + 1):
            pt = a.lerp(b, i / n)
            for dz in (0.3, 0.9, 1.6):
                q = pt + Vector((0, 0, dz))
                for c in p.colliders:
                    if c["kind"] in ("floor", "foliage", "stairs", "ramp", "berm"):
                        continue
                    hit = False
                    if c["type"] == "box":
                        hit = _inside_box(c, q, 0.3)
                    elif c["type"] == "cylinder":
                        hit = (Vector((q.x, q.y)) - Vector((c["c"].x, c["c"].y))).length <= c["r"] + 0.3 and abs(q.z - c["c"].z) <= c["halfHeight"]
                    if hit:
                        problems.append(f"{p.name}: probe '{label}' blocked by {c['kind']} at {tuple(round(x, 2) for x in q)}")
                        break
                else:
                    continue
                break
            else:
                continue
            break
    return problems


# ---------------------------------------------------------------- main
def build_all():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for d in (EXPORT, RENDERS, THUMBS, PROPS_OUT):
        os.makedirs(d, exist_ok=True)
    palette = kit.build_palette(os.path.join(EXPORT, "props_palette.png"))
    mat = export_material(palette)
    built = []
    for fn in BUILDERS:
        name = fn.__name__
        if ONLY and not any(o in name for o in ONLY):
            continue
        p = fn()
        lod_props = []
        if "lod" in inspect.signature(fn).parameters:
            n = len(LOD_UNTIL.get(name, (0, 0, 0)))
            lod_props = [fn(lod=k) for k in range(1, n)]
        obj, objs = make_objects(p, mat, lod_props)
        built.append((p, obj, objs))
    return palette, mat, built


def collider_bounds_problems(p, mn, mx):
    out = []
    for c in p.colliders:
        cj = kit.collider_json(c)
        pts = []
        if cj["type"] == "hull":
            pts = cj["points"]
        else:
            q = c["q"]
            if cj["type"] == "box":
                h = c["h"]
                corners = [Vector((sx * h.x, sy * h.y, sz * h.z)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
            else:
                corners = [Vector((0, 0, s * (c["halfHeight"] + c["r"]))) for s in (-1, 1)]
            pts = [kit.to_gltf_vec(c["c"] + q @ v) for v in corners]
        for pt in pts:
            if any(pt[i] < mn[i] - 0.35 or pt[i] > mx[i] + 0.35 for i in range(3)):
                out.append(f"{p.name}: {cj['kind']} {cj['type']} collider outside the mesh bounds at {[round(v, 2) for v in pt]}")
                break
    return out


def export_all(built):
    stats, colliders, manifest, problems = {}, {}, {}, []
    os.makedirs(GLB_SRC, exist_ok=True)
    for p, obj, objs in built:
        path = os.path.join(GLB_SRC, p.name + ".glb")
        # node names in the file: <prop> (root) / LOD0, LOD1, LOD2 / PropLeft, PropRight pivots
        renames = [(p._root, p.name)] + [(o, f"LOD{k}") for k, o in enumerate(p._lods)]
        renames += [(o, o.name[:-6] if o.name.endswith("_pivot") else o.name) for o in p._extra]
        old = [(o, o.name) for o, _ in renames]
        for o, _ in renames:
            o.name = "__tmp_" + o.name
        for o, nm in renames:
            o.name = nm
        export_glb(path, [p._root] + p._lods + p._extra)
        for o, nm in old:
            o.name = "__tmp2_" + nm
        for o, nm in old:
            o.name = nm
        lod_tris = [p.triangles() + sum(c.triangles() for c, _ in getattr(p, "children", []))] + [lp.triangles() for lp in p._lod_props]
        tris = lod_tris[0]
        mn, mx = bounds_gltf(objs)
        stats[p.name] = {"category": p.category, "triangles": tris, "lodTriangles": lod_tris, "vertices": len(p.verts),
                         "glb_src_bytes": os.path.getsize(path), "colliders": len(p.colliders)}
        colliders[p.name] = [kit.collider_json(c) for c in p.colliders]
        until = LOD_UNTIL.get(p.name, (300,))
        entry = {"category": p.category, "file": p.name + ".glb", "triangles": tris, "bounds": {"min": mn, "max": mx},
                 "lods": [{"node": f"LOD{k}", "until": until[k], "triangles": lod_tris[k]} for k in range(len(lod_tris))],
                 "cullDistance": until[len(lod_tris) - 1]}
        if p.outline:
            entry["outline"] = True
        if p.loot:
            entry["loot"] = [{"p": [kit.r4(a) for a in kit.to_gltf_vec(v)], "tierBonus": tb} if tb else
                             {"p": [kit.r4(a) for a in kit.to_gltf_vec(v)]} for v, tb in p.loot]
        for k in ("container", "tile", "nodes", "note"):
            if k in p.meta:
                entry[k] = p.meta[k]
        if "walk" in p.meta:
            # waypoints a duck can walk in order (door, stairs, upper floor): checked by apps/server/test/houses.test.ts
            walks = p.meta["walk"] if isinstance(p.meta["walk"][0][0], (list, tuple)) else [p.meta["walk"]]
            entry["walk"] = [[[kit.r4(a) for a in kit.to_gltf_vec(Vector(v))] for v in w] for w in walks]
        manifest[p.name] = entry
        problems += check_probes(p)
        problems += collider_bounds_problems(p, mn, mx)
    return stats, colliders, manifest, problems


def write_json(stats, colliders, manifest):
    col_doc = {
        "version": 1,
        "units": "meters",
        "space": "prop local, glTF axes: +X right, +Y up, +Z front. Origin on the ground. Same space as the prop GLB.",
        "shapes": {
            "box": "c center, h half extents, q rotation [x, y, z, w] (omitted = identity)",
            "capsule": "c center, r radius, halfHeight of the segment, along local +Y after q",
            "cylinder": "c center, r radius, halfHeight, along local +Y after q",
            "hull": "points: convex hull vertices",
        },
        "kinds": KINDS,
        "props": colliders,
    }
    with open(os.path.join(PROPS_OUT, "colliders.json"), "w") as f:
        json.dump(col_doc, f, separators=(",", ":"))
    with open(os.path.join(PROPS_OUT, "manifest.json"), "w") as f:
        json.dump({"version": 2, "palette": "props_palette.png (embedded in every GLB)",
                   "shadowTint": {"characters": kit.TOON_SHADOW_TINT, "environment": kit.ENV_SHADOW_TINT,
                                  "note": "toon shadow side = base color multiplied by the tint; ducks use characters, props and terrain use environment"},
                   "lodNote": "draw lods[k] while camera distance <= lods[k].until (meters, desktop; about 0.6x on phones); nothing past cullDistance. "
                              "Each LOD node carries the quantization scale and offset: bake lodNode.matrix into the geometry before instancing",
                   "props": manifest}, f, indent=1)
    with open(os.path.join(EXPORT, "stats.json"), "w") as f:
        json.dump(stats, f, indent=1)
    shutil.copyfile(os.path.join(PROPS_OUT, "manifest.json"), os.path.join(EXPORT, "manifest.json"))


def main():
    palette, mat, built = build_all()
    stats, colliders, manifest, problems = export_all(built)
    if not ONLY:
        write_json(stats, colliders, manifest)
    for name, s in stats.items():
        lt = "/".join(str(t) for t in s["lodTriangles"])
        print(f"PROP {name:20s} {lt:>16s} tris {s['glb_src_bytes'] / 1024:7.1f} KB src {s['colliders']:3d} colliders")
    print("TOTAL_TRIS", sum(s["triangles"] for s in stats.values()))
    for pr in problems:
        print("CHECK_FAIL", pr)
    if not problems:
        print("CHECKS_OK probes and collider bounds")
    if NO_RENDER:
        return
    import render_kit
    render_kit.run(palette, built, RENDERS, THUMBS, quick=QUICK, shots=SHOTS, game_dir=GAME)


main()
