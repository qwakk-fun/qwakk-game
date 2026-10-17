"""Playable ducks. Every character is the same duck build (same proportions, same skeleton, same weights,
so the same clips, weapon attach and server hitboxes fit all of them) dressed differently: its parts
recolored to its own palette cells, plus small accessories that stay close to the body.

  classic   the yellow brand duck (duck.glb)
  mallard   "Toski": a mallard drake in an olive field cap (duck_mallard.glb)

A new character is a new entry in LOOKS (its file name is the asset contract: `duck_<id>.glb`, the
classic stays `duck.glb`), its colors appended to params.PALETTE (never reorder the existing cells),
and its catalog entries in the game (packages/shared/src/characters.ts, the menu's characters.ts).
"""

import math

from mathutils import Matrix, Vector

import geo
import params as P

# Cell remaps per part (the base name, without the mirrored "_R"). Parts not listed keep their cells.
MALLARD_CELLS = {
    "head": {"yellow": "m_green"},
    "blush": {"blush": "m_blush"},
    "tuft": {"yellow_deep": "m_green_deep", "yellow": "m_green_deep"},
    "belly": {"belly": "m_belly"},
    "tail": {"yellow": "m_tail", "yellow_deep": "m_tail_deep"},
    "arm": {"yellow": "m_wing"},
    "wingfeather": {"yellow": "m_speculum", "yellow_deep": "m_collar"},
    "leg": {"yellow": "m_grey"},
}
for _f in ("Thumb", "Index", "Middle"):
    MALLARD_CELLS["finger_" + _f] = {"yellow": "m_wing", "yellow_deep": "m_wing_deep"}

# Body: a white collar band right under the head, grey below. The chestnut breast is its own patch.
COLLAR_Z = 0.975

# Chestnut breast: a flat ellipsoid that just breaks the front of the body (like the belly patch), so
# its edge is a smooth oval. Placed on the body surface point BREAST_AT, tilted with the surface.
BREAST_AT = (0.0, -0.236, 0.925)
BREAST_NORMAL = (0.0, -0.84, 0.54)
BREAST_RADII = (0.31, 0.17, 0.215)     # across, bulge, along the surface (up)
BREAST_RISE = 0.014                   # how far it stands out of the body


def mallard_body_cell(c):
    return "m_collar" if c.z >= COLLAR_Z else "m_grey"


# Field cap: a garrison cap riding the top of the head, tipped toward the duck's right.
CAP_TILT_DEG = -19          # around the front-back axis; negative tips it toward the duck's right (-X)
CAP_PITCH = (36.0, 138.0)   # front and back end, degrees of elevation on the head's front-back meridian
CAP_HALF_WIDTH = 0.128
CAP_HEIGHT = 0.125          # top of the cap above the head surface, at the ends
CAP_SINK = 0.03             # how far the cap's underside sits inside the head (no gap at any angle)
CAP_RINGS = 9
CAP_SEGMENTS = 12
CAP_CURTAIN = 0.70          # side faces past this |cos| of the cross-section angle are the darker curtain

# Drake curl: the curled black tail feather (the brand mark's curl, seen on a mallard's rump).
CURL_POINTS = [(0.0, 0.385, 0.70), (0.0, 0.425, 0.79), (0.0, 0.41, 0.87), (0.0, 0.355, 0.895),
               (0.0, 0.32, 0.855), (0.0, 0.34, 0.815), (0.0, 0.375, 0.83)]
CURL_RADII = [0.030, 0.028, 0.024, 0.020, 0.016, 0.012, 0.009]


def head_surface(direction):
    """Point on the head ellipsoid in a direction from its center, and the outward normal."""
    d = Vector(direction).normalized()
    a, b, c = P.HEAD_RADII
    t = 1.0 / math.sqrt((d.x / a) ** 2 + (d.y / b) ** 2 + (d.z / c) ** 2)
    p = d * t
    n = Vector((p.x / a ** 2, p.y / b ** 2, p.z / c ** 2)).normalized()
    return Vector(P.HEAD_CENTER) + p, n


def build_cap(parts):
    """Yellow garrison cap: a boat-shaped band over the head with a peak at each end and a dip in the
    middle, a darker crease ridge on top and a small brass pin on its left front."""
    tilt = Matrix.Rotation(math.radians(CAP_TILT_DEG), 3, "Y")
    center = Vector(P.HEAD_CENTER)
    p0, p1 = CAP_PITCH
    rings = []
    ridge = []
    for i in range(CAP_RINGS):
        s = i / (CAP_RINGS - 1)
        el = math.radians(p0 + (p1 - p0) * s)
        d = tilt @ Vector((0.0, -math.cos(el), math.sin(el)))
        surf, n = head_surface(d)
        side = (tilt @ Vector((1.0, 0.0, 0.0)))
        side = (side - n * side.dot(n)).normalized()
        end = abs(2 * s - 1)                      # 0 in the middle, 1 at the ends
        w = CAP_HALF_WIDTH * (0.42 + 0.58 * math.sin(math.pi * s) ** 0.55)
        h = CAP_HEIGHT * (0.80 + 0.20 * end ** 2) * (0.55 + 0.45 * math.sin(math.pi * s) ** 0.35)
        ring = []
        for j in range(CAP_SEGMENTS):
            a = 2 * math.pi * j / CAP_SEGMENTS
            ca, sa = math.cos(a), math.sin(a)
            # upper half: flat-sided tent with a soft crease; lower half: tucked into the head
            if sa >= 0:
                up = h * (1.0 - abs(ca)) ** 0.8 * (sa ** 0.25)
            else:
                up = -CAP_SINK * (-sa)
            x = w * ca * (1.0 if sa >= 0 else 0.92)
            # measured from the head surface right under this point, so the edge never floats
            under, _ = head_surface(surf + side * x - center)
            ring.append(under + n * up)
        rings.append(ring)
        ridge.append(surf + n * (h * 0.97))
    cap = geo.Part("cap")
    first = sum(rings[0], Vector()) / len(rings[0])
    last = sum(rings[-1], Vector()) / len(rings[-1])
    ft = (first - sum(rings[1], Vector()) / len(rings[1])).normalized()
    lt = (last - sum(rings[-2], Vector()) / len(rings[-2])).normalized()
    base = len(cap.faces)
    cap.ring_stack(rings, "m_cap", first + ft * 0.012, last + lt * 0.012)
    # the turned-up curtain: the lowest part of each side in the darker olive
    for i in range(CAP_RINGS - 1):
        for j in range(CAP_SEGMENTS):
            a = 2 * math.pi * (j + 0.5) / CAP_SEGMENTS
            if math.sin(a) > 0 and abs(math.cos(a)) > CAP_CURTAIN:
                cap.cells[base + i * CAP_SEGMENTS + j] = "m_cap_deep"
    parts.append(cap)

    # crease ridge along the top
    path = geo.catmull(ridge[1:-1], 10)
    rr = [geo.interp([(0, 0.006), (0.15, 0.011), (0.85, 0.011), (1, 0.006)], k / 9) for k in range(10)]
    crease = geo.Part("cap")
    geo.tube(crease, path, rr, [r * 0.8 for r in rr], 5, "m_cap_deep", cap_rings=2)
    parts.append(crease)

    # brass pin on the duck's left front side of the cap (brand yellow, a plain disc: no insignia)
    s = 0.24
    el = math.radians(p0 + (p1 - p0) * s)
    d = tilt @ Vector((0.0, -math.cos(el), math.sin(el)))
    surf, n = head_surface(d)
    side = (tilt @ Vector((1.0, 0.0, 0.0)))
    side = (side - n * side.dot(n)).normalized()
    w = CAP_HALF_WIDTH * (0.42 + 0.58 * math.sin(math.pi * s) ** 0.55)
    h = CAP_HEIGHT * 0.45
    out = (side + n * 0.25).normalized()
    under, _ = head_surface(surf + side * (w * 0.93) - center)
    pin_center = under + n * h
    pin = geo.Part("cap")
    geo.ellipsoid(pin, pin_center, (0.022, 0.010, 0.022), geo.frame_from_normal(out), 8, 4, "yellow")
    parts.append(pin)


def build_curl(parts):
    path = geo.catmull(CURL_POINTS, 9)
    keys = [(i / (len(CURL_RADII) - 1), r) for i, r in enumerate(CURL_RADII)]
    rr = [geo.interp(keys, i / 8) for i in range(9)]
    curl = geo.Part("tail")
    geo.tube(curl, path, rr, [r * 0.8 for r in rr], 6, "m_curl", up=(1, 0, 0), cap_rings=3)
    parts.append(curl)


def recolor(parts, table, body_cell=None):
    for part in parts:
        base = part.name[:-2] if part.name.endswith("_R") else part.name
        if base == "body" and body_cell is not None:
            for fi, f in enumerate(part.faces):
                c = sum((part.verts[i] for i in f), Vector()) / len(f)
                part.cells[fi] = body_cell(c)
            continue
        remap = table.get(base)
        if remap:
            part.cells = [remap.get(c, c) for c in part.cells]


def build_breast(parts):
    n = Vector(BREAST_NORMAL).normalized()
    center = Vector(BREAST_AT) - n * (BREAST_RADII[1] - BREAST_RISE)
    breast = geo.Part("belly")      # weighted and outlined like the belly patch (bone heat, no hull)
    breast.outline = 0.0
    geo.ellipsoid(breast, center, BREAST_RADII, geo.frame_from_normal(n), 12, 5, "m_chest")
    parts.append(breast)


def dress_mallard(parts):
    recolor(parts, MALLARD_CELLS, mallard_body_cell)
    build_breast(parts)
    build_cap(parts)
    build_curl(parts)


class Look:
    def __init__(self, id, file, mesh_name, tuft=True, dress=None):
        self.id = id
        self.file = file              # published under apps/client/public/models/
        self.mesh_name = mesh_name    # Blender object name (renders hide or show it by name)
        self.tuft = tuft              # the brand curl on top of the head (a cap replaces it)
        self.dress = dress


LOOKS = {
    "classic": Look("classic", "duck.glb", "QwakkDuck"),
    "mallard": Look("mallard", "duck_mallard.glb", "QwakkMallard", tuft=False, dress=dress_mallard),
}
