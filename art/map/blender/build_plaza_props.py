"""Build the Duck Plaza props (props_plaza.py): GLBs, their colliders and manifest, checks and review renders.

Kept apart from build_props.py on purpose, so the shared colliders.json and manifest.json stay untouched:
  art/map/export/duck-plaza/glb_src/<prop>.glb          uncompressed GLBs (compressed copies: apps/client/public/models/props/)
  art/map/export/duck-plaza/plaza_colliders.json        collider doc, same format and kinds table as colliders.json
  apps/client/public/models/props/plaza_manifest.json   manifest, same format as manifest.json (copy in export/duck-plaza/)
  art/map/renders/duck-plaza/                           review renders

Run through art/map/build_plaza.sh, or directly:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P qwakk-game/art/map/blender/build_plaza_props.py -- [--no-render] [--quick]
"""

import json
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import kit  # noqa: E402
import toon  # noqa: E402
import props_plaza  # noqa: E402

MAP_ART = os.path.dirname(HERE)
GAME = os.path.dirname(os.path.dirname(MAP_ART))
EXPORT = os.path.join(MAP_ART, "export", "duck-plaza")
GLB_SRC = os.path.join(EXPORT, "glb_src")
RENDERS = os.path.join(MAP_ART, "renders", "duck-plaza")
THUMBS = os.path.join(RENDERS, "thumbs")
PROPS_OUT = os.path.join(GAME, "apps", "client", "public", "models", "props")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
NO_RENDER = "--no-render" in argv
QUICK = "--quick" in argv

# Same table as build_props.py (the engine reads the kinds from the collider file of the map).
KINDS = {
    "wall": {"move": True, "bullets": True, "sight": True, "note": "building and bunker walls, gables"},
    "floor": {"move": True, "bullets": True, "sight": True, "note": "walkable slabs and floors"},
    "stairs": {"move": True, "bullets": True, "sight": True, "note": "house stairs: one smooth ramp hull per flight under the visual steps (33 to 37 deg)"},
    "ramp": {"move": True, "bullets": True, "sight": True, "note": "walkable slopes <= 35 deg"},
    "roof": {"move": True, "bullets": True, "sight": True, "note": "roof slabs and the QoreChain Tower crown, too steep to stand on"},
    "cover": {"move": True, "bullets": True, "sight": True, "note": "sandbags, railings, furniture, planters, low walls"},
    "block": {"move": True, "bullets": True, "sight": True, "note": "solid props: wrecks, rocks, hedgehogs"},
    "berm": {"move": True, "bullets": True, "sight": True, "note": "earth banks, walkable slopes"},
    "crate": {"move": True, "bullets": True, "sight": True, "note": "loot containers"},
    "trunk": {"move": True, "bullets": True, "sight": True, "note": "tree trunks"},
    "wire": {"move": True, "bullets": False, "sight": False, "note": "barbed wire: blocks movement only"},
    "fence": {"move": True, "bullets": False, "sight": False, "note": "wooden fences: thin rails"},
    "hedge": {"move": True, "bullets": False, "sight": True, "note": "hedgerow foliage: blocks movement and sight, bullets pass"},
    "foliage": {"move": False, "bullets": False, "sight": True, "note": "bushes: walk-through, hides players"},
}

# Camera distance (m) up to which LOD0 is drawn (= the cull distance). Desktop numbers; about 0.6x on phones.
LOD_UNTIL = {
    "plaza_portal": 400, "plaza_fountain": 300, "plaza_board": 300, "plaza_statue": 300, "plaza_stall": 160,
    "plaza_lamp": 160, "plaza_flowerbed": 140, "plaza_bench": 120, "plaza_cafe": 120,
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


def make_objects(p, mat):
    root = bpy.data.objects.new(p.name + "_root", None)
    bpy.context.scene.collection.objects.link(root)
    o = p.to_object(mat)
    o.name = f"{p.name}_LOD0"
    o.parent = root
    p._root, p._lods, p._extra, p._lod_props = root, [o], [], []
    return o, [o]


def bounds_gltf(objs):
    pts = []
    for o in objs:
        for v in o.data.vertices:
            pts.append(kit.to_gltf_vec(o.matrix_world @ v.co))
    mn = [kit.r4(min(p[i] for p in pts)) for i in range(3)]
    mx = [kit.r4(max(p[i] for p in pts)) for i in range(3)]
    return mn, mx


def _inside_box(c, pt, inflate):
    m = c["q"].to_matrix()
    local = m.transposed() @ (Vector(pt) - c["c"])
    h = c["h"]
    return abs(local.x) <= h.x + inflate and abs(local.y) <= h.y + inflate and abs(local.z) <= h.z


def check_probes(p):
    """Each probe is a segment the player capsule (r 0.35) must pass along at 0.3, 0.9 and 1.6 m."""
    problems = []
    for a, b, label in p.meta.get("probes", []):
        a, b = Vector(a), Vector(b)
        n = max(2, int((b - a).length / 0.05))
        hit = None
        for i in range(n + 1):
            pt = a.lerp(b, i / n)
            for dz in (0.3, 0.9, 1.6):
                q = pt + Vector((0, 0, dz))
                for c in p.colliders:
                    if c["type"] == "box" and _inside_box(c, q, 0.35):
                        hit = (c["kind"], q)
                    elif c["type"] in ("cylinder", "capsule"):
                        if (Vector((q.x, q.y)) - Vector((c["c"].x, c["c"].y))).length <= c["r"] + 0.35 and abs(q.z - c["c"].z) <= c["halfHeight"] + c["r"]:
                            hit = (c["kind"], q)
                    if hit:
                        break
                if hit:
                    break
            if hit:
                break
        if hit:
            problems.append(f"{p.name}: probe '{label}' blocked by {hit[0]} at {tuple(round(x, 2) for x in hit[1])}")
    return problems


def collider_bounds_problems(p, mn, mx):
    out = []
    for c in p.colliders:
        cj = kit.collider_json(c)
        if cj["type"] == "hull":
            pts = cj["points"]
        else:
            q = c["q"]
            if cj["type"] == "box":
                h = c["h"]
                corners = [Vector((sx * h.x, sy * h.y, sz * h.z)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
            else:
                corners = [Vector((0, 0, s * (c["halfHeight"] + (c["r"] if c["type"] == "capsule" else 0)))) for s in (-1, 1)]
                corners += [Vector((c["r"] * sx, c["r"] * sy, 0)) for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
            pts = [kit.to_gltf_vec(c["c"] + q @ v) for v in corners]
        for pt in pts:
            if any(pt[i] < mn[i] - 0.35 or pt[i] > mx[i] + 0.35 for i in range(3)):
                out.append(f"{p.name}: {cj['kind']} {cj['type']} collider outside the mesh bounds at {[round(v, 2) for v in pt]}")
                break
    return out


def build_all():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for d in (EXPORT, GLB_SRC, RENDERS, THUMBS, PROPS_OUT):
        os.makedirs(d, exist_ok=True)
    # the shared kit palette (unchanged); written next to the plaza exports, never over export/props_palette.png
    palette = kit.build_palette(os.path.join(EXPORT, "props_palette.png"))
    mat = export_material(palette)
    built = []
    for fn in props_plaza.BUILDERS:
        p = fn()
        obj, objs = make_objects(p, mat)
        built.append((p, obj, objs))
    return palette, mat, built


def export_all(built):
    colliders, manifest, problems, stats = {}, {}, [], {}
    for p, obj, objs in built:
        path = os.path.join(GLB_SRC, p.name + ".glb")
        root, lod = p._root, p._lods[0]
        root_old, lod_old = root.name, lod.name
        root.name, lod.name = "__tmp_r", "__tmp_l"
        root.name, lod.name = p.name, "LOD0"
        export_glb(path, [root, lod])
        root.name, lod.name = "__tmp_r2", "__tmp_l2"
        root.name, lod.name = root_old, lod_old
        tris = p.triangles()
        mn, mx = bounds_gltf(objs)
        until = LOD_UNTIL[p.name]
        colliders[p.name] = [kit.collider_json(c) for c in p.colliders]
        entry = {"category": p.category, "file": p.name + ".glb", "triangles": tris, "bounds": {"min": mn, "max": mx},
                 "lods": [{"node": "LOD0", "until": until, "triangles": tris}], "cullDistance": until}
        if "note" in p.meta:
            entry["note"] = p.meta["note"]
        manifest[p.name] = entry
        stats[p.name] = {"triangles": tris, "colliders": len(p.colliders), "glb_src_bytes": os.path.getsize(path), "bounds": [mn, mx]}
        problems += check_probes(p)
        problems += collider_bounds_problems(p, mn, mx)
    return colliders, manifest, problems, stats


def write_json(colliders, manifest):
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
    with open(os.path.join(EXPORT, "plaza_colliders.json"), "w") as f:
        json.dump(col_doc, f, separators=(",", ":"))
    man = {"version": 2, "palette": "props_palette.png (embedded in every GLB)",
           "shadowTint": {"characters": kit.TOON_SHADOW_TINT, "environment": kit.ENV_SHADOW_TINT,
                          "note": "toon shadow side = base color multiplied by the tint; ducks use characters, props and terrain use environment"},
           "lodNote": "draw lods[k] while camera distance <= lods[k].until (meters, desktop; about 0.6x on phones); nothing past cullDistance. "
                      "Each LOD node carries the quantization scale and offset: bake lodNode.matrix into the geometry before instancing",
           "props": manifest}
    path = os.path.join(PROPS_OUT, "plaza_manifest.json")
    with open(path, "w") as f:
        json.dump(man, f, indent=1)
    shutil.copyfile(path, os.path.join(EXPORT, "plaza_manifest.json"))


# ---------------------------------------------------------------- review renders
SKY = "#9fd7f2"
GRASS = "#8fae55"
PAVING = "#d8c9a6"


def render_all(palette, built):
    import render_kit
    toon.setup_scene(samples=8 if QUICK else 32)
    render_kit._prepare(built, palette)
    files = render_kit.thumbnails(built, THUMBS)
    render_kit.sheet(files, os.path.join(RENDERS, "props_sheet.png"), cols=5)
    names = render_kit.by_name(built)
    for _, _, objs in built:
        render_kit._hide_all(objs, True)
    toon.setup_scene(samples=bpy.context.scene.eevee.taa_render_samples, size=(1280, 960), bg=SKY)
    ground = render_kit.ground_plane(200, color=PAVING)
    duck = render_kit.import_duck(GAME)
    # close-ups: each prop with the duck beside it for scale (the duck is about 1.2 m tall)
    shots = {
        "plaza_portal": ((-4.6, -2.2, 0), 28, 12, 35), "plaza_fountain": ((-3.4, -4.3, 0), 30, 22, 40),
        "plaza_bench": ((1.5, -0.9, 0), 25, 18, 45), "plaza_lamp": ((0.9, -0.6, 0), 25, 12, 45),
        "plaza_statue": ((1.6, -1.4, 0), 30, 12, 45), "plaza_flowerbed": ((2.3, -0.8, 0), 25, 25, 45),
        "plaza_board": ((-3.9, -1.6, 0), 22, 10, 40), "plaza_stall": ((2.2, -1.7, 0), 28, 16, 45),
        "plaza_cafe": ((1.3, -1.2, 0), 25, 16, 45),
    }
    for name, (dloc, yaw, pitch, lens) in shots.items():
        p, obj, objs = names[name]
        render_kit._hide_all(objs, False)
        if duck:
            duck.location = dloc
            duck.rotation_euler = (0, 0, math.radians(-20))
        cam, _, _ = toon.fit_camera("close_" + name, objs, yaw_deg=yaw, pitch_deg=pitch, lens=lens, margin=1.05, aspect=0.75)
        toon.render(cam, os.path.join(RENDERS, f"closeup_{name}.png"))
        if name == "plaza_portal":
            cam2 = toon.orbit_camera("cam_portal_front", (0, 0, 3.4), 13, 0, 4, lens=35)
            toon.render(cam2, os.path.join(RENDERS, "closeup_plaza_portal_front.png"))
        render_kit._hide_all(objs, True)
    # a little plaza: the pieces together, from the player's height and from above
    tmp = []
    layout = [
        ("plaza_portal", (0, 14, 0), 180), ("plaza_fountain", (0, 0, 0), 0), ("plaza_statue", (-9, 4, 0), 30),
        ("plaza_board", (9, 3, 0), -60), ("plaza_bench", (-4.6, -3.6, 0), 135), ("plaza_bench", (4.6, -3.6, 0), -135),
        ("plaza_lamp", (-3.2, 7, 0), 0), ("plaza_lamp", (3.2, 7, 0), 0), ("plaza_flowerbed", (-5.5, 9, 0), 0),
        ("plaza_flowerbed", (5.5, 9, 0), 0), ("plaza_stall", (-8, -6, 0), 40), ("plaza_cafe", (7, -6, 0), 0),
        ("plaza_cafe", (9.5, -3.5, 0), 20),
    ]
    for n, loc, rz in layout:
        tmp.append(render_kit.instance(names[n][1], loc, rz))
    if duck:
        duck.location = (1.2, -6.5, 0)
        duck.rotation_euler = (0, 0, math.radians(170))
    cam = toon.camera("cam_plaza", (2.5, -17, 2.2), (0, 4, 2.6), lens=28)
    toon.render(cam, os.path.join(RENDERS, "plaza_scene.png"))
    cam = toon.orbit_camera("cam_plaza_high", (0, 2, 0), 34, 20, 42, lens=32)
    toon.render(cam, os.path.join(RENDERS, "plaza_scene_high.png"))
    for o in tmp + [ground]:
        bpy.data.objects.remove(o)


def main():
    palette, mat, built = build_all()
    colliders, manifest, problems, stats = export_all(built)
    write_json(colliders, manifest)
    for name, s in stats.items():
        print(f"PROP {name:18s} {s['triangles']:6d} tris {s['glb_src_bytes'] / 1024:7.1f} KB src {s['colliders']:3d} colliders  bounds {s['bounds']}")
    print("TOTAL_TRIS", sum(s["triangles"] for s in stats.values()))
    for pr in problems:
        print("CHECK_FAIL", pr)
    if not problems:
        print("CHECKS_OK probes and collider bounds")
    if not NO_RENDER:
        render_all(palette, built)


main()
