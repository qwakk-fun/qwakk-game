"""Furniture and small decorations for the house interiors.

Every piece is built in its own frame: origin on the floor at the piece's center, front facing -Y.
Place it with `at(p, x, y, z, yaw)` (yaw in degrees: 0 faces -Y, 180 faces +Y, 90 faces +X, -90 faces -X).
Pieces that block movement get one `cover` collider (box or cylinder) for the whole piece; small
decorations (plates, jars, books, lamps) are mesh only. Furniture tops that hold loot are flat and their
collider top is the loot height.
"""

import math
from contextlib import contextmanager

from kit import Rng


@contextmanager
def at(p, x, y, z, yaw=0.0):
    with p.frame((x, y, z), rot_z=yaw):
        yield


# ---------------------------------------------------------------- small decorations (mesh only)
def plate(p, x, y, z, cell="cream"):
    p.cyl(0.12, 0.02, (x, y, z + 0.01), cell, segs=6)


def bottle(p, x, y, z, cell="book_green"):
    p.cyl(0.045, 0.22, (x, y, z + 0.11), cell, segs=6, r2=0.04)
    p.cyl(0.018, 0.08, (x, y, z + 0.26), cell, segs=4)


def jar(p, x, y, z, cell="glass", lid="copper"):
    p.cyl(0.07, 0.16, (x, y, z + 0.08), cell, segs=6, cap_cell=lid)


def loaf(p, x, y, z, rot=0.0):
    p.sphere((0.19, 0.08, 0.07), (x, y, z + 0.06), "bread", segs=6, rings=4, rot=(0, 0, rot), smooth=False)


def candle(p, x, y, z):
    p.cyl(0.05, 0.03, (x, y, z + 0.015), "bronze", segs=6)
    p.cyl(0.02, 0.14, (x, y, z + 0.1), "cream", segs=5)


def pot(p, x, y, z, r=0.16, cell="iron"):
    p.cyl(r, r * 1.1, (x, y, z + r * 0.55), cell, segs=8, r2=r * 0.9, cap_cell="char")


def books(p, x0, x1, y, z, rng, h=0.26, depth=0.2):
    """A row of books standing on a board from x0 to x1 (mesh only, a few blocks of varied color)."""
    cells = ("book_red", "book_blue", "book_green", "wood_light", "cream")
    x = x0
    while x < x1 - 0.08:
        w = min(rng.range(0.2, 0.42), x1 - x)
        hh = h * rng.range(0.75, 1.0)
        p.boxmm((x, y - depth / 2, z), (x + w - 0.01, y + depth / 2, z + hh), cells[int(rng() * len(cells))], bottom=True)
        x += w + rng.range(0.0, 0.06)


def picture(p, x, y, z, w, h, normal, art="grass", sky="glass"):
    """Framed painting hanging on a wall; `normal` is the room side ('+x', '-x', '+y', '-y')."""
    t = 0.04
    if normal in ("+y", "-y"):
        s = 1 if normal == "+y" else -1
        p.boxmm((x - w / 2, y + (0 if s > 0 else -t), z - h / 2), (x + w / 2, y + (t if s > 0 else 0), z + h / 2), "wood_dark", bottom=True)
        p.boxmm((x - w / 2 + 0.06, y + s * t, z - h / 2 + 0.06), (x + w / 2 - 0.06, y + s * (t + 0.006), z), art, bottom=True)
        p.boxmm((x - w / 2 + 0.06, y + s * t, z), (x + w / 2 - 0.06, y + s * (t + 0.006), z + h / 2 - 0.06), sky, bottom=True)
    else:
        s = 1 if normal == "+x" else -1
        y0, y1 = y - w / 2, y + w / 2
        xa, xb = sorted((x, x + s * t))
        p.boxmm((xa, y0, z - h / 2), (xb, y1, z + h / 2), "wood_dark", bottom=True)
        xc, xd = sorted((x + s * t, x + s * (t + 0.006)))
        p.boxmm((xc, y0 + 0.06, z - h / 2 + 0.06), (xd, y1 - 0.06, z), art, bottom=True)
        p.boxmm((xc, y0 + 0.06, z), (xd, y1 - 0.06, z + h / 2 - 0.06), sky, bottom=True)


def pendant(p, x, y, z_ceiling, drop=0.55, shade="iron"):
    p.box((0.025, 0.025, drop), (x, y, z_ceiling - drop / 2), "dark", bottom=True)
    p.cyl(0.24, 0.16, (x, y, z_ceiling - drop - 0.06), shade, segs=8, r2=0.06, caps=False)
    p.sphere(0.07, (x, y, z_ceiling - drop - 0.12), "lamp_glass", segs=6, rings=3, smooth=False)


def rug(p, x0, y0, x1, y1, z, outer="rug_red", inner="rug_gold", band=0.18):
    p.boxmm((x0, y0, z), (x1, y1, z + 0.016), outer)
    p.boxmm((x0 + band, y0 + band, z), (x1 - band, y1 - band, z + 0.022), inner)
    p.boxmm((x0 + band * 2, y0 + band * 2, z), (x1 - band * 2, y1 - band * 2, z + 0.026), outer)


# ---------------------------------------------------------------- tables and seats
def table(p, w, d, h=0.78, top="wood_light", leg="wood_dark", cloth=None, col=True):
    p.boxmm((-w / 2, -d / 2, h - 0.07), (w / 2, d / 2, h), "wood", top=top, bottom=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.08, 0.08, h - 0.07), (sx * (w / 2 - 0.09), sy * (d / 2 - 0.09), (h - 0.07) / 2), leg, bottom=True)
    p.boxmm((-w / 2 + 0.06, -d / 2 + 0.06, h - 0.18), (w / 2 - 0.06, d / 2 - 0.06, h - 0.07), leg, bottom=True)
    if cloth:
        p.boxmm((-w / 2 + 0.15, -d / 2 - 0.03, h - 0.12), (w / 2 - 0.15, d / 2 + 0.03, h + 0.008), cloth, bottom=True)
    if col:
        p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h))


def round_table(p, r=0.45, h=0.75, top="wood_light"):
    p.cyl(r, 0.05, (0, 0, h - 0.025), top, segs=10)
    p.cyl(0.05, h - 0.05, (0, 0, (h - 0.05) / 2), "wood_dark", segs=5)
    p.cyl(0.25, 0.04, (0, 0, 0.02), "wood_dark", segs=6)
    p.col_cyl("cover", (0, 0, h / 2), r, h)


def bench(p, w, d=0.32, h=0.45):
    p.boxmm((-w / 2, -d / 2, h - 0.06), (w / 2, d / 2, h), "wood", top="wood_light", bottom=True)
    for x in (-w / 2 + 0.12, w / 2 - 0.12):
        p.boxmm((x - 0.04, -d / 2 + 0.03, 0), (x + 0.04, d / 2 - 0.03, h - 0.06), "wood_dark", bottom=True)
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h))


def chair(p, seat="wood", col=True):
    """Ladder-back chair, back at +Y."""
    p.boxmm((-0.22, -0.22, 0.4), (0.22, 0.22, 0.46), seat, bottom=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            hgt = 0.98 if sy > 0 else 0.4
            p.box((0.05, 0.05, hgt), (sx * 0.18, sy * 0.18, hgt / 2), "wood_dark", bottom=True)
    for z in (0.65, 0.85):
        p.boxmm((-0.18, 0.16, z - 0.035), (0.18, 0.2, z + 0.035), "wood_dark", bottom=True)
    if col:
        p.col_boxmm("cover", (-0.22, -0.22, 0), (0.22, 0.22, 0.98))


def stool(p):
    p.cyl(0.18, 0.05, (0, 0, 0.5), "wood", segs=8)
    for k in range(3):
        a = 2 * math.pi * k / 3
        p.tube((math.cos(a) * 0.08, math.sin(a) * 0.08, 0.48), (math.cos(a) * 0.17, math.sin(a) * 0.17, 0.0), 0.025, "wood_dark", segs=4)


def armchair(p, cell="fabric_red", w=0.85):
    """Upholstered armchair, back at +Y."""
    p.boxmm((-w / 2 + 0.12, -0.38, 0.12), (w / 2 - 0.12, 0.3, 0.44), cell, bottom=True)
    p.boxmm((-w / 2 + 0.1, 0.22, 0.12), (w / 2 - 0.1, 0.42, 1.0), cell, bottom=True)
    for sx in (-1, 1):
        p.boxmm((sx * w / 2 - (0.14 if sx > 0 else 0), -0.4, 0.12), (sx * w / 2 + (0 if sx > 0 else 0.14), 0.42, 0.66), cell, bottom=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.06, 0.06, 0.12), (sx * (w / 2 - 0.08), sy * 0.34, 0.06), "wood_dark", bottom=True)
    p.col_boxmm("cover", (-w / 2, -0.42, 0), (w / 2, 0.42, 1.0))


def sofa(p, w=1.9, cell="fabric_green"):
    p.boxmm((-w / 2 + 0.15, -0.4, 0.12), (w / 2 - 0.15, 0.28, 0.45), cell, bottom=True)
    for k in (-1, 1):
        p.boxmm((k * 0.02 + (-w / 2 + 0.17 if k < 0 else 0.02), -0.38, 0.45), ((-0.02 if k < 0 else w / 2 - 0.17), 0.2, 0.55), cell, bottom=True)
    p.boxmm((-w / 2 + 0.1, 0.22, 0.12), (w / 2 - 0.1, 0.44, 0.95), cell, bottom=True)
    for sx in (-1, 1):
        p.boxmm((sx * w / 2 - (0.16 if sx > 0 else 0), -0.42, 0.12), (sx * w / 2 + (0 if sx > 0 else 0.16), 0.44, 0.68), cell, bottom=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.06, 0.06, 0.12), (sx * (w / 2 - 0.1), sy * 0.36, 0.06), "wood_dark", bottom=True)
    p.col_boxmm("cover", (-w / 2, -0.44, 0), (w / 2, 0.44, 0.95))


# ---------------------------------------------------------------- beds and storage
def bed(p, w, l, blanket="fabric_blue", frame="wood_dark", foot=True):
    """Bed with the headboard at +Y (against the wall), pillow, folded-back sheet and blanket."""
    hl = l / 2
    p.boxmm((-w / 2, -hl, 0.12), (w / 2, hl, 0.32), frame, bottom=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.07, 0.07, 0.14), (sx * (w / 2 - 0.05), sy * (hl - 0.05), 0.06), frame, bottom=True)
    p.boxmm((-w / 2 + 0.04, -hl + 0.04, 0.32), (w / 2 - 0.04, hl - 0.06, 0.46), "cream")
    p.boxmm((-w / 2 + 0.01, -hl + 0.02, 0.4), (w / 2 - 0.01, hl - 0.75, 0.5), blanket, bottom=True)
    p.boxmm((-w / 2 + 0.03, hl - 0.85, 0.44), (w / 2 - 0.03, hl - 0.72, 0.52), "cream")
    npil = 2 if w > 1.2 else 1
    for i in range(npil):
        px = -w / 4 + i * w / 2 if npil == 2 else 0.0
        p.box((w / npil - 0.2, 0.34, 0.13), (px, hl - 0.3, 0.52), "cream", bevel=0.04)
    p.boxmm((-w / 2 - 0.03, hl - 0.06, 0.0), (w / 2 + 0.03, hl + 0.02, 1.05), frame, top="wood", bottom=True)
    p.box((w * 0.7, 0.03, 0.35), (0, hl - 0.075, 0.72), "wood", bottom=True)
    if foot:
        p.boxmm((-w / 2 - 0.03, -hl - 0.02, 0.0), (w / 2 + 0.03, -hl + 0.05, 0.7), frame, top="wood", bottom=True)
    p.col_boxmm("cover", (-w / 2, -hl, 0), (w / 2, hl, 0.55))


def wardrobe(p, w=1.1, d=0.58, h=2.0, cell="wood_dark"):
    p.boxmm((-w / 2, -d / 2, 0.08), (w / 2, d / 2, h - 0.1), cell, bottom=True)
    p.boxmm((-w / 2 - 0.04, -d / 2 - 0.04, h - 0.1), (w / 2 + 0.04, d / 2 + 0.02, h), "wood", bottom=True)
    p.boxmm((-w / 2 + 0.03, -d / 2 - 0.02, 0.0), (w / 2 - 0.03, d / 2, 0.1), "wood", bottom=True)
    for sx in (-1, 1):
        x0 = 0.03 if sx > 0 else -w / 2 + 0.06
        x1 = w / 2 - 0.06 if sx > 0 else -0.03
        p.boxmm((x0, -d / 2 - 0.025, 0.2), (x1, -d / 2, h - 0.22), "wood", bottom=True)
        p.box((0.03, 0.03, 0.16), (sx * 0.07, -d / 2 - 0.04, h * 0.52), "bronze", bottom=True)
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h))


def chest_of_drawers(p, w=1.0, d=0.5, h=0.9, mirror=False):
    p.boxmm((-w / 2, -d / 2, 0.06), (w / 2, d / 2, h - 0.04), "wood", bottom=True)
    p.boxmm((-w / 2 - 0.03, -d / 2 - 0.03, h - 0.04), (w / 2 + 0.03, d / 2 + 0.01, h), "wood_dark", top="wood_light", bottom=True)
    n = 3
    for i in range(n):
        z0 = 0.1 + i * (h - 0.18) / n
        z1 = z0 + (h - 0.18) / n - 0.04
        p.boxmm((-w / 2 + 0.05, -d / 2 - 0.02, z0), (w / 2 - 0.05, -d / 2, z1), "wood_light", bottom=True)
        for sx in (-1, 1):
            p.box((0.1, 0.03, 0.03), (sx * w / 4, -d / 2 - 0.035, (z0 + z1) / 2), "bronze", bottom=True)
    if mirror:
        p.boxmm((-w / 2 + 0.12, d / 2 - 0.06, h), (w / 2 - 0.12, d / 2 - 0.02, h + 0.75), "wood_dark", bottom=True)
        p.boxmm((-w / 2 + 0.18, d / 2 - 0.075, h + 0.06), (w / 2 - 0.18, d / 2 - 0.06, h + 0.69), "glass", bottom=True)
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h))


def nightstand(p, with_candle=True):
    p.boxmm((-0.24, -0.2, 0.0), (0.24, 0.2, 0.55), "wood", top="wood_light", bottom=True)
    p.boxmm((-0.2, -0.22, 0.32), (0.2, -0.2, 0.5), "wood_light", bottom=True)
    if with_candle:
        candle(p, 0.08, 0.04, 0.55)
    p.col_boxmm("cover", (-0.24, -0.2, 0), (0.24, 0.2, 0.55))


def trunk(p, w=0.95, d=0.5, h=0.55, cell="wood"):
    p.boxmm((-w / 2, -d / 2, 0), (w / 2, d / 2, h - 0.12), cell, bottom=True)
    p.boxmm((-w / 2 - 0.02, -d / 2 - 0.02, h - 0.12), (w / 2 + 0.02, d / 2 + 0.02, h), "wood_dark", top=cell, bottom=True)
    for x in (-w / 2 + 0.15, w / 2 - 0.15):
        p.boxmm((x - 0.04, -d / 2 - 0.03, 0.02), (x + 0.04, d / 2 + 0.03, h + 0.01), "iron", bottom=True)
    p.box((0.1, 0.03, 0.1), (0, -d / 2 - 0.035, h - 0.15), "bronze", bottom=True)
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h))


def bookcase(p, w=1.2, d=0.36, h=1.9, rng=None, cell="wood_dark"):
    """Open bookcase, back at +Y, five boards of books (cover collider over the whole case)."""
    rng = rng or Rng(int(w * 100))
    t = 0.04
    p.boxmm((-w / 2, d / 2 - t, 0), (w / 2, d / 2, h), cell, bottom=True)
    for sx in (-1, 1):
        p.boxmm((sx * w / 2 - (t if sx > 0 else 0), -d / 2, 0), (sx * w / 2 + (0 if sx > 0 else t), d / 2, h), cell, bottom=True)
    p.boxmm((-w / 2 - 0.02, -d / 2 - 0.02, h), (w / 2 + 0.02, d / 2, h + 0.05), cell, bottom=True)
    for k in range(5):
        z = 0.06 + k * (h - 0.1) / 4.6
        p.boxmm((-w / 2 + t, -d / 2, z - 0.03), (w / 2 - t, d / 2 - t, z), "wood", bottom=True)
        if k < 4:
            books(p, -w / 2 + t + 0.02, w / 2 - t - 0.02, 0.02, z, rng, h=min(0.3, (h - 0.1) / 4.6 - 0.06))
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h + 0.05))


def hutch(p, w=1.5, d=0.5, rng=None):
    """Kitchen dresser: closed lower cabinet (top at 0.92 m, loot spot) and an open plate rack above it."""
    rng = rng or Rng(17)
    p.boxmm((-w / 2, -d / 2, 0.06), (w / 2, d / 2, 0.88), "wood", bottom=True)
    p.boxmm((-w / 2 - 0.03, -d / 2 - 0.03, 0.88), (w / 2 + 0.03, d / 2, 0.92), "wood_dark", top="wood_light", bottom=True)
    for sx in (-1, 1):
        p.boxmm((sx * 0.02 + (0 if sx > 0 else -w / 2 + 0.06), -d / 2 - 0.02, 0.12), ((w / 2 - 0.06) if sx > 0 else -0.02, -d / 2, 0.62), "wood_light", bottom=True)
    p.boxmm((-w / 2 + 0.06, -d / 2 - 0.02, 0.66), (w / 2 - 0.06, -d / 2, 0.82), "wood_light", bottom=True)
    # plate rack (behind the counter, against the wall)
    rd = 0.24
    y0 = d / 2 - rd
    p.boxmm((-w / 2 + 0.04, d / 2 - 0.03, 0.92), (w / 2 - 0.04, d / 2, 1.95), "wood", bottom=True)
    for sx in (-1, 1):
        p.boxmm((sx * (w / 2 - 0.04) - 0.03, y0, 0.92), (sx * (w / 2 - 0.04) + 0.03, d / 2, 1.95), "wood_dark", bottom=True)
    p.boxmm((-w / 2 + 0.02, y0 - 0.02, 1.95), (w / 2 - 0.02, d / 2, 2.02), "wood_dark", bottom=True)
    for z in (1.28, 1.62):
        p.boxmm((-w / 2 + 0.04, y0, z - 0.03), (w / 2 - 0.04, d / 2, z), "wood_dark", bottom=True)
        n = int((w - 0.2) / 0.27)
        for i in range(n):
            x = -w / 2 + 0.2 + i * 0.27
            with p.frame((x, d / 2 - 0.09, z + 0.13), rot=(78, 0, 0)):
                p.cyl(0.12, 0.02, (0, 0, 0), "cream" if i % 3 else "shutter_blue", segs=8)
    for i, x in enumerate((-w / 2 + 0.3, 0.05, w / 2 - 0.3)):
        jar(p, x, d / 2 - 0.12, 0.92, cell=("copper", "glass", "tile")[i], lid="wood_dark")
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, 0.92))
    p.col_boxmm("cover", (-w / 2, y0, 0.92), (w / 2, d / 2, 2.02))


# ---------------------------------------------------------------- kitchen and hearth
def fireplace(p, w=1.8, d=0.62, h=2.85, opening=(0.95, 0.85), cell="stone", trim="stone_dark", rng=None, lit=True):
    """Stone chimney breast against a wall (back at +Y) from the floor to `h`: firebox with a soot back,
    hearth slab, mantel shelf, logs and a hanging pot. One wall collider for the breast."""
    ow, oh = opening
    p.boxmm((-w / 2, -d / 2, 0), (-ow / 2, d / 2, oh), cell, bottom=True)
    p.boxmm((ow / 2, -d / 2, 0), (w / 2, d / 2, oh), cell, bottom=True)
    p.boxmm((-w / 2, -d / 2, oh), (w / 2, d / 2, h), cell, bottom=True)
    p.boxmm((-ow / 2, d / 2 - 0.2, 0), (ow / 2, d / 2, oh), "char", bottom=True)
    p.boxmm((-ow / 2, -d / 2 + 0.05, oh - 0.02), (ow / 2, d / 2 - 0.2, oh), "char", bottom=True)
    p.boxmm((-w / 2 - 0.1, -d / 2 - 0.4, 0), (w / 2 + 0.1, d / 2, 0.05), trim)
    p.boxmm((-w / 2 - 0.12, -d / 2 - 0.12, 1.32), (w / 2 + 0.12, d / 2, 1.42), "timber", top="wood_dark", bottom=True)
    for sx in (-1, 1):
        p.boxmm((sx * (ow / 2 + 0.06) - 0.08, -d / 2 - 0.05, 0), (sx * (ow / 2 + 0.06) + 0.08, -d / 2, oh + 0.08), trim, bottom=True)
    p.boxmm((-ow / 2 - 0.14, -d / 2 - 0.05, oh), (ow / 2 + 0.14, -d / 2, oh + 0.18), trim, bottom=True)
    # logs, embers, a pot on a hook
    p.tube((-0.3, 0.0, 0.1), (0.25, 0.08, 0.12), 0.07, "trunk", segs=5)
    p.tube((-0.22, 0.12, 0.12), (0.3, -0.04, 0.2), 0.065, "trunk_dark", segs=5)
    p.sphere((0.25, 0.12, 0.05), (0, 0.03, 0.08), "orange" if lit else "char", segs=6, rings=3, smooth=False)
    p.box((0.02, 0.02, 0.4), (0.0, 0.06, oh - 0.22), "iron", bottom=True)
    pot(p, 0.0, 0.06, 0.3, r=0.15)
    # mantel things
    candle(p, -w / 2 + 0.2, -d / 2 + 0.05, 1.42)
    candle(p, w / 2 - 0.2, -d / 2 + 0.05, 1.42)
    jar(p, -0.25, -d / 2 + 0.06, 1.42, cell="copper", lid="copper")
    p.boxmm((0.0, -d / 2 + 0.02, 1.42), (0.34, -d / 2 + 0.1, 1.68), "wood_dark", bottom=True)
    p.cyl(0.1, 0.02, (0.17, -d / 2 + 0.01, 1.56), "cream", segs=8, rot=(90, 0, 0))
    p.col_boxmm("wall", (-w / 2, -d / 2, 0), (w / 2, d / 2, h))


def range_stove(p, w=1.0, d=0.62, flue_to=2.85):
    """Cast iron cooking range with a flue pipe (back at +Y)."""
    p.boxmm((-w / 2, -d / 2, 0.1), (w / 2, d / 2, 0.82), "iron", top="steel_dark", bottom=True)
    p.boxmm((-w / 2 - 0.03, -d / 2 - 0.03, 0.82), (w / 2 + 0.03, d / 2, 0.88), "steel_dark", bottom=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.07, 0.07, 0.1), (sx * (w / 2 - 0.06), sy * (d / 2 - 0.06), 0.05), "iron", bottom=True)
    p.boxmm((-w / 2 + 0.08, -d / 2 - 0.02, 0.25), (0.0, -d / 2, 0.65), "steel", bottom=True)
    p.boxmm((0.06, -d / 2 - 0.02, 0.45), (w / 2 - 0.08, -d / 2, 0.65), "steel", bottom=True)
    p.box((w - 0.1, 0.05, 0.05), (0, -d / 2 - 0.06, 0.72), "bronze", bottom=True)
    p.cyl(0.08, flue_to - 0.88, (w / 2 - 0.2, d / 2 - 0.15, (flue_to + 0.88) / 2), "iron", segs=6)
    pot(p, -0.2, -0.05, 0.88, r=0.14)
    p.cyl(0.1, 0.14, (0.18, 0.05, 0.95), "copper", segs=6, r2=0.07)
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, 0.88))


def sink_counter(p, w=1.8, d=0.6, h=0.9, rng=None):
    """Stone sink in a wooden counter with a hand pump, a shelf of jars above (back at +Y)."""
    p.boxmm((-w / 2, -d / 2, 0.06), (w / 2, d / 2, h - 0.06), "wood", bottom=True)
    p.boxmm((-w / 2 - 0.02, -d / 2 - 0.02, h - 0.06), (w / 2 + 0.02, d / 2, h), "stone_dark", top="stone", bottom=True)
    p.boxmm((-0.45, -d / 2 + 0.08, h), (0.15, d / 2 - 0.08, h + 0.16), "stone", top="char", bottom=True)
    p.tube((0.3, d / 2 - 0.12, h), (0.3, d / 2 - 0.12, h + 0.5), 0.04, "iron", segs=5)
    p.tube((0.3, d / 2 - 0.12, h + 0.42), (0.05, d / 2 - 0.12, h + 0.42), 0.025, "iron", segs=4)
    p.tube((0.3, d / 2 - 0.12, h + 0.5), (0.5, d / 2 - 0.12, h + 0.62), 0.02, "iron", segs=4)
    for sx in (-1, 1):
        p.boxmm((sx * 0.02 + (0 if sx > 0 else -w / 2 + 0.05), -d / 2 - 0.02, 0.12), ((w / 2 - 0.05) if sx > 0 else -0.02, -d / 2, h - 0.12), "wood_light", bottom=True)
    p.boxmm((-w / 2, d / 2 - 0.25, h + 0.75), (w / 2, d / 2, h + 0.79), "wood_dark", bottom=True)
    for i, x in enumerate((-w / 2 + 0.2, -w / 2 + 0.42, 0.1, 0.4, w / 2 - 0.2)):
        jar(p, x, d / 2 - 0.12, h + 0.79, cell=("glass", "copper", "tile", "glass", "cream")[i], lid="wood_dark")
    plate(p, w / 2 - 0.3, -0.05, h)
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h))


def clock(p):
    """Grandfather clock (back at +Y)."""
    p.boxmm((-0.26, -0.18, 0), (0.26, 0.18, 0.4), "wood_dark", bottom=True)
    p.boxmm((-0.2, -0.14, 0.4), (0.2, 0.14, 1.45), "wood_dark", bottom=True)
    p.boxmm((-0.08, -0.15, 0.7), (0.08, -0.14, 1.3), "glass", bottom=True)
    p.cyl(0.07, 0.02, (0, -0.16, 0.85), "bronze", segs=8, rot=(90, 0, 0))
    p.boxmm((-0.26, -0.18, 1.45), (0.26, 0.18, 2.05), "wood_dark", bottom=True)
    p.cyl(0.19, 0.02, (0, -0.19, 1.75), "cream", segs=12, rot=(90, 0, 0))
    p.box((0.02, 0.01, 0.13), (0, -0.205, 1.8), "dark", bottom=True)
    p.box((0.1, 0.01, 0.02), (0.04, -0.205, 1.75), "dark", bottom=True)
    p.prism([(-0.3, 2.05), (0.3, 2.05), (0, 2.25)], 0.38, (0, 0, 0), "wood", axis="Y")
    p.col_boxmm("cover", (-0.26, -0.18, 0), (0.26, 0.18, 2.1))


def radio(p, x, y, z):
    """Tabletop wireless set (mesh only)."""
    p.boxmm((x - 0.24, y - 0.13, z), (x + 0.24, y + 0.13, z + 0.32), "wood_dark", top="wood", bottom=True)
    p.boxmm((x - 0.18, y - 0.135, z + 0.12), (x + 0.04, y - 0.12, z + 0.27), "canvas", bottom=True)
    for dx in (0.1, 0.18):
        p.cyl(0.03, 0.03, (x + dx, y - 0.14, z + 0.16), "bronze", segs=6, rot=(90, 0, 0))
    p.boxmm((x + 0.07, y - 0.135, z + 0.22), (x + 0.21, y - 0.12, z + 0.27), "lamp_glass", bottom=True)


def desk(p, w=1.2, d=0.6, typewriter=True):
    table(p, w, d, h=0.76, col=False)
    p.boxmm((w / 2 - 0.42, -d / 2 + 0.04, 0.3), (w / 2 - 0.06, d / 2 - 0.04, 0.69), "wood", bottom=True)
    if typewriter:
        p.boxmm((-0.25, -0.1, 0.76), (0.15, 0.2, 0.86), "iron", top="steel_dark", bottom=True)
        p.boxmm((-0.24, 0.12, 0.86), (0.14, 0.18, 0.98), "steel_dark", bottom=True)
        p.boxmm((-0.18, 0.17, 0.9), (0.08, 0.19, 1.12), "paper", bottom=True)
    p.boxmm((0.25, -0.15, 0.76), (0.5, 0.15, 0.78), "paper", bottom=True)
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, 0.76))


def washstand(p):
    p.boxmm((-0.35, -0.22, 0.0), (0.35, 0.22, 0.8), "wood", top="white", bottom=True)
    p.cyl(0.2, 0.1, (0, 0, 0.85), "white", segs=10, r2=0.24, cap_cell="glass")
    p.cyl(0.07, 0.26, (0.22, 0.1, 0.93), "white", segs=8, r2=0.05)
    p.boxmm((-0.3, 0.18, 0.8), (0.3, 0.22, 1.5), "wood_dark", bottom=True)
    p.boxmm((-0.24, 0.17, 0.92), (0.24, 0.18, 1.42), "glass", bottom=True)
    p.col_boxmm("cover", (-0.35, -0.22, 0), (0.35, 0.22, 0.8))


def piano(p):
    """Upright piano (back at +Y)."""
    p.boxmm((-0.75, -0.05, 0), (0.75, 0.3, 1.25), "wood_dark", top="wood", bottom=True)
    p.boxmm((-0.72, -0.3, 0.62), (0.72, -0.05, 0.72), "wood_dark", bottom=True)
    p.boxmm((-0.68, -0.28, 0.72), (0.68, -0.06, 0.75), "cream", bottom=True)
    for i in range(14):
        x = -0.64 + i * 0.1
        if i % 7 in (2, 6):
            continue
        p.boxmm((x - 0.015, -0.16, 0.75), (x + 0.015, -0.06, 0.78), "dark", bottom=True)
    for sx in (-1, 1):
        p.boxmm((sx * 0.7 - 0.04, -0.3, 0), (sx * 0.7 + 0.04, -0.26, 0.62), "wood_dark", bottom=True)
    candle(p, -0.55, 0.12, 1.25)
    p.boxmm((-0.25, 0.0, 0.82), (0.25, 0.04, 1.05), "paper", bottom=True)
    p.col_boxmm("cover", (-0.75, -0.3, 0), (0.75, 0.3, 1.25))


def coat_rack(p):
    p.tube((0, 0, 0), (0, 0, 1.75), 0.03, "wood_dark", segs=5)
    for k in range(3):
        a = 2 * math.pi * k / 3
        p.tube((0, 0, 0.05), (math.cos(a) * 0.25, math.sin(a) * 0.25, 0.0), 0.025, "wood_dark", segs=4)
    p.sphere((0.2, 0.12, 0.45), (0.08, 0.0, 1.3), "olive", segs=6, rings=4, smooth=False)
    p.sphere((0.13, 0.13, 0.06), (-0.05, 0.05, 1.78), "field_grey", segs=6, rings=3, smooth=False)


# ---------------------------------------------------------------- storage and shop
def barrel(p, r=0.3, h=0.88, cell="wood_dark", top=None, col=True):
    p.cyl(r, h, (0, 0, h / 2), cell, segs=10, cap_cell=top or "wood")
    for z in (0.15, h - 0.15):
        p.cyl(r + 0.015, 0.05, (0, 0, z), "iron", segs=10, caps=False)
    if col:
        p.col_cyl("cover", (0, 0, h / 2), r, h)


def sack(p, x, y, z, rot=0.0, cell="canvas"):
    p.sphere((0.28, 0.2, 0.22), (x, y, z + 0.2), cell, segs=6, rings=4, rot=(0, 0, rot), smooth=False)
    p.sphere((0.08, 0.08, 0.08), (x, y, z + 0.44), cell, segs=5, rings=3, smooth=False)


def crate(p, s=0.6, cell="wood", col=True):
    p.box((s, s, s), (0, 0, s / 2), cell)
    for sx in (-1, 1):
        p.boxmm((sx * s * 0.3 - 0.04, -s / 2 - 0.012, 0), (sx * s * 0.3 + 0.04, s / 2 + 0.012, s + 0.012), "wood_dark", bottom=True)
    if col:
        p.col_boxmm("cover", (-s / 2, -s / 2, 0), (s / 2, s / 2, s))


def produce_crate(p, cell="apple", w=0.6, d=0.4, h=0.3):
    """Open slatted crate full of fruit or vegetables (mesh only, sits on things)."""
    p.boxmm((-w / 2, -d / 2, 0), (w / 2, d / 2, h), "wood_light", bottom=True)
    p.boxmm((-w / 2 + 0.03, -d / 2 + 0.03, h - 0.06), (w / 2 - 0.03, d / 2 - 0.03, h + 0.04), cell, bottom=True)
    for dx in (-w / 4, w / 4):
        p.sphere(0.07, (dx, 0, h + 0.05), cell, segs=5, rings=3, smooth=False)


def shop_shelf(p, w=2.0, d=0.42, h=2.0, rng=None, goods="mixed"):
    """Shop wall shelving with goods on five boards, back at +Y (one cover collider)."""
    rng = rng or Rng(int(w * 31))
    t = 0.04
    p.boxmm((-w / 2, d / 2 - t, 0), (w / 2, d / 2, h), "shop_green", bottom=True)
    for sx in (-1, 1):
        p.boxmm((sx * w / 2 - (t if sx > 0 else 0), -d / 2, 0), (sx * w / 2 + (0 if sx > 0 else t), d / 2, h), "shop_green", bottom=True)
    p.boxmm((-w / 2 - 0.03, -d / 2 - 0.03, h), (w / 2 + 0.03, d / 2, h + 0.08), "shop_green", bottom=True)
    for k in range(5):
        z = 0.12 + k * 0.42
        p.boxmm((-w / 2 + t, -d / 2, z - 0.03), (w / 2 - t, d / 2 - t, z), "wood_light", bottom=True)
        if k == 4:
            break
        x = -w / 2 + 0.14
        while x < w / 2 - 0.14:
            r = rng()
            if goods == "bread" or (goods == "mixed" and r < 0.3):
                loaf(p, x + 0.06, 0.0, z, rot=rng.range(-20, 20))
                x += 0.36
            elif r < 0.65:
                jar(p, x, 0.02, z, cell=("glass", "tile", "apple")[int(rng() * 3)], lid="copper")
                x += 0.18
            else:
                p.boxmm((x - 0.08, -0.08, z), (x + 0.08, 0.1, z + rng.range(0.16, 0.26)), ("book_red", "cream", "shutter_blue", "khaki")[int(rng() * 4)], bottom=True)
                x += 0.2
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h + 0.08))


def shop_counter(p, w=2.2, d=0.62, h=1.0):
    """Shop counter with a panelled front and a till (front, customer side, at -Y)."""
    p.boxmm((-w / 2, -d / 2, 0.05), (w / 2, d / 2, h - 0.05), "shop_green", bottom=True)
    p.boxmm((-w / 2 - 0.04, -d / 2 - 0.05, h - 0.05), (w / 2 + 0.04, d / 2 + 0.02, h), "wood", top="wood_light", bottom=True)
    p.boxmm((-w / 2 + 0.02, -d / 2 - 0.02, 0.0), (w / 2 - 0.02, d / 2, 0.08), "wood_dark", bottom=True)
    n = max(2, int(w / 0.55))
    for i in range(n):
        x0 = -w / 2 + 0.06 + i * (w - 0.12) / n
        p.boxmm((x0 + 0.04, -d / 2 - 0.02, 0.18), (x0 + (w - 0.12) / n - 0.04, -d / 2, h - 0.18), "cream", bottom=True)
    # till
    p.boxmm((w / 2 - 0.55, -0.12, h), (w / 2 - 0.15, 0.22, h + 0.22), "bronze", top="copper", bottom=True)
    p.boxmm((w / 2 - 0.52, -0.02, h + 0.22), (w / 2 - 0.18, 0.14, h + 0.36), "copper", bottom=True)
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h))


def display_case(p, w=1.4, d=0.55, h=0.95):
    """Glass-topped display counter with pastries inside (loot sits on the glass)."""
    p.boxmm((-w / 2, -d / 2, 0.0), (w / 2, d / 2, 0.55), "shop_green", bottom=True)
    p.boxmm((-w / 2, -d / 2, 0.55), (w / 2, d / 2, 0.58), "wood_light", bottom=True)
    for i in range(4):
        loaf(p, -w / 2 + 0.25 + i * (w - 0.5) / 3, 0.0, 0.58, rot=i * 30)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.04, 0.04, h - 0.58), (sx * (w / 2 - 0.02), sy * (d / 2 - 0.02), (h + 0.58) / 2), "bronze", bottom=True)
    p.boxmm((-w / 2 + 0.02, -d / 2 + 0.02, h - 0.02), (w / 2 - 0.02, d / 2 - 0.02, h), "glass", bottom=True)
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h))


# ---------------------------------------------------------------- farm
def stall(p, w=2.4, d=3.0, h=1.35):
    """Cattle stall: two plank partitions running along Y from the wall at +Y, a feed trough at the back."""
    for sx in (-1, 1):
        x = sx * w / 2
        p.boxmm((x - 0.05, -d / 2, 0), (x + 0.05, d / 2, h), "wood", top="wood_dark", col="cover")
        p.box((0.14, 0.14, h + 0.25), (x, -d / 2 + 0.07, (h + 0.25) / 2), "timber", bottom=True)
        for z in (0.45, 0.95):
            p.boxmm((x - 0.07, -d / 2 + 0.1, z - 0.06), (x + 0.07, d / 2, z + 0.06), "wood_dark", bottom=True)
    p.boxmm((-w / 2 + 0.05, d / 2 - 0.5, 0), (w / 2 - 0.05, d / 2, 0.55), "wood_dark", top="hay", col="cover")
    p.box((w - 0.4, 0.3, 0.06), (0, d / 2 - 0.25, 0.56), "hay", bottom=True)


def milk_churn(p, x, y, z):
    p.cyl(0.17, 0.55, (x, y, z + 0.275), "steel", segs=8, r2=0.15)
    p.cyl(0.1, 0.12, (x, y, z + 0.6), "steel", segs=8)
    p.cyl(0.12, 0.04, (x, y, z + 0.68), "steel_dark", segs=8)


def tool_rack(p, w=1.6):
    """Wall board with hanging tools (back at +Y, mesh only)."""
    p.boxmm((-w / 2, -0.03, 0.9), (w / 2, 0.0, 1.9), "wood_dark", bottom=True)
    tools = [(-0.6, "wood", "steel"), (-0.25, "wood", "rust"), (0.1, "wood_light", "steel"), (0.45, "wood", "steel_dark")]
    for x, handle, head in tools:
        p.tube((x, -0.06, 1.0), (x, -0.06, 1.85), 0.025, handle, segs=4)
        p.box((0.22, 0.03, 0.12), (x, -0.06, 1.88 if head == "rust" else 0.98), head, bottom=True)
    p.tube((0.65, -0.06, 1.5), (0.65, -0.06, 1.8), 0.02, "iron", segs=4)
    p.cyl(0.2, 0.02, (0.65, -0.06, 1.35), "rust", segs=10, rot=(90, 0, 0), caps=False)


def ladder(p, length=3.0, w=0.45, lean=12.0):
    """Ladder leaning on a wall at +Y (mesh only)."""
    with p.frame((0, 0, 0), rot=(lean, 0, 0)):
        for sx in (-1, 1):
            p.box((0.06, 0.05, length), (sx * w / 2, 0, length / 2), "wood", bottom=True)
        n = int(length / 0.4)
        for i in range(1, n):
            p.box((w, 0.035, 0.035), (0, 0, i * 0.4), "wood_dark", bottom=True)


def hay_bale(p, x, y, z, yaw=0.0, col=True):
    p.box((1.2, 0.62, 0.52), (x, y, z + 0.26), "hay", rot_z=yaw, bevel=0.06, col="cover" if col else None, top="hay_dark", bottom=True)
    with p.frame((x, y, z), rot_z=yaw):
        for dx in (-0.3, 0.3):
            p.boxmm((dx - 0.02, -0.32, 0.0), (dx + 0.02, 0.32, 0.53), "hay_dark", bottom=True)


def wheelbarrow(p):
    p.hull([(-0.35, -0.3, 0.3), (0.35, -0.3, 0.3), (-0.35, 0.45, 0.3), (0.35, 0.45, 0.3), (-0.25, -0.2, 0.62), (0.25, -0.2, 0.62),
            (-0.42, 0.55, 0.62), (0.42, 0.55, 0.62)], "rust", cells_fn=lambda c, n: "earth_dark" if n.z > 0.9 else "rust")
    p.cyl(0.2, 0.08, (0, -0.55, 0.2), "tire", segs=8, rot=(0, 90, 0))
    for sx in (-1, 1):
        p.tube((sx * 0.22, -0.55, 0.2), (sx * 0.28, 1.1, 0.55), 0.025, "wood", segs=4)
        p.tube((sx * 0.25, 0.4, 0.3), (sx * 0.25, 0.45, 0.0), 0.025, "wood_dark", segs=4)


def water_trough(p, w=1.8, d=0.6, h=0.6):
    p.boxmm((-w / 2, -d / 2, 0), (w / 2, d / 2, h), "stone", top="stone_dark", col="cover")
    p.boxmm((-w / 2 + 0.08, -d / 2 + 0.08, h - 0.08), (w / 2 - 0.08, d / 2 - 0.08, h + 0.002), "water", bottom=True)


def woodpile(p, w=1.8, d=0.7, h=1.0, rng=None):
    """Stacked logs under a small plank roof (back at +Y), one cover collider."""
    rng = rng or Rng(5)
    rows = int(h / 0.23)
    for r in range(rows):
        z = 0.13 + r * 0.23
        n = int(w / 0.25)
        for i in range(n):
            if rng() < 0.08:
                continue
            x = -w / 2 + 0.1 + i * (w - 0.2) / max(1, n - 1) + (0.05 if r % 2 else 0)
            x = min(x, w / 2 - 0.1)
            p.cyl(0.125, d, (x, 0, z), "trunk" if (i + r) % 3 else "wood_light", segs=5, rot=(90, 0, 0), cap_cell="wood_light")
    for sx in (-1, 1):
        p.box((0.08, 0.08, h + 0.4), (sx * (w / 2 + 0.05), -d / 2 + 0.04, (h + 0.4) / 2), "timber", bottom=True)
    p.box((w + 0.4, d + 0.35, 0.06), (0, 0.05, h + 0.42), "plank_grey", rot=(-12, 0, 0), bottom=True)
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h + 0.1))
