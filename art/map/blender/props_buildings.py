"""Landmarks: lighthouse, stone bridge; and the list of every building builder. The QoreChain Tower (the
Kavren centerpiece) lives in qorechain_tower; the enterable houses live in their own modules: house_farm
(farmhouse), house_town (townhouse with the bakery), house_ruin (ruined house), house_barn (barn); shared
parts in house_kit and furniture.

Blender space: meters, Z up, the front faces -Y, origin on the ground at the footprint center.
Walls go counterclockwise seen from above, so each wall's local -Y is outside (shutters, frames).
"""

import math

from mathutils import Vector

import house_barn
import house_farm
import house_ruin
import house_town
import qorechain_tower
from kit import Prop, gable_roof


# ---------------------------------------------------------------- lighthouse
def lighthouse():
    p = Prop("lighthouse", "landmark")
    bands = [(0.0, 0.9, "stone_dark"), (0.9, 5.0, "white"), (5.0, 7.0, "lamp_red"), (7.0, 11.0, "white"),
             (11.0, 13.0, "lamp_red"), (13.0, 16.0, "white")]
    r0, r1, top = 3.0, 2.2, 16.0
    rad = lambda z: r0 + (r1 - r0) * z / top
    for z0, z1, cell in bands:
        p.cyl(rad(z0), z1 - z0, (0, 0, (z0 + z1) / 2), cell, r2=rad(z1), segs=10, caps=False, phase=math.pi / 10)
    pts = []
    for k in range(10):
        a = 2 * math.pi * k / 10 + math.pi / 10
        pts += [(math.cos(a) * r0, math.sin(a) * r0, 0), (math.cos(a) * r1, math.sin(a) * r1, top)]
    p.col_hull("wall", pts)
    p.cyl(3.1, 0.35, (0, 0, top + 0.17), "steel_dark", segs=10, phase=math.pi / 10, col="roof")
    for k in range(10):
        a = 2 * math.pi * k / 10
        p.box((0.07, 0.07, 1.0), (math.cos(a) * 2.95, math.sin(a) * 2.95, top + 0.85), "steel_dark", bottom=True)
        a2 = 2 * math.pi * (k + 1) / 10
        pa = Vector((math.cos(a) * 2.95, math.sin(a) * 2.95, top + 1.32))
        pb = Vector((math.cos(a2) * 2.95, math.sin(a2) * 2.95, top + 1.32))
        p.tube(pa, pb, 0.04, "steel_dark", segs=4)
    p.cyl(1.55, 2.2, (0, 0, top + 1.45), "lamp_glass", segs=8)
    for k in range(8):
        a = 2 * math.pi * k / 8 + math.pi / 8
        p.box((0.1, 0.1, 2.2), (math.cos(a) * 1.58, math.sin(a) * 1.58, top + 1.45), "dark", bottom=True)
    p.cyl(1.85, 1.3, (0, 0, top + 3.2), "lamp_red", r2=0.2, segs=8)
    p.sphere(0.22, (0, 0, top + 4.0), "steel_dark", segs=8, rings=4)
    # door and keeper's hut
    p.box((1.2, 0.3, 2.2), (0, -2.95, 1.1), "window", bottom=True)
    p.box((1.5, 0.35, 0.25), (0, -3.0, 2.3), "stone_dark", bottom=True)
    with p.frame((0, 4.4, 0)):
        p.boxmm((-2.4, -1.6, 0), (2.4, 1.6, 2.7), "plaster", col="wall", top="plaster_dark")
        gable_roof(p, 4.8, 3.2, 2.7, 38, 0.3, 0.22, "slate", ridge_cell="slate_dark", along="X")
        p.box((0.9, 0.08, 1.8), (1.2, -1.62, 0.9), "shutter_blue", bottom=True)
    p.meta["note"] = "exterior landmark, not enterable"
    return p


# ---------------------------------------------------------------- stone arch bridge
def bridge_stone():
    """Spans along Y over a river flowing along X. Road surface 0.3 m above the banks at the middle;
    the river bed is expected 3 m below the bank level."""
    p = Prop("bridge_stone", "landmark")
    hw = 2.6
    p.boxmm((-hw, -6.0, -0.6), (hw, 6.0, 0.3), "stone", col="floor", top="rubble")
    for s in (-1, 1):
        y0, y1 = (6.0, 10.0) if s > 0 else (-10.0, -6.0)
        ya, yb = (6.0, 10.0) if s > 0 else (-6.0, -10.0)
        p.hull([(-hw, ya, 0.3), (hw, ya, 0.3), (-hw, yb, 0.0), (hw, yb, 0.0), (-hw, ya, -0.6), (hw, ya, -0.6), (-hw, yb, -0.6), (hw, yb, -0.6)],
               "stone", col="ramp", cells_fn=lambda c, n: "rubble" if n.z > 0.5 else "stone")
        # abutments into the banks
        p.boxmm((-hw - 0.2, min(5.0 * s, 9.0 * s), -3.4), (hw + 0.2, max(5.0 * s, 9.0 * s), -0.6), "stone_dark", col="block", bottom=True)
    # segmental arch: crown underside at -0.75, springing at -3.0 at y = +-5
    pts = []
    for i in range(9):
        y = -5.0 + 10.0 * i / 8
        z = -3.0 + 2.25 * (1 - (y / 5.0) ** 2) ** 0.5
        pts.append((y, z))
    for (ya, za), (yb, zb) in zip(pts, pts[1:]):
        p.hull([(-hw, ya, za), (hw, ya, za), (-hw, yb, zb), (hw, yb, zb), (-hw, ya, -0.6), (hw, ya, -0.6), (-hw, yb, -0.6), (hw, yb, -0.6)],
               "stone", col="block", cells_fn=lambda c, n: "stone_dark" if n.z < -0.3 else "stone")
    # voussoir ring on both faces
    for sx in (-1, 1):
        for (ya, za), (yb, zb) in zip(pts, pts[1:]):
            ym, zm = (ya + yb) / 2, (za + zb) / 2
            ang = math.degrees(math.atan2(zb - za, yb - ya))
            p.box((0.14, math.hypot(yb - ya, zb - za) - 0.06, 0.5), (sx * (hw + 0.05), ym, zm + 0.2), "stone_dark", rot=(ang, 0, 0), bottom=True)
    # parapets and end posts
    for sx in (-1, 1):
        x0, x1 = sorted((sx * hw, sx * (hw - 0.4)))
        p.boxmm((x0, -6.0, 0.3), (x1, 6.0, 1.2), "stone", col="cover", top="stone_dark", bottom=True)
        for sy in (-1, 1):
            p.box((0.6, 0.6, 1.5), (sx * (hw - 0.2), sy * 6.3, 0.75), "stone_dark", col="block", top="stone", bottom=True)
    p.meta["note"] = "deck spans y -10..10 (glTF z), banks at y = 0, river bed at -3.0 under the arch"
    return p


BUILDERS = [house_farm.farmhouse, house_town.townhouse, house_ruin.house_ruined, qorechain_tower.qorechain_tower, house_barn.barn, lighthouse,
            bridge_stone]
