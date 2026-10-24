"""Review renders of Pond Keep (map id pond-keep, art/map/layout/gen_pond.py): a top-down plan with the Hunt Season
markup drawn over it (spawns, perches, cannons, raft lanes, trenches, the wall walk, the gate and the drawbridge),
eye-level shots from the wall walk and from a watchtower, beauty shots of the castle and a sheet of the animated
pieces (gate states, cannon poses, drawbridge down and up, the lever). The animated GLBs are drawn at their
`raid.props` placements, the drawbridge down and the gate intact.

Run after layout/gen_pond.py (art/map/build.sh does both):
  Blender -b --factory-startup -P qwakk-game/art/map/blender/render_pond.py -- [--quick] [--pond-shots topdown,eye,beauty,pieces]
Writes art/map/renders/pond-keep/*.png.
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import kit  # noqa: E402
import toon  # noqa: E402
import render_map as RM  # noqa: E402
import render_kit  # noqa: E402
import props_military  # noqa: E402
import props_buildings  # noqa: E402
import props_country  # noqa: E402
import props_vehicles  # noqa: E402
import castle  # noqa: E402
import props_pond  # noqa: E402

MAP_ART = os.path.dirname(HERE)
GAME = os.path.dirname(os.path.dirname(MAP_ART))
MAP_ID = "pond-keep"
EXPORT = os.path.join(MAP_ART, "export", MAP_ID)
RENDERS = os.path.join(MAP_ART, "renders", MAP_ID)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
QUICK = "--quick" in argv
ONLY = set(argv[argv.index("--pond-shots") + 1].split(",")) if "--pond-shots" in argv else None
SKY = "#9fd7f2"
WATER_COLOR = "#3fa6c8"

BUILDERS = {fn.__name__: fn for fn in props_military.BUILDERS + props_buildings.BUILDERS + props_country.BUILDERS + props_vehicles.BUILDERS
            + castle.BUILDERS + props_pond.BUILDERS}


def want(name):
    return ONLY is None or name in ONLY


def g2b(x, y, z):
    return (x, -z, y)


class Kit:
    def __init__(self):
        palette = kit.build_palette(os.path.join(bpy.app.tempdir or "/tmp", "pond_palette.png"))
        self.mat = toon.toon_material(palette, tint=kit.ENV_SHADOW_TINT)
        self.meshes = {}

    def mesh(self, name):
        if name not in self.meshes:
            obj = BUILDERS[name]().to_object(self.mat)
            obj.hide_render = True
            obj.hide_viewport = True
            self.meshes[name] = obj.data
        return self.meshes[name]

    def instance(self, name, loc, rot_z, scale=1.0):
        o = bpy.data.objects.new(name, self.mesh(name))
        bpy.context.scene.collection.objects.link(o)
        o.location = loc
        o.rotation_euler = (0, 0, rot_z)
        o.scale = (scale, scale, scale)
        return o

    def animated(self, name, loc, rot_z, show=None, pose=None):
        """An animated prop as an object tree (root mesh, pivots, child meshes). `show`: node names to keep
        visible (the gate states); `pose`: {node: (rx, ry, rz)} extra Euler rotation on a pivot."""
        p = BUILDERS[name]()
        root = bpy.data.objects.new(name + "_root", p.to_object(self.mat).data)
        bpy.context.scene.collection.objects.link(root)
        root.location = loc
        root.rotation_euler = (0, 0, rot_z)
        made = [root]

        def add(parent, prop, hidden):
            for child, at in getattr(prop, "children", []):
                pv = bpy.data.objects.new(child.name + "_pv", None)
                bpy.context.scene.collection.objects.link(pv)
                pv.parent = parent
                pv.location = at
                rot = list(child.rot) if getattr(child, "rot", None) else [0.0, 0.0, 0.0]
                if pose and child.name in pose:
                    rot = [a + b for a, b in zip(rot, pose[child.name])]
                pv.rotation_euler = rot
                if getattr(child, "scale", None):
                    pv.scale = child.scale
                made.append(pv)
                hide = hidden or (show is not None and child.name in ("Intact", "Damaged", "Broken", "Planks") and child.name not in show)
                if child.faces:
                    m = child.to_object(self.mat)
                    m.parent = pv
                    m.hide_render = hide
                    made.append(m)
                add(pv, child, hide)
        add(root, p, False)
        return made


def water_plane(size, level):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, level))
    o = bpy.context.active_object
    o.scale = (size, size, 1)
    o.data.materials.append(toon.flat_material("water", WATER_COLOR))
    return o


def marker_arrow(x, z, yaw, color, size=1.6, height=60.0, dot=True):
    """A dot and an arrow along the player yaw (-sin yaw, -cos yaw), drawn above everything."""
    out = []
    if dot:
        bpy.ops.mesh.primitive_circle_add(vertices=10, radius=size, fill_type="NGON", location=(x, -z, height))
        d = bpy.context.active_object
        d.data.materials.append(toon.flat_material("m_" + color, color))
        out.append(d)
    dx, dz = -math.sin(yaw), -math.cos(yaw)
    out += RM.polyline("arr", [(x, z), (x + dx * size * 3.2, z + dz * size * 3.2)], size * 0.45, color, height + 0.5)
    bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=size * 0.85, depth=0.2, location=(x + dx * size * 3.6, -(z + dz * size * 3.6), height + 0.6))
    tip = bpy.context.active_object
    tip.rotation_euler = (0, 0, math.atan2(-dz, dx) - math.pi / 2)
    tip.data.materials.append(toon.flat_material("m_" + color, color))
    out.append(tip)
    return out


def square(x, z, s, color, height):
    bpy.ops.mesh.primitive_plane_add(size=s, location=(x, -z, height))
    o = bpy.context.active_object
    o.data.materials.append(toon.flat_material("sq_" + color, color))
    return o


def legend_row(items, x0, z, height, size=3.2):
    out = []
    x = x0
    for color, text in items:
        out.append(square(x, z, size, color, height))
        out += RM.label(text, x + size * 0.9, z, size * 0.95, align="LEFT", height=height)
        x += size * 1.2 + len(text) * size * 0.62 + 4
    return out


def build_scene(doc, k):
    RM.EXPORT = EXPORT
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
        RM.ribbon("Road_" + rd["id"], rd["pts"], rd["width"], RM.GROUND_COLORS["dirt_road"], h_at, z_off=0.05)
    water_plane(doc["size"] * 1.6, doc["seaLevel"])
    for p in doc["props"]:
        k.instance(p["prop"], g2b(p["x"], p["y"], p["z"]), p["rotY"], p.get("scale", 1.0))
    for d in doc["raid"]["props"]:
        pose = None
        if d["prop"] == "bread_cannon":
            pose = {"Pitch": (math.radians(-6), 0, 0)}
        k.animated(d["prop"], g2b(d["x"], d["y"], d["z"]), d["rotY"], show={"Intact"}, pose=pose)
    return h_at


def topdown(doc, k):
    raid = doc["raid"]
    size_m = 330.0
    px = 2200
    strip = 300
    toon.setup_scene(samples=4 if QUICK else 16, size=(px, px + strip), bg="#1b1d22")
    over = []
    H = 70.0
    ring = doc["playArea"]["ring"]
    over += RM.polyline("ring", ring, 1.2, "#ff8a3d", H - 1, closed=True, dash=4.0)
    for line in raid["trenches"]:
        over += RM.polyline("trench", line, 1.0, "#6b3f20", H - 0.8)
    for line in raid["wallWalk"]:
        over += RM.polyline("walk", [(p[0], p[2]) for p in line], 0.7, "#ffffff", H - 0.6)
    over += RM.polyline("bridge", raid["drawbridge"]["walk"], 0.5, "#ffd43b", H - 0.5, closed=True)
    for lane in raid["raftLanes"]:
        over += RM.polyline("lane", [lane["from"], lane["to"]], 1.1, "#3de0ff", H - 0.4)
        over.append(square(lane["from"][0], lane["from"][1], 2.2, "#3de0ff", H - 0.3))
    keep = raid.get("keep")
    if keep:
        over += RM.polyline("keep", keep, 0.35, "#f2efe6", H - 0.7, closed=True, dash=2.0)
    island = raid.get("island")
    if island:
        over += RM.polyline("island", island, 0.35, "#3de0ff", H - 0.7, closed=True, dash=2.5)
    # the core and its attack ring
    cx, _, cz = raid["core"]
    pts = [(cx + math.cos(a) * raid["coreRadius"], cz + math.sin(a) * raid["coreRadius"]) for a in [2 * math.pi * i / 24 for i in range(24)]]
    over += RM.polyline("core", pts, 0.5, "#ffd43b", H, closed=True)
    g = raid["gate"]
    over += RM.polyline("gate", [(g["x"] - g["width"] / 2, g["z"]), (g["x"] + g["width"] / 2, g["z"])], 0.9, "#ff3d6e", H + 0.2)
    over.append(square(raid["lever"][0], raid["lever"][2], 1.6, "#ff3d6e", H + 0.2))
    for c, u in zip(raid["cannons"], raid["cannonUse"]):
        over.append(square(c[0], c[2], 2.0, "#ffd43b", H + 0.3))
        over += marker_arrow(c[0], c[2], c[3], "#ffd43b", size=0.9, height=H + 0.3, dot=False)
        over.append(square(u[0], u[2], 1.0, "#f2efe6", H + 0.4))
    for s in raid["duckSpawns"]:
        over += marker_arrow(s[0], s[2], s[3], "#ffd43b", size=0.8, height=H + 0.5)
    for s in raid["hunterSpawns"]:
        over += marker_arrow(s[0], s[2], s[3], "#ff3d6e", size=1.3, height=H + 0.5)
    for s in raid["sniperPerches"]:
        over += marker_arrow(s[0], s[2], s[3], "#b06bff", size=1.6, height=H + 0.5)
    for zn in doc["zones"]:
        if zn["id"] in ("meadow", "moat", "courtyard"):
            continue
        xs = [p[0] for p in zn["poly"]]
        zs = [p[1] for p in zn["poly"]]
        lx, lz = sum(xs) / len(xs), sum(zs) / len(zs)
        if "tower" in zn["id"] and "watch" not in zn["id"]:
            continue
        over += RM.label(zn["name"], lx, lz + (7.0 if "trench" in zn["id"] else 0.0), 3.4, height=H + 2.0)
    over += RM.label("Pond Meadow", -40, -105, 3.4, height=H + 2.0)
    # the legend strip
    half = size_m / 2
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -(half + strip / px * size_m / 2), H + 4.5))
    bg = bpy.context.active_object
    bg.scale = (size_m * 1.2, strip / px * size_m, 1)
    bg.data.materials.append(toon.flat_material("strip", "#1b1d22"))
    over.append(bg)
    st = doc["stats"]
    ly = half + 7
    over += RM.label(f"{doc['name']} ({MAP_ID}), Hunt Season", -half + 4, ly, 6.0, align="LEFT", height=H + 5)
    over += RM.label(f"terrain {doc['size']:.0f} m, play area about {st['playAcrossM'][0]} x {st['playAcrossM'][1]} m inside the hedge ring (orange), "
                     f"{st['props']} props, north up", -half + 4, ly + 8, 3.2, color="#f2efe6", align="LEFT", height=H + 5)
    over += legend_row([("#ffd43b", f"duck spawns ({st['duckSpawns']}), cannons"), ("#ff3d6e", f"hunter spawns ({st['hunterSpawns']}), gate, lever"),
                        ("#b06bff", f"sniper perches ({st['sniperPerches']})"), ("#3de0ff", "raft lanes, island"), ("#ffffff", "wall walk"),
                        ("#6b3f20", "trenches")], -half + 6, ly + 15, H + 5)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(half - 30, -(ly + 9), H + 5.5))
    bar = bpy.context.active_object
    bar.scale = (50, 1.0, 1)
    bar.data.materials.append(toon.flat_material("bar", RM.LABEL))
    over.append(bar)
    over += RM.label("50 m", half - 30, ly + 13, 3.0, height=H + 5)
    span_z = size_m * (px + strip) / px
    cam = toon.camera("TopCam", (0, -(span_z / 2 - half), 300), (0, -(span_z / 2 - half), 0), ortho_scale=span_z)
    cam.rotation_euler = (0, 0, 0)
    toon.render(cam, os.path.join(RENDERS, "topdown.png"))
    # a close plan of the castle with the same overlays
    cam = toon.camera("TopCastle", (0, -8, 300), (0, -8, 0), ortho_scale=110)
    cam.rotation_euler = (0, 0, 0)
    toon.setup_scene(samples=4 if QUICK else 16, size=(1800, 1800), bg="#1b1d22")
    toon.render(cam, os.path.join(RENDERS, "topdown_castle.png"))
    for o in over:
        bpy.data.objects.remove(o)


def ducks_for_scale(doc, h_at):
    out = []
    raid = doc["raid"]
    spots = [s for s in raid["duckSpawns"]] + [[u[0], u[1], u[2], 0.0] for u in raid["cannonUse"][:2]]
    for x, y, z, yaw in spots:
        d = render_kit.import_duck(GAME)
        if not d:
            break
        for nm in d.get("_imported", []):
            o = bpy.data.objects.get(nm)
            if o is not None and o is not d and o.parent is None:
                o.parent = d          # loose parts of the duck file follow the duck
        d.location = g2b(x, y - 0.1, z)
        d.rotation_euler = (0, 0, yaw + math.pi)
        out.append(d)
    return out


def tower_eye(raid, i):
    c, u = raid["cannons"][i], raid["cannonUse"][i]
    dx, dz = u[0] - c[0], u[2] - c[2]
    d = math.hypot(dx, dz)
    return (u[0] + dx / d * 1.6, u[1] + 2.4, u[2] + dz / d * 1.6)


def tower_target(raid, i):
    c, u = raid["cannons"][i], raid["cannonUse"][i]
    dx, dz = c[0] - u[0], c[2] - u[2]
    d = math.hypot(dx, dz)
    return (c[0] + dx / d * 60.0, 1.0, c[2] + dz / d * 60.0)


def shots(doc, h_at):
    raid = doc["raid"]
    toon.setup_scene(samples=4 if QUICK else 24, size=(1920, 1080), bg=SKY)
    ducks_for_scale(doc, h_at)
    walk = 1.0 + castle.WALK
    perch = raid["sniperPerches"][0]
    cams = []
    if want("eye"):
        cams += [
            # over a duck's shoulder on the east wall walk, out toward the east trenches and the raft lane
            ("eye_wallwalk_east", (16.4, walk + 2.3, -3.0), (74.0, 2.0, 6.0), 32),
            # the gatehouse top behind the machicolation: the drawbridge, the road and the south trenches
            ("eye_gatehouse_top", (-1.27, walk + 2.4, 22.4), (-1.0, 0.0, 46.0), 32),
            # the south-east watchtower's perch toward the castle
            ("eye_watchtower", (perch[0], perch[1] + 1.55, perch[2]), (0.0, 7.0, 0.0), 32),
            # a hunter's view from the south-east trench exit toward the drawbridge
            ("eye_trench_exit", (raid["hunterSpawns"][2][0], raid["hunterSpawns"][2][1] + 1.5, raid["hunterSpawns"][2][2]), (0.0, 5.0, 26.0), 30),
            # inside the courtyard: the core and its QORECHAIN banners from the gate passage
            ("eye_courtyard", (-2.5, 3.0, 16.4), (0.0, 3.4, -2.0), 30),
            # a duck manning the north-east bread cannon, over the lanes toward the north-east trenches
            ("eye_tower_top", tower_eye(raid, 2), tower_target(raid, 2), 32),
        ]
    if want("beauty"):
        cams += [
            ("beauty_castle", (-58.0, 24.0, 82.0), (0.0, 5.0, 8.0), 40),
            ("beauty_gate", (16.0, 5.5, 60.0), (0.0, 5.0, 22.0), 32),
            ("overview", (-150.0, 120.0, 170.0), (0.0, 0.0, 0.0), 32),
            ("closeup_core", (6.0, 4.0, 11.0), (0.0, 2.8, 0.0), 35),
        ]
    for name, eye, target, lens in cams:
        cam = toon.camera(name, g2b(*eye), g2b(*target), lens=lens)
        toon.render(cam, os.path.join(RENDERS, name + ".png"))


def pieces(k):
    """The animated GLBs on a sheet: gate states, the cannon turned and raised, the drawbridge down and up, the lever."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    toon.setup_scene(samples=4 if QUICK else 24, size=(2000, 1300), bg=SKY)
    render_kit.ground_plane(200)
    made = []
    for i, st in enumerate(("Intact", "Damaged", "Broken", "Planks")):
        show = {st} if st != "Planks" else {"Broken", "Planks"}
        made += k.animated("castle_gate", (-12.0 + i * 5.6, 8.0, 0.0), 0.0, show=show)
    made += k.animated("bread_cannon", (-10.0, -1.0, 0.0), 0.0)
    made += k.animated("bread_cannon", (-5.5, -1.0, 0.0), math.radians(35), pose={"Pitch": (math.radians(-28), 0, 0)})
    made += k.animated("castle_lever", (-1.0, -1.0, 0.0), 0.0)
    made += k.animated("castle_drawbridge", (5.0, 2.0, 0.0), 0.0)
    made += k.animated("castle_drawbridge", (12.5, 2.0, 0.0), 0.0, pose={"Hinge": (math.radians(-70), 0, 0)})
    k.instance("bread_loaf", (-2.6, -3.0, 0.0), 0.4)
    cam = toon.camera("pieces", (0.5, -24.0, 13.0), (0.5, 3.0, 2.0), lens=34)
    toon.render(cam, os.path.join(RENDERS, "pieces.png"))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(RENDERS, exist_ok=True)
    with open(os.path.join(EXPORT, "map_v1.json"), encoding="utf-8") as f:
        doc = json.load(f)
    k = Kit()
    h_at = build_scene(doc, k)
    if want("topdown"):
        topdown(doc, k)
    if want("eye") or want("beauty"):
        shots(doc, h_at)
    if want("pieces"):
        pieces(k)
    print("RENDERED", RENDERS)


if __name__ == "__main__":
    main()
