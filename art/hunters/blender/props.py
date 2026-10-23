"""Props: the wooden decoy duck (thrown by the decoy thrower), the net trap, and the defeat effects
(the dizzy stars ring and the dust poof) that ride the FxStars and FxPoof joints.

All static, palette textured with the hunters' material, built around their own origin.
"""

import math
import os

import bpy
from mathutils import Vector

import hbake
import human as H
from mesh import L, Part, box, build_object, ellipsoid_xyz, geo, star, triangle_count, tube


def _obj(name, parts, material):
    obj, _ = build_object(name, parts)
    obj.data.materials.append(material)
    return obj


def decoy_parts(lod):
    """A painted wooden decoy, 0.36 m long, origin at its middle, facing -Y (glTF +Z)."""
    p = Part("decoy", "Root")
    s = L(lod, 10, 6)
    r = L(lod, 6, 4)
    ellipsoid_xyz(p, (0, 0.0, 0.0), (0.095, 0.17, 0.068), "decoy_body", s, r)
    box(p, (0, 0.13, -0.052), (0, -0.13, -0.052), 0.12, 0.03, (0, 0, 1), "decoy_wing", chamfer=0.45)
    ellipsoid_xyz(p, (0, -0.105, 0.0), (0.085, 0.07, 0.058), "decoy_breast", s, r)
    ellipsoid_xyz(p, (0, 0.165, 0.035), (0.06, 0.06, 0.028), "decoy_wing", L(lod, 8, 6), 4)
    for sx in (1, -1):
        ellipsoid_xyz(p, (0.07 * sx, 0.035, 0.022), (0.035, 0.11, 0.04), "decoy_wing", L(lod, 8, 6), 4)
        if lod == 0:
            ellipsoid_xyz(p, (0.098 * sx, 0.03, 0.028), (0.008, 0.035, 0.012), "decoy_white", 6, 3)
    ellipsoid_xyz(p, (0, -0.145, 0.09), (0.052, 0.058, 0.052), "decoy_head", s, r)
    ellipsoid_xyz(p, (0, -0.21, 0.078), (0.03, 0.048, 0.015), "decoy_bill", L(lod, 8, 6), 4)
    if lod == 0:
        H.torus(p, (0, -0.125, 0.052), 0.05, 0.008, "decoy_white", 10, 3)
        for sx in (1, -1):
            ellipsoid_xyz(p, (0.045 * sx, -0.165, 0.105), (0.008, 0.008, 0.009), "pupil", 5, 3)
    return [p]


def _checker(c, a_cells=16, z_step=0.12, r_step=0.12, planar=False):
    ang = math.atan2(c.x, -c.y)
    k = int(math.floor((ang + math.pi) / (2 * math.pi / a_cells)))
    k += int(math.floor((math.hypot(c.x, c.y) / r_step) if planar else (c.z / z_step)))
    return "net" if k % 2 == 0 else "net_deep"


def trap_parts(sprung):
    """The net trap: open on the ground (a framed net disc with stakes and a warning flag), or sprung
    (the net pulled up into a 1.9 m dome over whatever stood on it)."""
    parts = []
    frame = Part("frame", "Root")
    H.torus(frame, (0, 0, 0.035), 0.62, 0.035, "stake", 20, 4)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        x, y = 0.66 * math.cos(a), 0.66 * math.sin(a)
        box(frame, (x, y, -0.02), (x, y, 0.13), 0.04, 0.04, (1, 0, 0), "stake", taper=0.6)
    parts.append(frame)
    net = Part("net", "Root")
    if not sprung:
        prof = [(0, 0.016), (0.3, 0.02), (0.6, 0.026), (0.61, 0.036), (0.3, 0.03), (0, 0.026)]
        geo.lathe(net, prof, 6, 16, lambda c: _checker(c, planar=True))
        box(net, (0, 0, 0.02), (0, 0, 0.05), 0.16, 0.16, (0, 1, 0), "steel", chamfer=0.3)
    else:
        prof = [(0, 0.0), (0.6, 0.03), (0.62, 0.35), (0.55, 0.9), (0.42, 1.35), (0.2, 1.72), (0.05, 1.86), (0, 1.88)]
        geo.lathe(net, prof, 9, 16, lambda c: _checker(c))
        ellipsoid_xyz(net, (0, 0, 1.9), (0.06, 0.06, 0.05), "rope", 6, 4)
        tube(net, [(0, 0, 1.92), (0.05, 0.02, 2.05), (0.0, 0.06, 2.15)], 0.012, 4, "rope", cap_rings=1, samples=4)
    parts.append(net)
    flag = Part("flag", "Root")
    base = Vector((0.66 * math.cos(math.pi / 4), 0.66 * math.sin(math.pi / 4), 0))
    tube(flag, [base, base + Vector((0, 0, 0.85))], 0.012, 5, "stake", cap_rings=1)
    box(flag, base + Vector((0.01, 0, 0.82)), base + Vector((0.01, 0, 0.62)), 0.012, 0.26, (0, 1, 0), "trap_flag",
        chamfer=0.1, taper=0.15)
    parts.append(flag)
    return parts


def stars_parts():
    """Five chunky stars on a 0.25 m ring, flat in the ground plane, origin at the ring center."""
    p = Part("stars", "Root")
    for k in range(5):
        a = 2 * math.pi * k / 5
        d = Vector((math.cos(a), math.sin(a), 0))
        n = (d + Vector((0, 0, 0.2))).normalized()
        star(p, d * 0.25, n, 0.08, 0.034, "star" if k % 2 == 0 else "star_deep", spin=a)
    return [p]


def poof_parts():
    """A ring of dust puffs on the ground, 0.45 m out, origin at the center."""
    p = Part("poof", "Root")
    for k in range(9):
        a = 2 * math.pi * k / 9 + 0.2
        r = 0.42 + 0.05 * math.sin(3 * a)
        rad = 0.11 + 0.03 * math.cos(2 * a)
        ellipsoid_xyz(p, (r * math.cos(a), r * math.sin(a), rad * 0.7), (rad, rad, rad * 0.85),
                      "poof" if k % 3 else "poof_deep", 6, 4)
    for k in range(3):
        a = 2 * math.pi * k / 3
        ellipsoid_xyz(p, (0.2 * math.cos(a), 0.2 * math.sin(a), 0.1), (0.1, 0.1, 0.09), "poof", 6, 4)
    return [p]


class Props:
    def __init__(self, material):
        self.decoy = [_obj(f"decoy_LOD{k}", decoy_parts(k), material) for k in range(2)]
        self.decoy_root = bpy.data.objects.new("decoy_root", None)
        bpy.context.scene.collection.objects.link(self.decoy_root)
        for o in self.decoy:
            o.parent = self.decoy_root
        self.trap = [_obj("trap_open", trap_parts(False), material), _obj("trap_sprung", trap_parts(True), material)]
        self.trap_root = bpy.data.objects.new("trap_root", None)
        bpy.context.scene.collection.objects.link(self.trap_root)
        for o in self.trap:
            o.parent = self.trap_root
        self.stars = _obj("fx_stars", stars_parts(), material)
        self.poof = _obj("fx_poof", poof_parts(), material)

    def export(self, out_dir):
        info = {}
        hbake.export_renamed(os.path.join(out_dir, "decoy.glb"),
                             [(self.decoy_root, "Decoy"), (self.decoy[0], "LOD0"), (self.decoy[1], "LOD1")], static=True)
        info["decoy"] = {"file": "decoy.glb", "manifest": {
            "file": "decoy.glb", "nodes": {"root": "Decoy", "lods": ["LOD0", "LOD1"]}, "lodUntil": [15.0, 80.0],
            "triangles": [triangle_count(o) for o in self.decoy], "length": 0.38,
            "origin": "the decoy's middle (spin it about here when thrown)", "forward": "+Z"}}
        hbake.export_renamed(os.path.join(out_dir, "trap.glb"),
                             [(self.trap_root, "Trap"), (self.trap[0], "Open"), (self.trap[1], "Sprung")], static=True)
        info["trap"] = {"file": "trap.glb", "manifest": {
            "file": "trap.glb", "nodes": {"root": "Trap", "states": ["Open", "Sprung"]},
            "triangles": [triangle_count(o) for o in self.trap], "radius": 0.66, "sprungHeight": 2.15,
            "origin": "the trap's center on the ground", "note": "show Open, swap to Sprung when it catches a duck"}}
        hbake.export_renamed(os.path.join(out_dir, "hunter_fx.glb"),
                             [(self.stars, "Stars"), (self.poof, "Poof")], static=True)
        info["fx"] = {"file": "hunter_fx.glb", "manifest": {
            "file": "hunter_fx.glb", "nodes": ["Stars", "Poof"],
            "triangles": [triangle_count(self.stars), triangle_count(self.poof)],
            "note": "add Stars under the FxStars joint and Poof under FxPoof (attach poses below); the clips scale "
                    "and spin those joints, and their node scale is 0 otherwise"}}
        for v in info.values():
            v["manifest"]["glbBytes"] = os.path.getsize(os.path.join(out_dir, v["file"]))
        return info
