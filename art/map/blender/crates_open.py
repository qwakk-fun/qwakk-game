"""Openable loot crates for the game: the small crate, the large crate and the ammo box, each as a body
with an open top (a straw bed inside for the loot to rest on) and a separate lid whose origin sits on the
hinge, so the engine swings it open around its local X axis.

The sizes, colors and yellow rings match the map props (`crate_small`, `crate_large`, `ammo_box` in
props_military.py), which keep their colliders: the game draws these in place of those props at every
container loot point and animates the lid from the server's open state.

Run (from the repo root):
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/map/blender/crates_open.py

Output: apps/client/public/models/crates/crates.glb with the nodes `<variant>_body` and `<variant>_lid`
(the lid is a child of the body; its translation is the hinge, at the back top edge, glTF -Z side), for
the variants `small`, `large` and `ammo`. Uncompressed (a few thousand triangles in all).
"""

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import kit  # noqa: E402
from kit import Prop  # noqa: E402
from props_military import ring_decal  # noqa: E402

GAME = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
OUT_DIR = os.path.join(GAME, "apps", "client", "public", "models", "crates")

WALL = 0.05


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


def open_box(p, sx, sy, h, cell, band_cell, post_cell=None, bands=True):
    """Four walls and a floor, open at the top. Blender space: front -Y, origin on the ground."""
    t = WALL
    p.box((sx, t, h), (0, -sy / 2 + t / 2, h / 2), cell, bottom=True)          # front
    p.box((sx, t, h), (0, sy / 2 - t / 2, h / 2), cell, bottom=True)           # back
    p.box((t, sy - 2 * t, h), (-sx / 2 + t / 2, 0, h / 2), cell, bottom=True)  # left
    p.box((t, sy - 2 * t, h), (sx / 2 - t / 2, 0, h / 2), cell, bottom=True)   # right
    p.box((sx - 2 * t, sy - 2 * t, 0.04), (0, 0, 0.02), cell)                   # floor
    if bands:
        # Dark bands around the outside at the bottom and the rim: four strips each, so the top stays open.
        band = min(0.11, h * 0.18)
        o = 0.02
        for z in (band / 2, h - band / 2):
            for side in (-1, 1):
                p.box((sx + 2 * o, t + o, band), (0, side * (sy / 2 - (t - o) / 2), z), band_cell, bottom=True)
                p.box((t + o, sy + 2 * o, band), (side * (sx / 2 - (t - o) / 2), 0, z), band_cell, bottom=True)
    if post_cell:
        for x in (-1, 1):
            for y in (-1, 1):
                p.box((0.1, 0.1, h * 0.7), (x * (sx / 2 - 0.03), y * (sy / 2 - 0.03), h / 2), post_cell, bottom=True)


def straw(p, sx, sy, z, cell="hay", cell2="hay_dark"):
    """A packing-straw bed inside the crate at height z: the loot rests on it."""
    t = WALL
    p.box((sx - 2 * t - 0.01, sy - 2 * t - 0.01, 0.05), (0, 0, z - 0.025), cell)
    rng = kit.Rng(len(p.name) * 7 + int(sx * 100))
    for _ in range(6):
        x = rng.range(-(sx / 2 - 0.12), sx / 2 - 0.12)
        y = rng.range(-(sy / 2 - 0.12), sy / 2 - 0.12)
        p.box((rng.range(0.12, 0.22), rng.range(0.05, 0.09), 0.03), (x, y, z + 0.01), cell2, rot_z=rng.range(0, 180))


def lid_panel(p, sx, sy, t, cell, band_cell, ring_r=None):
    """The lid in hinge space: the hinge line is the X axis at the origin, the lid reaches toward -Y (the front)."""
    o = 0.02
    p.box((sx + o, sy + o, t), (0, -(sy + o) / 2, t / 2), cell, bottom=True, top=cell)
    for y in (-0.06, -(sy + o) + 0.06):
        p.box((sx + o + 0.02, 0.1, t + 0.02), (0, y, t / 2), band_cell, bottom=True)
    if ring_r:
        ring_decal(p, (0, -(sy + o) / 2, t + 0.005), (0, 0, 0), ring_r * 0.8, ring_r * 0.5, "yellow", depth=0.02)


def crate(name, sx, sy, sz, ring_r, handles=False):
    lid_t = 0.07
    h = sz - lid_t
    body = Prop(f"{name}_body", "loot")
    open_box(body, sx, sy, h, "wood_light", "wood_dark", post_cell="wood_dark")
    straw(body, sx, sy, h * 0.62)
    for side in (-1, 1):
        ring_decal(body, (0, side * (sy / 2 + 0.025), h / 2), (side * -90, 0, 0), ring_r, ring_r * 0.62, "yellow", depth=0.025)
    if handles:
        for side in (-1, 1):
            body.tube((side * (sx / 2 + 0.02), -0.18, h * 0.62), (side * (sx / 2 + 0.02), 0.18, h * 0.62), 0.035, "khaki", segs=4)
    lid = Prop(f"{name}_lid", "loot")
    lid_panel(lid, sx, sy, lid_t, "wood", "wood_dark", ring_r=ring_r)
    # The hinge: the back top edge of the body (Blender +Y is the back).
    return body, lid, (0.0, sy / 2 + 0.01, h)


def ammo_box():
    sx, sy, sz = 0.5, 0.22, 0.3
    lid_t = 0.05
    h = sz - lid_t
    body = Prop("ammo_body", "loot")
    open_box(body, sx, sy, h, "olive", "olive_dark", bands=False)
    straw(body, sx, sy, h * 0.55, cell="olive_dark", cell2="steel_dark")
    body.box((sx + 0.004, sy + 0.012, 0.05), (0, 0, h * 0.55), "yellow", bottom=True)
    body.box((0.06, 0.03, 0.07), (0.17, -sy / 2 - 0.012, h - 0.05), "steel", bottom=True)
    lid = Prop("ammo_lid", "loot")
    o = 0.02
    lid.box((sx + o, sy + o, lid_t), (0, -(sy + o) / 2, lid_t / 2), "olive_dark", bottom=True)
    lid.tube((-0.11, -(sy + o) / 2, lid_t + 0.045), (0.11, -(sy + o) / 2, lid_t + 0.045), 0.018, "steel_dark", segs=4)
    for x in (-0.11, 0.11):
        lid.box((0.025, 0.025, 0.05), (x, -(sy + o) / 2, lid_t + 0.02), "steel_dark")
    return body, lid, (0.0, sy / 2 + 0.01, h)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    # The shared kit palette (embedded in the GLB; the PNG itself is a throwaway).
    palette = kit.build_palette(os.path.join(tempfile.gettempdir(), "qwakk_crates_palette.png"))
    mat = export_material(palette)
    parts = [
        crate("small", 0.75, 0.75, 0.7, 0.2),
        crate("large", 1.45, 0.85, 0.85, 0.26, handles=True),
        ammo_box(),
    ]
    objs = []
    for body, lid, hinge in parts:
        bo = body.to_object(mat)
        lo = lid.to_object(mat)
        lo.parent = bo
        lo.location = hinge
        objs += [bo, lo]
        print(f"CRATE {body.name:12s} {body.triangles():5d} tris body, {lid.triangles():4d} tris lid")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT_DIR, "crates.glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
        export_animations=False, export_extras=False, export_morph=False, export_skins=False,
    )
    print("WROTE", path, os.path.getsize(path), "bytes")


main()
