"""Review renders of a small map_v1 arena (the deathmatch maps, e.g. canard-quarter): a top-down plan with the
play area ring, callouts and the deathmatch spawns (arrows show the spawn yaw), an oblique overview and
eye-level street shots with ducks for scale. Uses the terrain and prop helpers of render_map.py.

Run after layout/gen_quarter.py (art/map/build.sh does both):
  Blender -b --factory-startup -P qwakk-game/art/map/blender/render_arena.py -- [--map canard-quarter] [--quick]
Writes art/map/renders/<map id>/topdown.png, overview.png and eye_*.png.
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import kit  # noqa: E402
import toon  # noqa: E402
import render_map as RM  # noqa: E402
import render_kit  # noqa: E402
import props_military  # noqa: E402
import props_buildings  # noqa: E402
import props_country  # noqa: E402
import props_vehicles  # noqa: E402

MAP_ART = os.path.dirname(HERE)
GAME = os.path.dirname(os.path.dirname(MAP_ART))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
QUICK = "--quick" in argv
MAP_ID = argv[argv.index("--map") + 1] if "--map" in argv else "canard-quarter"
EXPORT = os.path.join(MAP_ART, "export", MAP_ID)
RENDERS = os.path.join(MAP_ART, "renders", MAP_ID)
SKY = "#9fd7f2"

# Eye-level shots per map: (name, eye x, z, height above ground, target x, z, height above ground, lens)
SHOTS = {
    "canard-quarter": [
        ("eye_street_east", -84, 1.5, 1.6, 10, -8, 4.0, 32),          # down the Rue du Canard into the square
        ("eye_square_church", 9, -1.0, 1.6, -1, -30, 7.0, 28),        # the square, the church front and tower
        ("eye_trenches_nw", 76, 58, 1.6, 10, 24, 3.5, 30),            # past the trench toward the farm and the square
        ("eye_bombed_ne", -66, 54, 1.6, -14, 12, 4.0, 30),            # across the bombed lots toward the shop corner
        ("eye_orchard_lane", -40, -74, 1.6, -22, -16, 4.0, 30),       # down the orchard track toward the bakery and the square
    ],
}
LABEL_OFFSETS = {"canard-quarter": {"ruin": (4, -16), "square": (0, -4), "bakery": (-6, -10), "church": (0, -6)}}
DUCKS = 6          # ducks placed on the first spawns for scale in the eye-level shots


def prop_meshes(names):
    palette = kit.build_palette(os.path.join(bpy.app.tempdir or "/tmp", "arena_palette.png"))
    mat = toon.toon_material(palette, tint=kit.ENV_SHADOW_TINT)
    builders = {fn.__name__: fn for fn in props_military.BUILDERS + props_buildings.BUILDERS + props_country.BUILDERS + props_vehicles.BUILDERS}
    meshes = {}
    for n in names:
        obj = builders[n]().to_object(mat)
        obj.hide_render = True
        meshes[n] = obj.data
    return meshes


def spawn_marker(x, y, z, yaw, color="#ffd43b"):
    """A dot and an arrow in the spawn's look direction (-sin yaw, -cos yaw), drawn above everything."""
    out = []
    bpy.ops.mesh.primitive_circle_add(vertices=10, radius=1.6, fill_type="NGON", location=(x, -z, 60.0))
    dot = bpy.context.active_object
    dot.data.materials.append(toon.flat_material("spawn_dot", color))
    out.append(dot)
    dx, dz = -math.sin(yaw), -math.cos(yaw)
    out += RM.polyline("spawn_dir", [(x, z), (x + dx * 5.5, z + dz * 5.5)], 0.8, color, 60.5)
    bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=1.4, depth=0.2, location=(x + dx * 6.0, -(z + dz * 6.0), 60.6))
    tip = bpy.context.active_object
    tip.rotation_euler = (0, 0, math.atan2(-dz, dx) - math.pi / 2)
    tip.data.materials.append(toon.flat_material("spawn_tip", color))
    out.append(tip)
    return out


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    RM.EXPORT = EXPORT                      # render_map's terrain helpers read from this folder
    os.makedirs(RENDERS, exist_ok=True)
    with open(os.path.join(EXPORT, "map_v1.json")) as f:
        doc = json.load(f)
    size_m = doc["size"]
    px = 2000
    strip = 260
    toon.setup_scene(samples=4 if QUICK else 16, size=(px, px + strip), bg="#1b1d22")
    RM.terrain_object(doc)
    t = doc["terrain"]
    n = t["cells"] + 1
    hs = RM.read_heights(t)
    x0, z0 = t["origin"]
    cs = t["cellSize"]

    def h_at(x, z):
        fx = min(n - 1 - 1e-6, max(0.0, (x - x0) / cs))
        fz = min(n - 1 - 1e-6, max(0.0, (z - z0) / cs))
        c, r = int(fx), int(fz)
        u, v = fx - c, fz - r
        h00, h01 = hs[r * n + c], hs[r * n + c + 1]
        h10, h11 = hs[(r + 1) * n + c], hs[(r + 1) * n + c + 1]
        if u + v <= 1:
            return (h00 + (h01 - h00) * u + (h10 - h00) * v) / 100.0
        return (h11 + (h10 - h11) * (1 - u) + (h01 - h11) * (1 - v)) / 100.0

    for rd in doc["roads"]:
        RM.ribbon("Road_" + rd["id"], rd["pts"], rd["width"], RM.GROUND_COLORS["dirt_road"], h_at, z_off=0.06)
    names = sorted({p["prop"] for p in doc["props"]})
    meshes = prop_meshes(names)
    for p in doc["props"]:
        o = bpy.data.objects.new(p["prop"], meshes[p["prop"]])
        bpy.context.scene.collection.objects.link(o)
        o.location = RM.g2b(p["x"], p["y"], p["z"])
        o.rotation_euler = (0, 0, p["rotY"])
        s = p.get("scale", 1.0)
        o.scale = (s, s, s)

    # ---- top-down plan with overlays
    overlay = []
    ring = doc.get("playArea", {}).get("ring")
    if ring:
        overlay += RM.polyline("ring", ring, 1.0, "#ff8a3d", 59.0, closed=True, dash=4.0)
    for zn in doc.get("zones", []):
        if zn["poly"]:
            cx = sum(p[0] for p in zn["poly"]) / len(zn["poly"])
            cz = sum(p[1] for p in zn["poly"]) / len(zn["poly"])
            ox, oz = LABEL_OFFSETS.get(MAP_ID, {}).get(zn["id"], (0, 0))
            overlay += RM.label(zn["name"], cx + ox, cz + oz, 4.2, height=62.0)
    for x, y, z, yaw in doc.get("dmSpawns", []):
        overlay += spawn_marker(x, y, z, yaw)
    half = size_m / 2
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -(half + strip / px * size_m / 2), 65.5))
    bg = bpy.context.active_object
    bg.scale = (size_m * 1.2, strip / px * size_m, 1)
    bg.data.materials.append(toon.flat_material("strip", "#1b1d22"))
    overlay.append(bg)
    st = doc["stats"]
    ly = half + 8
    overlay += RM.label(f"{doc['name']} ({MAP_ID}), deathmatch", -half + 4, ly, 7.0, align="LEFT", height=66.0)
    overlay += RM.label(f"terrain {size_m:.0f} x {size_m:.0f} m, play area about {st['playAcrossM'][0]} x {st['playAcrossM'][1]} m inside the hedge ring (orange)",
                        -half + 4, ly + 9, 3.6, color="#ffd43b", align="LEFT", height=66.0)
    overlay += RM.label(f"{st['props']} props, {st['dmSpawns']} spawns (yellow, arrow = facing), north up",
                        -half + 4, ly + 15, 3.6, color="#f2efe6", align="LEFT", height=66.0)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(half - 30, -(ly + 12), 66.5))
    bar = bpy.context.active_object
    bar.scale = (50, 1.2, 1)
    bar.data.materials.append(toon.flat_material("bar", RM.LABEL))
    overlay.append(bar)
    overlay += RM.label("50 m", half - 30, ly + 17, 3.4, height=66.0)
    span_z = size_m * (px + strip) / px
    cam = toon.camera("TopCam", (0, -(span_z / 2 - half), 300), (0, -(span_z / 2 - half), 0), ortho_scale=span_z)
    cam.rotation_euler = (0, 0, 0)
    toon.render(cam, os.path.join(RENDERS, "topdown.png"))
    for o in overlay:
        bpy.data.objects.remove(o)

    # ---- oblique overview and eye-level shots
    toon.setup_scene(samples=4 if QUICK else 24, size=(1920, 1080), bg=SKY)
    cam = toon.camera("Overview", RM.g2b(-120, 95, 150), RM.g2b(6, 4, -6), lens=30)
    toon.render(cam, os.path.join(RENDERS, "overview.png"))
    ducks = []
    for k, (x, y, z, yaw) in enumerate(doc.get("dmSpawns", [])[:DUCKS] + [[-60, h_at(-60, 1.5), 1.5, 0.3], [3, h_at(3, -6), -6, 2.6]]):
        d = render_kit.import_duck(GAME)
        if not d:
            break
        d.location = RM.g2b(x, h_at(x, z), z)
        d.rotation_euler = (0, 0, yaw + math.pi)      # the duck model faces +Z (glTF), the player yaw looks along -z
        ducks.append(d)
    for name, ex, ez, eh, tx, tz, th, lens in SHOTS.get(MAP_ID, []):
        cam = toon.camera(name, RM.g2b(ex, h_at(ex, ez) + eh, ez), RM.g2b(tx, h_at(tx, tz) + th, tz), lens=lens)
        toon.render(cam, os.path.join(RENDERS, name + ".png"))
    print("RENDERED", RENDERS)


if __name__ == "__main__":
    main()
