"""QoreChain Tower: the landmark at the middle of Kavren, a square Art Deco tower with QORECHAIN in huge
yellow letters on all four faces and a steep pyramid crown with a beacon.

Gameplay: the ground floor is an open arcade hall (three round arches on every side, a solid core in the
middle, four columns and four waist-high planters as cover). Nothing above it can be reached: there are no
stairs, the shaft over the hall is one solid block with sheer 18 m walls and no ledge, and the crown has no
flat roof (60 degree faces, 51 degree hip lines, both steeper than MOVE.maxSlopeClimbDeg), so the tower is
cover and a landmark, never a sniper perch. The letters, trims and
window strips are mesh only, high above any reachable surface, so they cannot snag a duck.

Text only (no logo). The glyphs are built here from convex quads (a chamfered block face), so no font file
and no third-party asset is involved.

Blender space: meters, Z up, the front faces -Y, origin on the ground at the footprint center.
Walls go counterclockwise seen from above, so each wall's local -Y is outside.
"""

import math

import kit
from house_kit import GF
from kit import Prop

HALF = 8.0                    # 16 x 16 m footprint
T = 0.6                       # arcade wall thickness
HALL_TOP = 6.0                # arcade ceiling: the solid shaft starts here
SHAFT_TOP = 18.0
PITCH = 60                    # crown faces 60 deg, hip lines 51 deg: both steeper than the 46 deg a duck can climb
EAVE = HALF + 0.25
APEX = SHAFT_TOP + math.tan(math.radians(PITCH)) * EAVE
ARCH_W, ARCH_SPRING = 3.0, 2.9           # 3 m wide round arches, springing at 2.9 m, crown at 4.4 m
ARCH_AT = (-4.5, 0.0, 4.5)               # arch centers along every face
CORE = 2.0                               # the solid core: 4 x 4 m
BAND = (12.4, 16.4)                      # the dark lettering band
LETTER_H = 2.7
LETTER_Z = 13.05                         # glyph baseline (the band is centered on the cap height)
STROKE = 0.44
GAP = 0.28
TEXT = "QORECHAIN"
LOOK = {"base": "concrete", "base_dark": "concrete_dark", "body": "slate_dark", "band": "dark", "glyph": "yellow",
        "trim": "yellow", "glass": "glass", "crown": "slate", "floor": "flagstone"}


# ---------------------------------------------------------------- glyphs
def slab(p, poly, y0, y1, cell, col=None):
    """Extrude a convex polygon (u, z) in the current frame from y0 (outside, -Y) to y1, with every face wound
    outward (kit.Prop.prism winds its caps and its sides opposite ways, which flips the caps of thin pieces)."""
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))
    ring = list(poly) if area > 0 else list(poly)[::-1]
    n = len(ring)
    verts = [(u, y0, z) for u, z in ring] + [(u, y1, z) for u, z in ring]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    faces += [(n + j, n + (j + 1) % n, (j + 1) % n, j) for j in range(n)]
    p.add(verts, faces, cell, closed=False)
    if col:
        p.col_hull(col, verts)


def _octagon(w, h, c, s):
    """Outer and inner points of a chamfered ring in the glyph box (u right, v up), counterclockwise from the
    bottom edge. The inner ring is the outer one inset by the stroke `s` (45 degree chamfers)."""
    ci = c + s * (math.sqrt(2) - 1)
    outer = [(c, 0), (w - c, 0), (w, c), (w, h - c), (w - c, h), (c, h), (0, h - c), (0, c)]
    inner = [(ci, s), (w - ci, s), (w - s, ci), (w - s, h - ci), (w - ci, h - s), (ci, h - s), (s, h - ci), (s, ci)]
    return outer, inner


def _ring(w, h, c, s, segments, v0=0.0):
    outer, inner = _octagon(w, h, c, s)
    out = []
    for i in segments:
        j = (i + 1) % 8
        out.append([(u, v + v0) for u, v in (outer[i], outer[j], inner[j], inner[i])])
    return out


def _rect(u0, v0, u1, v1):
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def glyph(ch, h=LETTER_H, s=STROKE):
    """Convex quads (u, v) for one letter, plus its advance width. Pieces never overlap, so the coplanar
    front faces cannot z-fight. The Q tail comes back as a separate list (drawn a little proud)."""
    c = 0.46
    w = 1.5
    tail = []
    if ch in "OQ":
        quads = _ring(w, h, c, s, range(8))
        if ch == "Q":
            tail = [[(w * 0.5, 0.75), (w * 0.5 + 0.5, 0.75), (w + 0.2, -0.3), (w - 0.3, -0.3)]]
    elif ch == "C":
        quads = _ring(w, h, c, s, (0, 1, 3, 4, 5, 6, 7))
    elif ch == "E":
        w = 1.35
        quads = [_rect(0, 0, s, h), _rect(s, 0, w, s), _rect(s, h - s, w, h), _rect(s, h / 2 - s / 2, w * 0.86, h / 2 + s / 2)]
    elif ch == "H":
        quads = [_rect(0, 0, s, h), _rect(w - s, 0, w, h), _rect(s, h / 2 - s / 2, w - s, h / 2 + s / 2)]
    elif ch == "I":
        w = s
        quads = [_rect(0, 0, s, h)]
    elif ch == "N":
        span = w - 2 * s
        d = s * math.sqrt(1 + (h / span) ** 2)          # vertical extent of the diagonal stroke
        quads = [_rect(0, 0, s, h), _rect(w - s, 0, w, h), [(s, h - d), (w - s, 0), (w - s, d), (s, h)]]
    elif ch == "R":
        vm = h * 0.44                                     # bowl bottom
        bh = h - vm
        c2 = 0.4
        ci = c2 + s * (math.sqrt(2) - 1)
        bowl = [
            [(s, vm), (w - c2, vm), (w - ci, vm + s), (s, vm + s)],                   # middle bar
            [(w - c2, vm), (w, vm + c2), (w - s, vm + ci), (w - ci, vm + s)],         # lower chamfer
            [(w, vm + c2), (w, h - c2), (w - s, h - ci), (w - s, vm + ci)],           # right side
            [(w, h - c2), (w - c2, h), (w - ci, h - s), (w - s, h - ci)],             # upper chamfer
            [(s, h - s), (w - ci, h - s), (w - c2, h), (s, h)],                       # top bar
        ]
        assert bh > 2 * c2
        sh = s * 1.15
        leg = [(w * 0.38, vm), (w * 0.38 + sh, vm), (w, 0), (w - sh, 0)]
        quads = [_rect(0, 0, s, h)] + bowl + [leg]
    elif ch == "A":
        w = 1.8
        a = 0.2
        tl, tr = (w / 2 - a, h), (w / 2 + a, h)
        sh = s * math.sqrt(1 + (tl[0] / h) ** 2)          # horizontal width of a leg
        my = h * (w / 2 - sh) / tl[0]                     # where the inner edges meet
        m = (w / 2, my)
        xl = lambda v: sh + (m[0] - sh) * v / my         # noqa: E731  (inner edge of the left leg)
        v0, v1 = 0.62, 0.62 + s * 0.9
        quads = [[(0, 0), (sh, 0), m, tl], [(w - sh, 0), (w, 0), tr, m], [tl, m, tr],
                 [(xl(v0), v0), (w - xl(v0), v0), (w - xl(v1), v1), (xl(v1), v1)]]
    else:
        raise KeyError(ch)
    return quads, tail, w


def text_layout(text=TEXT):
    """Every quad of the word, centered on u = 0: [(quads, tail)], total width."""
    pieces, u = [], 0.0
    for k, ch in enumerate(text):
        quads, tail, w = glyph(ch)
        pieces.append(([[(x + u, y) for x, y in q] for q in quads], [[(x + u, y) for x, y in q] for q in tail]))
        u += w + (GAP if k < len(text) - 1 else 0.0)
    out = []
    for quads, tail in pieces:
        out.append(([[(x - u / 2, y) for x, y in q] for q in quads], [[(x - u / 2, y) for x, y in q] for q in tail]))
    return out, u


FACES = [((0, -HALF), 0.0), ((HALF, 0), 90.0), ((0, HALF), 180.0), ((-HALF, 0), -90.0)]
"""(center on the outside face, frame yaw): in each frame local +X runs left to right seen from outside and
local -Y points out of the wall."""


def lettering(p, depth=0.18, plate=0.08, flat=False):
    """The band plate and the word on all four faces. `flat`: one-sided quads (LOD shells)."""
    word, width = text_layout()
    assert width < 2 * HALF - 0.8, width
    for (cx, cy), yaw in FACES:
        with p.frame((cx, cy, 0), rot_z=yaw):
            if flat:
                p.patch((0, 0, (BAND[0] + BAND[1]) / 2), (0, -1, 0), 2 * HALF, BAND[1] - BAND[0], LOOK["band"], offset=0.03)
            else:
                p.boxmm((-HALF - 0.04, -plate, BAND[0]), (HALF + 0.04, 0.0, BAND[1]), LOOK["band"], bottom=True)
            for quads, tail in word:
                for q, proud in [(q, 0.0) for q in quads] + [(q, 0.03) for q in tail]:
                    pts = [(u, LETTER_Z + v) for u, v in q]
                    if flat:
                        y = -0.06 - proud
                        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))
                        ring = pts if area > 0 else pts[::-1]          # counterclockwise in (u, z): faces out (-Y)
                        p.add([(u, y, z) for u, z in ring], [tuple(range(len(ring)))], LOOK["glyph"], closed=False)
                    else:
                        slab(p, pts, -plate - depth - proud, -plate, LOOK["glyph"])


# ---------------------------------------------------------------- the arcade
def arch_quads(at_u, n=3):
    """Spandrel triangles (u, z) filling a round arch top in a rectangular opening centered on `at_u`."""
    r = ARCH_W / 2
    top = ARCH_SPRING + r
    out = []
    for side in (-1, 1):
        corner = (at_u + side * r, top)
        pts = []
        for k in range(n + 1):
            a = math.radians(90 - side * 90 * (1 - k / n))  # side -1 (left): 180 -> 90 deg, side 1: 0 -> 90 deg
            pts.append((at_u + r * math.cos(a), ARCH_SPRING + r * math.sin(a)))
        for k in range(n):
            out.append([corner, pts[k], pts[k + 1]])
    return out


def walls():
    """Counterclockwise outer walls (a, b, length) with the arch openings (at, width, bottom, top)."""
    i = HALF - T / 2
    out = []
    for a, b in (((-HALF, -i), (HALF, -i)), ((i, -HALF + T), (i, HALF - T)), ((HALF, i), (-HALF, i)), ((-i, HALF - T), (-i, -HALF + T))):
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        ops = [(length / 2 + u, ARCH_W, 0.0, ARCH_SPRING + ARCH_W / 2) for u in ARCH_AT]
        out.append((a, b, length, ops))
    return out


def arcade(p):
    p.boxmm((-HALF - 0.3, -HALF - 0.3, -0.6), (HALF + 0.3, HALF + 0.3, GF), LOOK["base_dark"], col="floor", top=LOOK["floor"])
    for a, b, length, ops in walls():
        kit.wall(p, a, b, HALL_TOP, T, LOOK["base"], openings=ops, top=LOOK["base"])
        # plinth on the piers, mesh only
        kit.wall(p, a, b, 0.55, T + 0.12, LOOK["base_dark"], openings=[(o[0], o[1] + 0.24, 0.0, 0.7) for o in ops], col=None)
        dx, dy = b[0] - a[0], b[1] - a[1]
        yaw = math.degrees(math.atan2(dy, dx))
        with p.frame(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0), rot_z=yaw):
            for o in ops:
                u = o[0] - length / 2
                for tri in arch_quads(u):
                    slab(p, tri, -T / 2, T / 2, LOOK["base"], col="wall")
                # arch ring and keystone on the outside face (mesh only)
                r0, r1 = ARCH_W / 2, ARCH_W / 2 + 0.28
                for k in range(6):
                    a0, a1 = math.radians(180 - 30 * k), math.radians(150 - 30 * k)
                    pts = [(u + r0 * math.cos(a0), ARCH_SPRING + r0 * math.sin(a0)), (u + r1 * math.cos(a0), ARCH_SPRING + r1 * math.sin(a0)),
                           (u + r1 * math.cos(a1), ARCH_SPRING + r1 * math.sin(a1)), (u + r0 * math.cos(a1), ARCH_SPRING + r0 * math.sin(a1))]
                    slab(p, pts, -T / 2 - 0.08, -T / 2, LOOK["base_dark"])
                slab(p, [(u - 0.22, ARCH_SPRING + r0 - 0.05), (u + 0.22, ARCH_SPRING + r0 - 0.05), (u + 0.3, ARCH_SPRING + r1 + 0.12),
                         (u - 0.3, ARCH_SPRING + r1 + 0.12)], -T / 2 - 0.12, -T / 2, LOOK["trim"])
    # cornice over the arcade (mesh only)
    p.boxmm((-HALF - 0.18, -HALF - 0.18, HALL_TOP - 0.05), (HALF + 0.18, HALF + 0.18, HALL_TOP + 0.3), LOOK["base_dark"], bottom=True)
    # the core, four columns and four planters: cover inside the hall
    p.boxmm((-CORE, -CORE, GF), (CORE, CORE, HALL_TOP), LOOK["base"], col="wall")
    for (cx, cy), yaw in FACES:
        with p.frame((cx * CORE / HALF, cy * CORE / HALF, 0), rot_z=yaw):
            p.boxmm((-0.75, -0.06, GF), (0.75, 0.0, 2.4), LOOK["band"])                        # lift door
            p.boxmm((-0.9, -0.08, 2.4), (0.9, 0.0, 2.6), LOOK["trim"])
            p.boxmm((-CORE, -0.05, 3.2), (CORE, 0.0, 3.5), LOOK["trim"])                      # yellow band
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.4, HALL_TOP - GF, (sx * 5.5, sy * 5.5, (HALL_TOP + GF) / 2), LOOK["base"], segs=8, col="block", phase=math.pi / 8)
            p.cyl(0.55, 0.3, (sx * 5.5, sy * 5.5, GF + 0.15), LOOK["base_dark"], segs=8, phase=math.pi / 8)
            p.cyl(0.55, 0.3, (sx * 5.5, sy * 5.5, HALL_TOP - 0.15), LOOK["base_dark"], segs=8, phase=math.pi / 8)
    for (cx, cy), yaw in FACES:
        with p.frame((cx * 5.0 / HALF, cy * 5.0 / HALF, 0), rot_z=yaw):
            p.boxmm((-1.3, -0.4, GF), (1.3, 0.4, GF + 0.95), LOOK["base_dark"], col="cover", top="hedge_dark", bottom=True)
    # ceiling beams (mesh only, 5.7 m up)
    for k in (-1, 1):
        p.boxmm((-HALF + T, k * 3.6 - 0.18, HALL_TOP - 0.3), (HALF - T, k * 3.6 + 0.18, HALL_TOP), LOOK["base_dark"], bottom=True)
        p.boxmm((k * 3.6 - 0.18, -HALF + T, HALL_TOP - 0.3), (k * 3.6 + 0.18, HALF - T, HALL_TOP), LOOK["base_dark"], bottom=True)


# ---------------------------------------------------------------- shaft and crown
def shaft(p, lod=0):
    """The solid block over the hall: one wall collider, a dark body with glass strips and the lettering band."""
    p.boxmm((-HALF, -HALF, HALL_TOP), (HALF, HALF, SHAFT_TOP), LOOK["body"], col="wall" if lod == 0 else None, bottom=True)
    for (cx, cy), yaw in FACES:
        with p.frame((cx, cy, 0), rot_z=yaw):
            if lod == 0:
                for u in (-5.6, -2.8, 0.0, 2.8, 5.6):
                    p.boxmm((u - 0.5, -0.04, HALL_TOP + 0.9), (u + 0.5, 0.0, BAND[0] - 0.7), LOOK["glass"], bottom=True)
                    p.boxmm((u - 0.62, -0.1, BAND[0] - 0.7), (u + 0.62, 0.0, BAND[0] - 0.5), LOOK["base"], bottom=True)
                for u in (-HALF + 0.3, HALF - 0.3):
                    p.boxmm((u - 0.3, -0.12, HALL_TOP + 0.3), (u + 0.3, 0.0, BAND[0] - 0.15), LOOK["base"], bottom=True)
                    p.boxmm((u - 0.3, -0.12, BAND[1] + 0.15), (u + 0.3, 0.0, SHAFT_TOP - 0.4), LOOK["base"], bottom=True)
                for z in (BAND[0] - 0.15, BAND[1]):
                    p.boxmm((-HALF - 0.06, -0.12, z), (HALF + 0.06, 0.0, z + 0.15), LOOK["trim"], bottom=True)
            else:
                for u in (-5.6, -2.8, 0.0, 2.8, 5.6):
                    p.patch((u, 0, (HALL_TOP + BAND[0]) / 2 + 0.1), (0, -1, 0), 1.0, BAND[0] - HALL_TOP - 1.6, LOOK["glass"])
    p.boxmm((-HALF - 0.25, -HALF - 0.25, SHAFT_TOP - 0.4), (HALF + 0.25, HALF + 0.25, SHAFT_TOP), LOOK["base"], bottom=True)


def crown(p, lod=0):
    pts = [(sx * EAVE, sy * EAVE, SHAFT_TOP) for sx in (-1, 1) for sy in (-1, 1)] + [(0, 0, APEX)]
    p.hull(pts, LOOK["crown"], col="roof" if lod == 0 else None)
    if lod < 2:
        for sx in (-1, 1):
            for sy in (-1, 1):
                p.tube((sx * EAVE, sy * EAVE, SHAFT_TOP + 0.05), (0, 0, APEX + 0.05), 0.12, LOOK["trim"], segs=4)
    # the beacon: a yellow lantern on a short mast
    p.tube((0, 0, APEX - 0.3), (0, 0, APEX + 1.0), 0.1, "steel_dark", segs=6)
    p.sphere(0.42, (0, 0, APEX + 1.3), LOOK["trim"], segs=8, rings=4, smooth=False)


# ---------------------------------------------------------------- the prop
def qorechain_tower(lod=0):
    if lod > 0:
        return tower_lod(lod)
    p = Prop("qorechain_tower", "landmark")
    arcade(p)
    shaft(p)
    lettering(p)
    crown(p)
    inner = HALF - T
    p.meta["probes"] = []
    for (cx, cy), yaw in FACES:
        nx, ny = cx / HALF, cy / HALF
        tx, ty = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        for u in (ARCH_AT[0], ARCH_AT[-1]):
            # straight in through each side arch, to the corridor around the core
            out = (nx * (HALF + 2.0) + tx * u, ny * (HALF + 2.0) + ty * u, GF)
            inside = (nx * 3.4 + tx * u, ny * 3.4 + ty * u, GF)
            p.meta["probes"].append((out, inside, f"arch {int(yaw)} {u:+.1f}"))
    p.meta["probes"].append(((-4.5, -3.4, GF), (4.5, -3.4, GF), "front corridor"))
    p.meta["probes"].append(((-4.5, 3.4, GF), (4.5, 3.4, GF), "back corridor"))
    p.meta["walk"] = [(-4.5, -HALF - 2.5, 0.0), (-4.5, -inner + 1.0, GF), (-4.5, 3.4, GF), (4.5, 3.4, GF), (4.5, HALF + 2.5, 0.0)]
    p.meta["note"] = ("QoreChain Tower: open arcade hall (3 arches per side, solid core, columns, planters); "
                      "the shaft and the 60 degree crown cannot be reached; QORECHAIN on all four faces")
    return p


def tower_lod(lod):
    """Closed shell: the hall as a block with dark arch decals, the shaft, the flat lettering, the crown."""
    p = Prop("qorechain_tower", "landmark")
    p.boxmm((-HALF - 0.3, -HALF - 0.3, -0.6), (HALF + 0.3, HALF + 0.3, GF), LOOK["base_dark"], top=LOOK["floor"])
    p.boxmm((-HALF, -HALF, GF), (HALF, HALF, HALL_TOP), LOOK["base"], bottom=True)
    p.boxmm((-HALF - 0.18, -HALF - 0.18, HALL_TOP - 0.05), (HALF + 0.18, HALF + 0.18, HALL_TOP + 0.3), LOOK["base_dark"], bottom=True)
    for (cx, cy), yaw in FACES:
        with p.frame((cx, cy, 0), rot_z=yaw):
            for u in ARCH_AT:
                r = ARCH_W / 2
                p.patch((u, 0, (ARCH_SPRING + GF) / 2), (0, -1, 0), ARCH_W, ARCH_SPRING - GF, "window")
                if lod == 1:
                    for k in range(3):
                        a0, a1 = math.radians(180 - 60 * k), math.radians(120 - 60 * k)
                        tri = [(u, -0.03, ARCH_SPRING), (u + r * math.cos(a0), -0.03, ARCH_SPRING + r * math.sin(a0)),
                               (u + r * math.cos(a1), -0.03, ARCH_SPRING + r * math.sin(a1))]
                        p.add(tri, [(0, 2, 1)], "window", closed=False)
    shaft(p, lod)
    lettering(p, flat=True)
    crown(p, lod)
    return p
