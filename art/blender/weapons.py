"""Chunky toy weapons built from beveled boxes and cylinders, sharing the duck palette.

Weapon space (Blender): origin at the right-hand grip center, barrel along -Y, up +Z, meters.
After glTF export that is barrel +Z, up +Y. Child empties mark Muzzle, Grip, Support and Eject.
"""

import math

import bpy
from mathutils import Euler, Matrix, Vector

import duck

# (kind, size or (radius, length), center, cell, rotation X deg, bevel width)
# box size is (width X, length Y, height Z); cylinders run along Y.
RIFLE = [
    # compact toy carbine: the duck's short wings must reach around its round belly
    ("box", (0.036, 0.050, 0.118), (0, 0.010, -0.006), "gun_dark", 16, 0.010),       # pistol grip
    ("box", (0.060, 0.225, 0.052), (0, -0.058, 0.060), "gunmetal", 0, 0.008),       # lower receiver
    ("box", (0.054, 0.245, 0.046), (0, -0.062, 0.105), "gun_dark", 0, 0.008),       # upper receiver
    ("box", (0.032, 0.190, 0.012), (0, -0.064, 0.133), "gun_light", 0, 0.003),      # top rail
    ("box", (0.046, 0.062, 0.046), (0, -0.030, 0.160), "gun_dark", 0, 0.010),       # red-dot housing
    ("cyl", (0.016, 0.064), (0, -0.030, 0.166), "yellow", 0, 0.0),                  # red-dot lens (yellow)
    ("cyl", (0.019, 0.110), (0, 0.105, 0.090), "gun_dark", 0, 0.0),                 # buffer tube
    ("box", (0.050, 0.085, 0.088), (0, 0.155, 0.066), "gun_dark", 0, 0.014),        # stock
    ("box", (0.056, 0.026, 0.098), (0, 0.205, 0.064), "orange", 0, 0.010),          # butt pad
    ("box", (0.066, 0.185, 0.066), (0, -0.262, 0.090), "orange", 0, 0.018),         # handguard
    ("cyl", (0.014, 0.090), (0, -0.395, 0.092), "gun_dark", 0, 0.0),                # barrel
    ("cyl", (0.023, 0.052), (0, -0.462, 0.092), "gunmetal", 0, 0.005),             # muzzle brake
    ("box", (0.014, 0.014, 0.034), (0, -0.330, 0.136), "gun_dark", 0, 0.003),       # front sight post
    ("box", (0.038, 0.056, 0.078), (0, -0.090, -0.002), "yellow", -8, 0.008),       # magazine, upper
    ("box", (0.038, 0.056, 0.070), (0, -0.112, -0.064), "yellow", -22, 0.008),      # magazine, lower
    ("box", (0.042, 0.062, 0.012), (0, -0.124, -0.100), "gun_dark", -22, 0.003),    # magazine base
    ("box", (0.012, 0.064, 0.008), (0, -0.040, 0.016), "gun_dark", 0, 0.002),       # trigger guard
    ("box", (0.008, 0.010, 0.026), (0, -0.030, 0.030), "gun_light", 0, 0.002),      # trigger
    ("box", (0.074, 0.018, 0.014), (0, 0.040, 0.118), "gun_light", 0, 0.003),      # charging handle
]
RIFLE_EMPTIES = {
    "Muzzle": (0, -0.489, 0.092),
    "Grip": (0, 0, 0),
    "Support": (0, -0.130, 0.040),     # left fist center on the magwell (front of the magazine)
    "Eject": (-0.032, -0.060, 0.108),  # right side (-X in Blender = gun right)
}

PISTOL = [
    ("box", (0.034, 0.048, 0.104), (0, 0.006, -0.010), "orange", 14, 0.010),        # grip
    ("box", (0.038, 0.150, 0.032), (0, -0.045, 0.050), "gun_dark", 0, 0.006),       # frame
    ("box", (0.036, 0.178, 0.048), (0, -0.050, 0.088), "gunmetal", 0, 0.008),       # slide
    ("box", (0.012, 0.150, 0.006), (0, -0.052, 0.113), "yellow", 0, 0.002),         # top stripe
    ("cyl", (0.012, 0.022), (0, -0.146, 0.090), "gun_dark", 0, 0.0),                # barrel tip
    ("box", (0.010, 0.050, 0.008), (0, -0.048, 0.012), "gun_dark", 0, 0.002),       # trigger guard bottom
    ("box", (0.010, 0.008, 0.034), (0, -0.072, 0.027), "gun_dark", 0, 0.002),       # trigger guard front
    ("box", (0.007, 0.009, 0.022), (0, -0.038, 0.028), "gun_light", 0, 0.002),      # trigger
    ("box", (0.040, 0.054, 0.013), (0, 0.020, -0.064), "yellow", 14, 0.004),        # magazine base
    ("box", (0.026, 0.010, 0.012), (0, 0.030, 0.116), "gun_dark", 0, 0.002),        # rear sight
    ("box", (0.008, 0.010, 0.012), (0, -0.128, 0.116), "gun_dark", 0, 0.002),       # front sight
]
PISTOL_EMPTIES = {
    "Muzzle": (0, -0.158, 0.090),
    "Grip": (0, 0, 0),
    "Support": (0.040, 0.004, -0.020),  # off hand wraps the grip from the left side
    "Eject": (-0.022, -0.040, 0.100),
}


def set_cell(obj, cell):
    u, v = duck.cell_uv(cell)
    uv = obj.data.uv_layers.get("UVMap") or obj.data.uv_layers.new(name="UVMap")
    for loop in uv.data:
        loop.uv = (u, v)


def make_part(kind, dims, center, cell, rot_x, bevel):
    if kind == "box":
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.active_object
        obj.scale = dims
    else:
        radius, length = dims
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=length)
        obj = bpy.context.active_object
        obj.rotation_euler = (math.radians(90), 0, 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.harden_normals = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.rotation_euler = (math.radians(rot_x), 0, 0)
    obj.location = center
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    set_cell(obj, cell)
    return obj


def build_weapon(name, parts, empties, material):
    objs = [make_part(*p) for p in parts]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    gun = bpy.context.active_object
    gun.name = name
    gun.data.name = name
    gun.data.materials.clear()
    gun.data.materials.append(material)
    g = gun.vertex_groups.new(name="outline")
    g.add(list(range(len(gun.data.vertices))), 1.0, "REPLACE")
    nodes = []
    for ename, loc in empties.items():
        e = bpy.data.objects.new(f"{name}_{ename}", None)
        e["contract_name"] = ename   # renamed to exactly this while its weapon exports
        e.empty_display_size = 0.03
        e.empty_display_type = "ARROWS"
        bpy.context.scene.collection.objects.link(e)
        e.parent = gun
        e.location = loc
        nodes.append(e)
    return gun, nodes


def contract_names(guns, active):
    """Give the active weapon's empties their exact contract names (Muzzle, Grip, ...), others a prefix."""
    for kind, (gun, empties) in guns.items():
        for e in empties:
            e.name = f"{gun.name}_{e['contract_name']}"
    for e in guns[active][1]:
        e.name = e["contract_name"]


def build_all(material):
    rifle = build_weapon("Rifle", RIFLE, RIFLE_EMPTIES, material)
    pistol = build_weapon("Pistol", PISTOL, PISTOL_EMPTIES, material)
    return {"rifle": rifle, "pistol": pistol}
