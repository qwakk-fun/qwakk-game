"""Top-down render of map_v1: terrain with ground paint, sea and river, every placed prop instanced from the kit,
zone outlines and names, roads, drop plane paths and final circle candidates.

Run after layout/gen_map.py (art/map/build.sh does both):
  Blender -b --factory-startup -P qwakk-game/art/map/blender/render_map.py -- [--quick]
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import bmesh  # noqa: E402

import kit  # noqa: E402
import toon  # noqa: E402
import props_military  # noqa: E402
import props_buildings  # noqa: E402
import props_country  # noqa: E402
import props_vehicles  # noqa: E402

MAP_ART = os.path.dirname(HERE)
EXPORT = os.path.join(MAP_ART, "export")
RENDERS = os.path.join(MAP_ART, "renders")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
QUICK = "--quick" in argv

GROUND_COLORS = {
    "grass": "#93b45a", "grass_dark": "#83a64f", "sand": "#e8d39a", "rock": "#9c968a", "dirt_road": "#c9b48a",
    "cobble": "#b9b09c", "wheat": "#d9c271", "green_crop": "#7fae4a", "plowed": "#9a7a55", "forest_floor": "#5f8a3c",
    "river_mud": "#8d7c5c", "seabed": "#c7b98a", "orchard_grass": "#a2c065",
}
SEA = "#4aa3c4"
LABEL = "#fff7dc"
SHADOW = "#151619"


def g2b(x, y, z):
    """Game (x east, y up, z south) to Blender (x, -z, y)."""
    return (x, -z, y)


def read_heights(t):
    n = t["cells"] + 1
    with open(os.path.join(EXPORT, t["heights"]), "rb") as f:
        raw = f.read()
    magic, ver, samples, ox, oz, cell_cm, units = struct.unpack("<4sHHhhHH", raw[:16])
    assert magic == b"QWHF" and samples == n, (magic, samples)
    return struct.unpack("<%dh" % (n * n), raw[16:16 + 2 * n * n])


def terrain_object(doc):
    t = doc["terrain"]
    n = t["cells"] + 1
    hs = read_heights(t)
    with open(os.path.join(EXPORT, t["ground"]), "rb") as f:
        raw = f.read()
    assert raw[:4] == b"QWGP"
    ground = raw[t["headerBytes"]:]
    legend = t["groundLegend"]
    x0, z0 = t["origin"]
    cs = t["cellSize"]
    mesh = bpy.data.meshes.new("Terrain")
    verts = []
    for r in range(n):
        for c in range(n):
            verts.append(g2b(x0 + c * cs, hs[r * n + c] / 100.0, z0 + r * cs))
    faces = []
    for r in range(n - 1):
        for c in range(n - 1):
            a = r * n + c
            # same diagonal as the Rapier heightfield: (r, c + 1) to (r + 1, c)
            faces.append((a, a + n, a + 1))
            faces.append((a + 1, a + n, a + n + 1))
    mesh.from_pydata(verts, [], faces)
    col = mesh.color_attributes.new("ground", "FLOAT_COLOR", "POINT")
    # bake a soft hillshade (light from the north-west) and a slight elevation tint, so relief reads from above
    lx, ly, lz = -0.5, 0.5, 0.7
    ln = math.sqrt(lx * lx + ly * ly + lz * lz)
    for r in range(n):
        for c in range(n):
            i = r * n + c
            hx = (hs[r * n + min(c + 1, n - 1)] - hs[r * n + max(c - 1, 0)]) / 100.0 / (2 * cs)
            hz = (hs[min(r + 1, n - 1) * n + c] - hs[max(r - 1, 0) * n + c]) / 100.0 / (2 * cs)
            # Blender normal of the surface y = h(x, z): (-hx, hz, 1) since Blender y = -z
            nx, ny, nz = -hx, hz, 1.0
            nl = math.sqrt(nx * nx + ny * ny + nz * nz)
            d = (nx * lx + ny * ly + nz * lz) / (nl * ln)
            shade = 0.97 + 1.1 * (d - 0.70) + 0.008 * max(0.0, hs[i] / 100.0)
            rgb = kit.hex_to_linear(GROUND_COLORS[legend[ground[i]]])
            col.data[i].color = (*(min(1.0, v * shade) for v in rgb), 1.0)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("Terrain", mesh)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.new("TerrainFlat")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "ground"
    emit = nt.nodes.new("ShaderNodeEmission")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(attr.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs[0], out.inputs["Surface"])
    obj.data.materials.append(mat)
    return obj


def flat_plane(name, size, z, color, alpha=1.0):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(toon.flat_material(name + "_m", color, alpha))
    return o


def ribbon(name, pts, width, color, z_fn, alpha=1.0, step=3.0, z_off=0.0):
    """Flat strip along a polyline (game x, z points). z_fn(x, z) gives the Blender height."""
    dense = []
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        L = math.hypot(bx - ax, bz - az)
        k = max(1, int(L / step))
        for i in range(k):
            t = i / k
            dense.append((ax + (bx - ax) * t, az + (bz - az) * t))
    dense.append(tuple(pts[-1]))
    verts, faces = [], []
    for i, (x, z) in enumerate(dense):
        a = dense[max(0, i - 1)]
        b = dense[min(len(dense) - 1, i + 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz) or 1.0
        nx, nz = -dz / L * width / 2, dx / L * width / 2
        h = z_fn(x, z) + z_off
        verts.append(g2b(x + nx, h, z + nz))
        verts.append(g2b(x - nx, h, z - nz))
        if i > 0:
            j = 2 * i
            faces.append((j - 2, j - 1, j + 1, j))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(toon.flat_material(name + "_m", color, alpha))
    return o


def polyline(name, pts, width, color, z, alpha=1.0, closed=False, dash=None):
    """Overlay line at a fixed Blender height z (above all terrain), optionally dashed."""
    pts = [tuple(p) for p in pts]
    if closed:
        pts = pts + [pts[0]]
    flat = lambda x, zz: z  # noqa: E731
    if not dash:
        return [ribbon(name, pts, width, color, flat, alpha, step=1e9)]
    out = []
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        k = max(1, int(math.hypot(bx - ax, bz - az) / dash))
        for i in range(0, k, 2):
            t0, t1 = i / k, min(1.0, (i + 1) / k)
            seg = [(ax + (bx - ax) * t0, az + (bz - az) * t0), (ax + (bx - ax) * t1, az + (bz - az) * t1)]
            out.append(ribbon(name, seg, width, color, flat, alpha, step=1e9))
    return out


def label(text, x, z, size, color=LABEL, height=70.0, align="CENTER"):
    out = []
    for dx, dz, col, h in ((0.9, 0.9, SHADOW, height - 0.5), (0, 0, color, height)):
        curve = bpy.data.curves.new("lbl", "FONT")
        curve.body = text
        curve.size = size
        curve.align_x = align
        curve.align_y = "CENTER"
        o = bpy.data.objects.new("lbl_" + text, curve)
        bpy.context.scene.collection.objects.link(o)
        o.location = (x + dx, -(z + dz), h)
        o.data.materials.append(toon.flat_material("lbl_" + col, col))
        out.append(o)
    return out


def build_prop_meshes(names):
    palette = kit.build_palette(os.path.join(EXPORT, "props_palette.png"))
    mat = toon.toon_material(palette)
    builders = {fn.__name__: fn for fn in props_military.BUILDERS + props_buildings.BUILDERS + props_country.BUILDERS + props_vehicles.BUILDERS}
    meshes = {}
    for n in names:
        p = builders[n]()
        obj = p.to_object(mat)
        obj.hide_render = True
        meshes[n] = obj.data
    return meshes


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with open(os.path.join(EXPORT, "map_v1.json")) as f:
        doc = json.load(f)
    size = 2400
    strip = 300          # px legend strip under the map
    toon.setup_scene(samples=4 if QUICK else 16, size=(size, size + strip), bg="#1b1d22")
    terrain_object(doc)
    flat_plane("Sea", 2000, 0.0, SEA, alpha=0.82)
    t = doc["terrain"]
    n = t["cells"] + 1
    hs = read_heights(t)

    def h_at(x, z):
        c = min(n - 1, max(0, int(round((x - t["origin"][0]) / t["cellSize"]))))
        r = min(n - 1, max(0, int(round((z - t["origin"][1]) / t["cellSize"]))))
        return hs[r * n + c] / 100.0

    river = doc["water"]["river"]
    pts = [(p["x"], p["z"]) for p in river]
    water = {(p["x"], p["z"]): p["water"] for p in river}

    def water_z(x, z):
        best, wz = 1e9, 0.0
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz
            tt = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / L2))
            d = math.hypot(x - ax - dx * tt, z - az - dz * tt)
            if d < best:
                best, wz = d, water[(ax, az)] + (water[(bx, bz)] - water[(ax, az)]) * tt
        return max(0.02, wz)

    ribbon("River", pts, 2 * doc["water"]["riverHalfWidth"], SEA, water_z)
    for rd in doc["roads"]:
        ribbon("Road_" + rd["id"], rd["pts"], rd["width"], GROUND_COLORS["dirt_road"], h_at, z_off=0.35)
    # props
    names = sorted({p["prop"] for p in doc["props"]})
    meshes = build_prop_meshes(names)
    for p in doc["props"]:
        o = bpy.data.objects.new(p["prop"], meshes[p["prop"]])
        bpy.context.scene.collection.objects.link(o)
        o.location = g2b(p["x"], p["y"], p["z"])
        o.rotation_euler = (0, 0, p["rotY"])
        s = p.get("scale", 1.0)
        o.scale = (s, s, s)
    # overlays: zones, circle candidates, flight paths, loot
    for zn in doc["zones"]:
        if zn["poly"]:
            polyline("zone_" + zn["id"], zn["poly"], 1.6, "#fff7dc", 62.0, closed=True, dash=7.0)
    for c in doc["circle"]["finalCandidates"]:
        ring = [(c["x"] + math.cos(a * math.pi / 24) * c["r"], c["z"] + math.sin(a * math.pi / 24) * c["r"]) for a in range(48)]
        polyline("circle", ring, 1.4, "#ff8a3d", 63.0, closed=True, alpha=0.9)
    for k, fp in enumerate(doc["drop"]["plane"]["paths"]):
        polyline("flight", [fp["from"], fp["to"]], 1.2, "#ffffff", 64.0, alpha=0.35, dash=12.0)
    for lp in doc["loot"]:
        bpy.ops.mesh.primitive_circle_add(vertices=6, radius=1.3, fill_type="NGON", location=(lp["x"], -lp["z"], 61.0))
        o = bpy.context.active_object
        tier_col = {1: "#f2efe6", 2: "#ffd43b", 3: "#ff8a3d", 4: "#e0413a"}[lp["tier"]]
        o.data.materials.append(toon.flat_material("loot_" + tier_col, tier_col))
    # zone names
    for zn in doc["zones"]:
        if not zn["poly"]:
            continue
        cx = sum(p[0] for p in zn["poly"]) / len(zn["poly"])
        cz = sum(p[1] for p in zn["poly"]) / len(zn["poly"])
        off = {"village": (0, -40), "beach": (30, -8), "headland": (20, 25), "ridge": (25, -20), "bridge": (0, -40),
               "crossroads": (0, -48), "farm": (0, -58), "orchard": (0, 62), "hamlet": (0, 46), "forest": (0, 0)}.get(zn["id"], (0, 0))
        label(zn["name"], cx + off[0], cz + off[1], 13.0)
        label(f"tier {zn['tier']}, {zn['drop']}", cx + off[0], cz + off[1] + 13, 7.5, color="#ffd43b")
    # the legend strip lives below the map (game z 425 to 527)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -476, 65.5))
    strip_bg = bpy.context.active_object
    strip_bg.scale = (900, 104, 1)
    strip_bg.data.materials.append(toon.flat_material("strip", "#1b1d22"))
    label("Sainte-Canard, map_v1", -410, 446, 17.0, align="LEFT")
    label("840 x 840 m, north up, x east, z south, 4 m terrain grid", -410, 466, 8.5, color="#ffd43b", align="LEFT")
    stats = doc["stats"]
    label(f"{stats['props']} props, {stats['loot']} loot points", -410, 482, 8.5, color="#f2efe6", align="LEFT")
    bpy.ops.mesh.primitive_plane_add(size=1, location=(-360, -505, 66.5))
    bar = bpy.context.active_object
    bar.scale = (100, 3, 1)
    bar.data.materials.append(toon.flat_material("bar", LABEL))
    label("100 m", -360, 515, 7.5)
    label("N", 400, 455, 14.0)
    bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=6, depth=1, location=(400, -478, 66.5))
    arrow = bpy.context.active_object
    arrow.scale = (0.6, 1.4, 1)
    arrow.data.materials.append(toon.flat_material("arrow", LABEL))
    # legend
    leg = [("#f2efe6", "loot tier 1"), ("#ffd43b", "loot tier 2"), ("#ff8a3d", "loot tier 3"), ("#e0413a", "loot tier 4"),
           ("#ff8a3d", "final circle candidates (rings)"), ("#ffffff", "drop plane path options (dashed)")]
    for i, (col, txt) in enumerate(leg):
        cx = -60 + (i // 3) * 200
        y = 446 + (i % 3) * 16
        bpy.ops.mesh.primitive_circle_add(vertices=8, radius=4.0, fill_type="NGON", location=(cx, -y, 68))
        o = bpy.context.active_object
        o.data.materials.append(toon.flat_material("leg_" + col, col))
        label(txt, cx + 9, y, 8.0, align="LEFT")
    span_z = 860 * (size + strip) / size
    cam = toon.camera("TopCam", (0, -(span_z / 2 - 430), 600), (0, -(span_z / 2 - 430), 0), ortho_scale=span_z)
    cam.rotation_euler = (0, 0, 0)
    out = os.path.join(RENDERS, "map_topdown.png")
    toon.render(cam, out)
    print("RENDERED", out)


if __name__ == "__main__":      # render_arena.py imports the helpers above
    main()
