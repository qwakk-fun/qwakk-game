"""Flat decals for banners and plaques: the Qwakk duck mark and the QORECHAIN word.

The duck mark is our own brand mark (apps/client/public/ui/brand-mark.svg: a yellow Q ring with a feather tuft,
an orange beak as the tail of the Q and a yellow eye), traced here into polygons by sampling its Bezier curves,
so no font or image file is involved. The word reuses the convex-quad glyphs of qorechain_tower.py (text only,
no logo).

A decal is a list of (polygon, cell, layer): polygon in (u, v), u to the right and v up, centered on (0, 0).
`draw` puts it on a plane of the current Prop frame: the plane y = `y`, facing -Y (`side=-1`) or +Y (`side=1`).
The +Y copy is mirrored, so text and the mark read the right way round from both sides of a banner.
"""

import math

import qorechain_tower

# brand-mark.svg, viewBox 0..64, inside a group translate(3 1) scale(.86)
_G = (0.86, 3.0, 1.0)


def _svg(x, y):
    s, tx, ty = _G
    return (x * s + tx, y * s + ty)


def _bezier(p0, c1, c2, p1, n=8, skip_first=False):
    out = []
    for k in range(1 if skip_first else 0, n + 1):
        t = k / n
        a = (1 - t) ** 3
        b = 3 * (1 - t) ** 2 * t
        c = 3 * (1 - t) * t * t
        d = t ** 3
        out.append((a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]))
    return out


def _rel(start, *pts):
    return [(start[0] + x, start[1] + y) for x, y in pts]


def mark(size=1.0, segs=20):
    """The duck mark scaled to `size` meters across the 64 unit box (the ring is about 0.58 of it)."""
    k = size / 64.0

    def uv(pt):
        x, y = _svg(*pt)
        return ((x - 32.0) * k, (32.0 - y) * k)

    out = []
    # the Q ring: circle (28, 34) r 16.5, stroke 10
    cx, cy = 28.0, 34.0
    r_in, r_out = 16.5 - 5.0, 16.5 + 5.0
    for j in range(segs):
        a0 = 2 * math.pi * j / segs
        a1 = 2 * math.pi * (j + 1) / segs
        quad = [(cx + math.cos(a0) * r_out, cy + math.sin(a0) * r_out), (cx + math.cos(a1) * r_out, cy + math.sin(a1) * r_out),
                (cx + math.cos(a1) * r_in, cy + math.sin(a1) * r_in), (cx + math.cos(a0) * r_in, cy + math.sin(a0) * r_in)]
        out.append(([uv(q) for q in quad], "yellow", 1))
    # the eye: circle (31.5, 29.5) r 3.8
    eye = [(31.5 + math.cos(2 * math.pi * j / 12) * 3.8, 29.5 + math.sin(2 * math.pi * j / 12) * 3.8) for j in range(12)]
    out.append(([uv(q) for q in eye], "yellow", 1))
    # the beak: M37.5 42.5 c7-3.6 16-3.8 23 .2 -3.2 7.8-14.5 11-22.6 7.2z
    p0 = (37.5, 42.5)
    c1, c2, p1 = _rel(p0, (7, -3.6), (16, -3.8), (23, 0.2))
    q1, q2, p2 = _rel(p1, (-3.2, 7.8), (-14.5, 11), (-22.6, 7.2))
    beak = _bezier(p0, c1, c2, p1) + _bezier(p1, q1, q2, p2, skip_first=True)
    out.append(([uv(q) for q in beak], "orange", 2))
    # the tuft: M26 13.5c-1.5-5-8-6.5-10.5-3 3.5-.5 6.5.8 8 3.6z
    t0 = (26.0, 13.5)
    d1, d2, t1 = _rel(t0, (-1.5, -5), (-8, -6.5), (-10.5, -3))
    e1, e2, t2 = _rel(t1, (3.5, -0.5), (6.5, 0.8), (8, 3.6))
    tuft = _bezier(t0, d1, d2, t1) + _bezier(t1, e1, e2, t2, skip_first=True)
    out.append(([uv(q) for q in tuft], "yellow", 1))
    return out


def word(height, text=qorechain_tower.TEXT, cell="yellow"):
    """QORECHAIN as convex quads, `height` meters tall (cap height), centered on (0, 0). Returns (decal, width)."""
    pieces, width = qorechain_tower.text_layout(text)
    k = height / qorechain_tower.LETTER_H
    out = []
    for quads, tail in pieces:
        for q in quads:
            out.append(([(u * k, (v - qorechain_tower.LETTER_H / 2) * k) for u, v in q], cell, 1))
        for q in tail:
            out.append(([(u * k, (v - qorechain_tower.LETTER_H / 2) * k) for u, v in q], cell, 2))
    return out, width * k


def ring(r_out, r_in, cell, segs=20, layer=0):
    out = []
    for j in range(segs):
        a0 = 2 * math.pi * j / segs
        a1 = 2 * math.pi * (j + 1) / segs
        out.append(([(math.cos(a0) * r_out, math.sin(a0) * r_out), (math.cos(a1) * r_out, math.sin(a1) * r_out),
                     (math.cos(a1) * r_in, math.sin(a1) * r_in), (math.cos(a0) * r_in, math.sin(a0) * r_in)], cell, layer))
    return out


def disc(r, cell, segs=20, layer=0):
    return [([(math.cos(2 * math.pi * j / segs) * r, math.sin(2 * math.pi * j / segs) * r) for j in range(segs)], cell, layer)]


def draw(p, decal, center, y, side=-1, step=0.006):
    """Add the decal on the plane y (current frame), centered on (u, z) = center, facing -Y (side -1) or +Y (1).
    Each layer sits `step` further out, so stacked pieces never z-fight."""
    cu, cz = center
    for poly, cell, layer in decal:
        yy = y + side * step * (layer + 1)
        if side < 0:
            pts = [(cu + u, cz + v) for u, v in poly]
        else:
            pts = [(cu - u, cz + v) for u, v in poly]
        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))
        ccw = area > 0
        # counterclockwise in (u, z) faces -Y; the +Y face takes the other winding
        ring_pts = pts if (ccw == (side < 0)) else pts[::-1]
        p.add([(u, yy, z) for u, z in ring_pts], [tuple(range(len(ring_pts)))], cell, closed=False)
