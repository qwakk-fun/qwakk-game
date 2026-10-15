"""Review renders for the prop kit: labeled thumbnails and the overview sheet, building close-ups,
cutaways with the collider overlay, the plane, and the street scene with the duck for scale."""

import math
import os
import shutil
import subprocess

import bmesh
import bpy
from mathutils import Matrix, Vector

import kit
import toon

SKY = "#9fd7f2"
SHEET_BG = "#1b1d22"
GRASS = "#8fae55"
ROAD = "#c9b48a"
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"


def _hide_all(objs, hidden=True):
    for o in objs:
        o.hide_render = hidden


def _prepare(built, palette, tint=kit.ENV_SHADOW_TINT):
    mat = toon.toon_material(palette, tint=tint)
    all_objs = []
    for p, obj, objs in built:
        for o in objs + getattr(p, "_lods", [])[1:]:
            o.data.materials[0] = mat
            if p.outline and o in objs:
                toon.add_outline(o)
        all_objs += objs
    return mat, all_objs


# ---------------------------------------------------------------- thumbnails and sheet
def thumbnails(built, thumbs_dir, size=400):
    scene = bpy.context.scene
    toon.setup_scene(samples=scene.eevee.taa_render_samples, size=(size, size), bg=SHEET_BG)
    files = []
    disc = None
    for p, obj, objs in built:
        for q, o2, objs2 in built:
            _hide_all(objs2, q is not p)
        cam, center, radius = toon.fit_camera("cam_" + p.name, objs, yaw_deg=32, pitch_deg=24, margin=1.02)
        if disc:
            bpy.data.objects.remove(disc)
        disc = toon.ground_disc(max(radius * 1.15, 0.6), color="#262931")
        tris = p.triangles() + sum(c.triangles() for c, _ in getattr(p, "children", []))
        label = toon.text(p.name, (-0.33, -0.30, -1.0), 0.034, color="#f2efe6", rot=(0, 0, 0), align="LEFT", parent=cam)
        sub = toon.text(f"{tris} tris", (-0.33, -0.338, -1.0), 0.026, color="#ffd43b", rot=(0, 0, 0), align="LEFT", parent=cam)
        path = os.path.join(thumbs_dir, p.name + ".png")
        toon.render(cam, path)
        files.append(path)
        for t in (label, sub):
            bpy.data.objects.remove(t)
    if disc:
        bpy.data.objects.remove(disc)
    for _, _, objs in built:
        _hide_all(objs, False)
    return files


def sheet(files, out, cols=8, size=400):
    if not files:
        return
    rows = (len(files) + cols - 1) // cols
    layout = "|".join(f"{(i % cols) * size}_{(i // cols) * size}" for i in range(len(files)))
    cmd = [FFMPEG, "-y", "-loglevel", "error"]
    for f in files:
        cmd += ["-i", f]
    cmd += ["-filter_complex", f"xstack=inputs={len(files)}:layout={layout}:fill=0x1b1d22", out]
    subprocess.run(cmd, check=False)


# ---------------------------------------------------------------- scenery helpers
def ground_plane(size=400, color=GRASS, z=-0.01, name="Ground"):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    g = bpy.context.active_object
    g.name = name
    g.data.materials.append(toon.flat_material(name + "_mat", color))
    return g


def instance(src_obj, loc, rot_z=0.0, name=None, scale=1.0):
    o = bpy.data.objects.new(name or (src_obj.name + "_i"), src_obj.data)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (0, 0, math.radians(rot_z))
    o.scale = (scale, scale, scale)
    for m in src_obj.modifiers:
        if m.type == "SOLIDIFY":
            toon.add_outline(o)
    for c in src_obj.children:
        ci = bpy.data.objects.new(c.name + "_i", c.data)
        bpy.context.scene.collection.objects.link(ci)
        ci.parent = o
        ci.location = c.location
    return o


def cutaway(src_obj, z_cut, name):
    """Copy of a building with everything above z_cut removed (no caps), to see inside."""
    mesh = src_obj.data.copy()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z_cut), plane_no=(0, 0, 1), clear_outer=True)
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return o


def collider_objects(p, offset=Vector((0, 0, 0)), z_cut=None):
    """Translucent boxes and hulls for the colliders of prop p (Blender space), with wire edges."""
    fill = toon.flat_material("col_fill", "#ffd43b", alpha=0.28)
    edge = toon.flat_material("col_edge", "#ff8a3d")
    objs = []
    colors = {"stairs": "#ff8a3d", "floor": "#7fd1ff", "ramp": "#7fd1ff", "berm": "#7fd1ff"}
    for i, c in enumerate(p.colliders):
        bm = bmesh.new()
        if c["type"] == "box":
            bmesh.ops.create_cube(bm, size=1.0)
            m = Matrix.Translation(c["c"]) @ c["q"].to_matrix().to_4x4() @ Matrix.Diagonal((*(c["h"] * 2), 1.0))
            bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        elif c["type"] == "hull":
            for pt in c["points"]:
                bm.verts.new(pt)
            res = bmesh.ops.convex_hull(bm, input=list(bm.verts))
            junk = list({*res["geom_interior"], *res["geom_unused"]})
            bmesh.ops.delete(bm, geom=[g for g in junk if isinstance(g, bmesh.types.BMVert)], context="VERTS")
        else:
            seg = 8 if c["type"] == "cylinder" else 8
            bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=c["r"], radius2=c["r"],
                                  depth=2 * c["halfHeight"] + (2 * c["r"] if c["type"] == "capsule" else 0))
            m = Matrix.Translation(c["c"]) @ c["q"].to_matrix().to_4x4()
            bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        bmesh.ops.translate(bm, vec=offset, verts=bm.verts)
        if z_cut is not None:
            geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z_cut), plane_no=(0, 0, 1), clear_outer=True)
        me = bpy.data.meshes.new(f"col_{p.name}_{i}")
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(o)
        col = colors.get(c["kind"], "#ffd43b")
        o.data.materials.append(toon.flat_material("colf_" + col, col, alpha=0.3) if col != "#ffd43b" else fill)
        o.data.materials.append(edge)
        w = o.modifiers.new("Wire", "WIREFRAME")
        w.thickness = 0.03
        w.use_replace = False
        w.material_offset = 1
        objs.append(o)
    return objs


def by_name(built):
    return {p.name: (p, obj, objs) for p, obj, objs in built}


# ---------------------------------------------------------------- close-ups
CLOSEUPS = {
    # name: (yaw, pitch, lens, cutaway z or None)
    "farmhouse": (30, 18, 40, 4.4),
    "townhouse": (-32, 18, 40, 4.4),
    "house_ruined": (35, 26, 40, 4.4),
    "church": (32, 14, 35, 8.0),
    "barn": (-35, 20, 40, 4.3),
    "lighthouse": (30, 10, 40, None),
    "bridge_stone": (55, 22, 40, None),
    "bunker_pillbox": (200, 28, 40, 1.9),
    "tank_wreck": (40, 20, 50, None),
    "truck_wreck": (-40, 20, 50, None),
    "landing_craft": (35, 30, 45, None),
}


LIFT = {"bridge_stone": 3.4}
# the collider overlay cuts lower than the cutaway, to show door gaps and stairs on the ground floor
COLLIDER_CUT = {"farmhouse": 2.6, "townhouse": 2.6, "house_ruined": 2.6, "barn": 2.4, "church": 4.0}


def closeups(built, renders_dir):
    names = by_name(built)
    toon.setup_scene(samples=bpy.context.scene.eevee.taa_render_samples, size=(1280, 960), bg=SKY)
    ground = ground_plane()
    for _, _, objs in built:
        _hide_all(objs, True)
    for name, (yaw, pitch, lens, zc) in CLOSEUPS.items():
        if name not in names:
            continue
        p, obj, objs = names[name]
        _hide_all(objs, False)
        obj.location.z = LIFT.get(name, 0.0)
        bpy.context.view_layer.update()
        cam, _, _ = toon.fit_camera("close_" + name, objs, yaw_deg=yaw, pitch_deg=pitch, lens=lens, margin=0.95, aspect=0.75)
        toon.render(cam, os.path.join(renders_dir, f"closeup_{name}.png"))
        if zc is not None:
            # cutaway with the colliders drawn over it, from higher up
            _hide_all(objs, True)
            cut = cutaway(obj, zc, name + "_cut")
            cut.data.materials[0] = obj.data.materials[0]
            cam2, _, _ = toon.fit_camera("cut_" + name, [cut], yaw_deg=yaw, pitch_deg=55, lens=lens, margin=0.8, aspect=0.75)
            toon.render(cam2, os.path.join(renders_dir, f"cutaway_{name}.png"))
            bpy.data.objects.remove(cut)
            zc2 = COLLIDER_CUT.get(name, zc)
            cut = cutaway(obj, zc2, name + "_cut2")
            cut.data.materials[0] = obj.data.materials[0]
            toon.render(cam2, os.path.join(renders_dir, f"cutaway_ground_{name}.png"))
            cols = collider_objects(p, z_cut=zc2)
            toon.render(cam2, os.path.join(renders_dir, f"colliders_{name}.png"))
            for o in cols + [cut]:
                bpy.data.objects.remove(o)
        obj.location.z = 0.0
        _hide_all(objs, True)
    # trench set assembled from the kit tiles
    if all(n in names for n in ("trench_straight", "trench_corner", "trench_end")):
        tmp = []
        layout = [("trench_end", (0, -8, 0), 180), ("trench_straight", (0, -4, 0), 0), ("trench_straight", (0, 0, 0), 0),
                  ("trench_corner", (0, 4, 0), 0), ("trench_straight", (4, 4, 0), 90), ("trench_corner", (8, 4, 0), 180),
                  ("trench_straight", (8, 8, 0), 0), ("trench_end", (8, 12, 0), 0)]
        for n, loc, rz in layout:
            tmp.append(instance(names[n][1], loc, rz))
        for n, loc in (("sandbag_corner", (-3.6, -2, 0)), ("barbed_wire", (-5.5, 2, 0)), ("barbed_wire", (-5.5, 5.2, 0)), ("ammo_box", (0.2, 0.8, 0.0)), ("crate_small", (8.1, 7.0, 0.0))):
            if n in names:
                tmp.append(instance(names[n][1], loc, 90 if n == "barbed_wire" else 0))
        cam = toon.orbit_camera("cam_trench", (3.5, 2.5, 0.5), 21, -60, 38, lens=40)
        toon.render(cam, os.path.join(renders_dir, "closeup_trench_set.png"))
        for o in tmp:
            bpy.data.objects.remove(o)
    bpy.data.objects.remove(ground)
    for _, _, objs in built:
        _hide_all(objs, False)


def plane_shot(built, renders_dir):
    names = by_name(built)
    if "transport_plane" not in names:
        return
    p, obj, objs = names["transport_plane"]
    for _, _, o2 in built:
        _hide_all(o2, True)
    _hide_all(objs, False)
    toon.setup_scene(samples=bpy.context.scene.eevee.taa_render_samples, size=(1600, 900), bg=SKY)
    obj.location = (0, 0, 0)
    cam = toon.orbit_camera("cam_plane", (0, 0.5, 0.3), 44, 40, 18, lens=45)
    toon.render(cam, os.path.join(renders_dir, "closeup_transport_plane.png"))
    cam = toon.orbit_camera("cam_plane_low", (0, 0, 0.0), 36, 160, -22, lens=45)
    toon.render(cam, os.path.join(renders_dir, "closeup_transport_plane_below.png"))
    for _, _, o2 in built:
        _hide_all(o2, False)


# ---------------------------------------------------------------- street scene with the duck
def import_duck(game_dir):
    path = os.path.join(game_dir, "art", "export", "duck.glb")
    if not os.path.exists(path):
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    meshes = [o for o in new if o.type == "MESH"]
    for m in meshes:
        img = None
        for mat in m.data.materials:
            if mat and mat.use_nodes:
                for n in mat.node_tree.nodes:
                    if n.type == "TEX_IMAGE" and n.image:
                        img = n.image
        if img:
            m.data.materials[0] = toon.toon_material(img, name="DuckToon")
        toon.add_outline(m)
    if arm:
        relax_arms(arm)
    root = arm or meshes[0]
    while root.parent:
        root = root.parent
    root["_imported"] = [o.name for o in new]
    return root


def relax_arms(arm):
    """Drop the T-pose arms about 70 degrees so the duck stands naturally in the scene."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for name, ang in (("LeftArm", 68), ("RightArm", -68)):
        pb = arm.pose.bones.get(name)
        if not pb:
            continue
        head = pb.head.copy()
        rot = Matrix.Translation(head) @ Matrix.Rotation(math.radians(ang), 4, "Y") @ Matrix.Translation(-head)
        pb.matrix = rot @ pb.matrix
        bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")


def street_scene(built, renders_dir, game_dir, out_name=None, door_shot=True):
    names = by_name(built)
    need = ["farmhouse", "sandbag_wall", "tank_wreck", "church"]
    if not all(n in names for n in need):
        return
    for _, _, objs in built:
        _hide_all(objs, True)
    toon.setup_scene(samples=bpy.context.scene.eevee.taa_render_samples, size=(1920, 1080), bg=SKY)
    tmp = [ground_plane(600)]
    # road along X in front of the farmhouse, and a lane toward the church
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -9.5, 0.0))
    road = bpy.context.active_object
    road.scale = (160, 7.5, 1)
    road.data.materials.append(toon.flat_material("road", ROAD))
    tmp.append(road)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(19, 18, 0.0))
    lane = bpy.context.active_object
    lane.scale = (5, 50, 1)
    lane.data.materials.append(toon.flat_material("road2", ROAD))
    tmp.append(lane)
    place = [
        ("farmhouse", (0, 0, 0), 0), ("church", (-5, 60, 0), 150), ("tank_wreck", (11, -9.5, 0), 72),
        ("sandbag_wall", (-3.2, -14.2, 0), 0), ("sandbag_corner", (-6.4, -14.2, 0), 0), ("crate_small", (-1.2, -15.6, 0), 15),
        ("crate_large", (5.6, -6.3, 0), -8), ("ammo_box", (-0.4, -15.4, 0.0), 30), ("fuel_barrel", (6.8, -5.0, 0), 0),
        ("fuel_barrel", (7.5, -5.6, 0), 40), ("signpost", (-7.5, -6.0, 0), 20), ("wood_fence", (-9.5, -4.6, 0), 0),
        ("wood_fence", (-12.5, -4.6, 0), 0), ("tree_oak", (-14, 6, 0), 0), ("tree_poplar", (36, 30, 0), 0),
        ("tree_poplar", (40, 34, 0), 0), ("tree_apple", (-25, 0, 0), 40), ("bush_round", (-6, -3.5, 0), 0),
        ("stone_wall", (8.5, 3.2, 0), 90), ("stone_wall", (8.5, 7.2, 0), 90), ("house_ruined", (-22, 12, 0), 10),
        ("czech_hedgehog", (17, -15, 0), 20), ("czech_hedgehog", (-16, -15, 0), 70), ("barbed_wire", (-12, -14.5, 0), 0),
        ("hedgerow", (40, 5, 0), 90), ("hedgerow", (-28, -2, 0), 90), ("crater", (3, -21, 0), 0),
        ("rubble_pile", (-16, 4, 0), 0), ("townhouse", (16, 30, 0), 180), ("barn", (-40, 40, 0), 70),
    ]
    for n, loc, rz in place:
        if n in names:
            tmp.append(instance(names[n][1], loc, rz))
    duck = import_duck(game_dir)
    if duck:
        duck.location = (-2.6, -16.0, 0)
        duck.rotation_euler = (0, 0, math.radians(-28))
    cam = toon.camera("cam_street", (-11.5, -31, 2.4), (5, 6, 4.6), lens=30)
    toon.render(cam, out_name or os.path.join(renders_dir, "street_scene.png"))
    # a scale check: the duck at the farmhouse door
    if duck and door_shot:
        duck.location = (-1.5, -4.6, 0.15)
        duck.rotation_euler = (0, 0, math.radians(-20))
        cam = toon.camera("cam_door", (2.5, -12.5, 1.7), (-0.6, -3.8, 1.5), lens=35)
        toon.render(cam, os.path.join(renders_dir, "scale_duck_at_door.png"))
    for o in tmp:
        bpy.data.objects.remove(o)
    for _, _, objs in built:
        _hide_all(objs, False)


LOD_SHEET = ["hedgerow", "tree_oak", "tree_poplar", "tree_apple", "bush_round", "farmhouse", "townhouse", "house_ruined",
             "church", "barn", "bunker_pillbox", "tank_wreck", "truck_wreck", "trench_corner", "sandbag_corner", "stone_wall"]


def lod_sheet(built, renders_dir, thumbs_dir, size=300):
    """Each row: one prop at LOD0, LOD1, LOD2 from the same camera, with triangle counts."""
    names = by_name(built)
    toon.setup_scene(samples=bpy.context.scene.eevee.taa_render_samples, size=(size, size), bg=SHEET_BG)
    for _, _, objs in built:
        _hide_all(objs, True)
    files = []
    disc = None
    for n in LOD_SHEET:
        if n not in names:
            continue
        p, obj, objs = names[n]
        lods = p._lods
        cam, center, radius = toon.fit_camera("lodcam_" + n, [lods[0]], yaw_deg=32, pitch_deg=22, margin=1.02)
        if disc:
            bpy.data.objects.remove(disc)
        disc = toon.ground_disc(max(radius * 1.15, 0.6), color="#262931")
        tris = [p.triangles()] + [lp.triangles() for lp in p._lod_props]
        for k in range(3):
            for o in lods:
                o.hide_render = True
            if k < len(lods):
                lods[k].hide_render = False
            label = toon.text(f"{n}  LOD{k}" if k < len(lods) else f"{n}  (culled)", (-0.33, -0.30, -1.0), 0.032, color="#f2efe6", rot=(0, 0, 0), align="LEFT", parent=cam)
            sub = toon.text(f"{tris[k]} tris" if k < len(tris) else "", (-0.33, -0.338, -1.0), 0.028, color="#ffd43b", rot=(0, 0, 0), align="LEFT", parent=cam)
            path = os.path.join(thumbs_dir, f"lod_{n}_{k}.png")
            toon.render(cam, path)
            files.append(path)
            for t in (label, sub):
                bpy.data.objects.remove(t)
        for o in lods:
            o.hide_render = True
    if disc:
        bpy.data.objects.remove(disc)
    for p, _, objs in built:
        _hide_all(objs, False)
        for o in getattr(p, "_lods", [])[1:]:
            o.hide_render = True
    sheet(files, os.path.join(renders_dir, "lod_sheet.png"), cols=6, size=size)


def tint_compare(built, palette, renders_dir, game_dir):
    """The street scene with the character tint on everything (left) and with the environment tint (right)."""
    out = []
    for tint, tag in ((kit.TOON_SHADOW_TINT, "warm"), (kit.ENV_SHADOW_TINT, "env")):
        mat = toon.toon_material(palette, name="tint_" + tag, tint=tint)
        for p, obj, objs in built:
            for o in objs:
                o.data.materials[0] = mat
        path = os.path.join(renders_dir, f"_tint_{tag}.png")
        street_scene(built, renders_dir, game_dir, out_name=path, door_shot=False)
        out.append(path)
    cmd = [FFMPEG, "-y", "-loglevel", "error", "-i", out[0], "-i", out[1], "-filter_complex",
           "[0]scale=960:540[a];[1]scale=960:540[b];[a][b]hstack", os.path.join(renders_dir, "tint_compare.png")]
    subprocess.run(cmd, check=False)
    for f in out:
        os.remove(f)
    _prepare_mat = toon.toon_material(palette, name="tint_restore", tint=kit.ENV_SHADOW_TINT)
    for p, obj, objs in built:
        for o in objs:
            o.data.materials[0] = _prepare_mat


def run(palette, built, renders_dir, thumbs_dir, quick=False, shots=None, game_dir=None):
    toon.setup_scene(samples=8 if quick else 32)
    _prepare(built, palette)

    def want(s):
        return shots is None or s in shots

    if want("sheet"):
        files = thumbnails(built, thumbs_dir)
        sheet(files, os.path.join(renders_dir, "kit_overview.png"))
    if want("closeups"):
        closeups(built, renders_dir)
    if want("plane"):
        plane_shot(built, renders_dir)
    if want("street"):
        street_scene(built, renders_dir, game_dir)
    if want("lods"):
        lod_sheet(built, renders_dir, thumbs_dir)
    if want("tint"):
        tint_compare(built, palette, renders_dir, game_dir)
