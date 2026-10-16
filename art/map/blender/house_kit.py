"""Shared building parts for the enterable houses: two-tone walls, windows with casements and shutters,
doors, tiled roofs with trim, chimneys, stairs with banisters, plank and flagstone floors, beams.

Blender space: meters, Z up, the front faces -Y, origin on the ground at the footprint center.
Walls run counterclockwise seen from above, so each wall's local -Y is outside.
Floors: ground floor top at 0.15 m, upper floor top at 3.15 m, doors 1.1 x 2.1 m.
Only walls, floors, stairs, roofs and furniture get colliders; trim, leaves, shutters and
decorations are mesh only (they never block a door, a window or a shot).
"""

import math

from mathutils import Vector

import kit
from kit import Rng

GF = 0.15            # ground floor top
STORY = 3.0
UF = GF + STORY      # upper floor top
SLAB = 0.25
EAVE = 6.0           # wall top of a two-storey house
DOOR_W, DOOR_H = 1.1, 2.1
LINE = 0.05          # interior lining (plaster, wallpaper, panelling) on the inside of outer walls


def door_op(at, w=DOOR_W):
    return (at, w, GF, GF + DOOR_H)


def win_op(at, w=1.0):
    return (at, w, 1.05, 2.25)


def uwin_op(at, w=1.0):
    return (at, w, UF + 0.85, UF + 2.1)


def french_op(at, w=1.0):
    """Upper floor French window down to the floor (a Juliet balcony rail closes it)."""
    return (at, w, UF, UF + 2.2)


# ---------------------------------------------------------------- walls
def _frame_of(a, b):
    a, b = Vector((a[0], a[1])), Vector((b[0], b[1]))
    d = b - a
    return a, b, d.length, math.degrees(math.atan2(d.y, d.x)), (a + b) / 2


def wall2(p, a, b, height, t, outer, bands, openings=(), z0=0.0, top=None, col="wall", top_fn=None, strip=0.7):
    """Outer wall from a to b with a stone or plaster outside and an interior lining split into height bands.
    `bands`: [(z_from, z_to, cell)] in absolute z for the lining (None for no lining).
    `top_fn(x, y)` caps each 0.7 m strip (ruins). One collider per solid piece, full thickness."""
    a, b, length, yaw, mid = _frame_of(a, b)
    dirn = (b - a).normalized()
    with p.frame((mid.x, mid.y, z0), rot_z=yaw):
        for u0, u1, zb, zt in kit.solid_pieces(length, height, openings):
            pieces = [(u0, u1, zt)]
            if top_fn:
                n = max(1, round((u1 - u0) / strip))
                pieces = []
                for i in range(n):
                    s0 = u0 + (u1 - u0) * i / n
                    s1 = u0 + (u1 - u0) * (i + 1) / n
                    w = a + dirn * ((s0 + s1) / 2 + length / 2)
                    pieces.append((s0, s1, min(zt, top_fn(w.x, w.y) - z0)))
            for s0, s1, ztop in pieces:
                if ztop - zb < 0.08:
                    continue
                inner_t = LINE if bands else 0.0
                p.boxmm((s0, -t / 2, zb), (s1, t / 2 - inner_t, ztop), outer, top=top, bottom=zb > 1e-4)
                if col:
                    p.col_boxmm(col, (s0, -t / 2, zb), (s1, t / 2, ztop))
                for bz0, bz1, cell in bands or ():
                    lo, hi = max(zb, bz0 - z0), min(ztop, bz1 - z0)
                    if hi - lo > 0.02:
                        p.boxmm((s0, t / 2 - inner_t, lo), (s1, t / 2, hi), cell, top=top if hi >= ztop - 1e-4 else None,
                                bottom=lo > zb + 1e-4 or zb > 1e-4)


def inner_wall(p, a, b, height, t, cells, openings=(), z0=0.0, col="wall", trim=None):
    """Interior partition with a lining cell per side (cells = (side -Y, side +Y)) and door trims."""
    a, b, length, yaw, mid = _frame_of(a, b)
    with p.frame((mid.x, mid.y, z0), rot_z=yaw):
        for u0, u1, zb, zt in kit.solid_pieces(length, height, openings):
            p.boxmm((u0, -t / 2, zb), (u1, 0.0, zt), cells[0], bottom=zb > 1e-4)
            p.boxmm((u0, 0.0, zb), (u1, t / 2, zt), cells[1], bottom=zb > 1e-4)
            if col:
                p.col_boxmm(col, (u0, -t / 2, zb), (u1, t / 2, zt))
        if trim:
            for at, w, bot, tp in openings:
                x0, x1 = at - length / 2 - w / 2, at - length / 2 + w / 2
                for side in (-1, 1):
                    y0, y1 = sorted((side * t / 2, side * (t / 2 + 0.03)))
                    p.boxmm((x0 - 0.09, y0, bot), (x0, y1, tp + 0.09), trim, bottom=True)
                    p.boxmm((x1, y0, bot), (x1 + 0.09, y1, tp + 0.09), trim, bottom=True)
                    p.boxmm((x0 - 0.09, y0, tp), (x1 + 0.09, y1, tp + 0.09), trim, bottom=True)


def wall_stones(p, a, b, height, t, cells, openings, rng, count, z0=0.0, zmin=0.35):
    """Random proud stones on the outer face (mesh only), kept clear of openings."""
    a, b, length, yaw, mid = _frame_of(a, b)
    with p.frame((mid.x, mid.y, z0), rot_z=yaw):
        placed = 0
        for _ in range(count * 6):
            if placed >= count:
                break
            w, h = rng.range(0.28, 0.6), rng.range(0.16, 0.3)
            u = rng.range(-length / 2 + 0.5, length / 2 - 0.5)
            z = rng.range(zmin, height - 0.4)
            if any(abs(u - (at - length / 2)) < ow / 2 + w / 2 + 0.2 and bot - 0.35 < z < tp + 0.4 for at, ow, bot, tp in openings):
                continue
            cell = cells[int(rng() * len(cells)) % len(cells)]
            p.box((w, 0.05, h), (u, -t / 2 - 0.015, z), cell, bottom=True)
            placed += 1


def string_course(p, W, D, z, cell, h=0.14, out=0.05):
    """Thin band around the outside at z (between the floors)."""
    p.boxmm((-W / 2 - out, -D / 2 - out, z), (W / 2 + out, -D / 2 + 0.1, z + h), cell, bottom=True)
    p.boxmm((-W / 2 - out, D / 2 - 0.1, z), (W / 2 + out, D / 2 + out, z + h), cell, bottom=True)
    p.boxmm((-W / 2 - out, -D / 2 + 0.1, z), (-W / 2 + 0.1, D / 2 - 0.1, z + h), cell, bottom=True)
    p.boxmm((W / 2 - 0.1, -D / 2 + 0.1, z), (W / 2 + out, D / 2 - 0.1, z + h), cell, bottom=True)


def quoins(p, W, D, height, cell, step=0.5, z=0.3, t=0.4):
    """Alternating corner stones; the short side never reaches through a wall of thickness t."""
    short = min(0.42, t + 0.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * W / 2, sy * D / 2
            k, zz = 0, z
            while zz + step <= height:
                lx, ly = (0.75, short) if k % 2 == 0 else (short, 0.75)
                p.box((lx, ly, step - 0.06), (cx - sx * (lx / 2 - 0.04), cy - sy * (ly / 2 - 0.04), zz + step / 2), cell, bottom=True)
                zz += step
                k += 1


# ---------------------------------------------------------------- windows and doors
def window(p, a, b, op, t, look, leaves=True, shutters=True, flowers=None, lintel=True, sill=True, rail=None, mullions=None):
    """Window in the wall a-b: stone lintel and sill outside, a painted frame set in the reveal, casement
    leaves swung open inside, shutters open flat against the outside. `flowers`: list of flower cells
    for a window box. `rail`: cell for a Juliet balcony rail across a French window (cover collider).
    `mullions`: (vertical bars, transom height above the sill) for an open shop window (mesh only)."""
    a, b, length, yaw, mid = _frame_of(a, b)
    at, w, bot, tp = op
    x0, x1 = at - length / 2 - w / 2, at - length / 2 + w / 2
    fr = look["frame"]
    yo = -t / 2
    with p.frame((mid.x, mid.y, 0.0), rot_z=yaw):
        if lintel:
            p.boxmm((x0 - 0.16, yo - 0.04, tp), (x1 + 0.16, yo + 0.12, tp + 0.24), look["lintel"], bottom=True)
        if sill and bot > 0.5 and not rail:
            p.boxmm((x0 - 0.12, yo - 0.09, bot - 0.08), (x1 + 0.12, yo + 0.1, bot), look["sill"], bottom=True)
        # frame in the reveal, 6 cm in from the outside face
        f, fy0, fy1 = 0.07, yo + 0.05, yo + 0.12
        p.boxmm((x0, fy0, bot), (x0 + f, fy1, tp), fr, bottom=True)
        p.boxmm((x1 - f, fy0, bot), (x1, fy1, tp), fr, bottom=True)
        p.boxmm((x0, fy0, tp - f), (x1, fy1, tp), fr, bottom=True)
        if leaves:
            lw, lh = w / 2 - f, tp - bot - f - 0.05
            for side, hx in ((-1, x0 + f), (1, x1 - f)):
                # hinged on the jamb, swung 100 degrees into the room
                with p.frame((hx, fy1, bot + 0.05 + lh / 2), rot_z=-side * 100):
                    cx = -side * lw / 2
                    p.box((lw, 0.035, lh), (cx, 0.0, 0.0), fr, bottom=True)
                    p.box((lw - 0.1, 0.045, lh - 0.1), (cx, 0.0, 0.0), "glass", bottom=True)
        if shutters and look.get("shutter"):
            sw = w / 2 + 0.02
            sy0, sy1 = yo - 0.06, yo - 0.02
            for x_in, x_out in ((x0 - 0.04, x0 - 0.04 - sw), (x1 + 0.04, x1 + 0.04 + sw)):
                xa, xb = sorted((x_in, x_out))
                p.boxmm((xa, sy0, bot + 0.02), (xb, sy1, tp - 0.02), look["shutter"], bottom=True)
                zz = (bot + tp) / 2
                p.boxmm((xa + 0.04, sy0 - 0.025, zz - 0.05), (xb - 0.04, sy0, zz + 0.05), look.get("shutter_dark", look["shutter"]), bottom=True)
        if flowers:
            p.boxmm((x0 - 0.04, yo - 0.32, bot - 0.36), (x1 + 0.04, yo - 0.09, bot - 0.12), "wood", top="earth_dark", bottom=True)
            n = len(flowers)
            for i, cell in enumerate(flowers):
                fx = x0 + (i + 0.5) * w / n
                p.box((w / n * 0.85, 0.16, 0.08), (fx, yo - 0.2, bot - 0.08), "leaf", bottom=True)
                p.sphere((0.11, 0.09, 0.08), (fx, yo - 0.2, bot + 0.02), cell, segs=5, rings=3, smooth=False)
        if mullions:
            nv, tz = mullions
            for i in range(1, nv + 1):
                xx = x0 + w * i / (nv + 1)
                p.boxmm((xx - 0.035, fy0, bot), (xx + 0.035, fy1, tp), fr, bottom=True)
            p.boxmm((x0, fy0, bot + tz - 0.035), (x1, fy1, bot + tz + 0.035), fr, bottom=True)
        if rail:
            ry0, ry1 = yo - 0.06, yo + 0.02
            p.boxmm((x0 - 0.05, ry0, bot + 0.92), (x1 + 0.05, ry1, bot + 0.98), rail, bottom=True)
            p.boxmm((x0 - 0.05, ry0, bot + 0.1), (x1 + 0.05, ry1, bot + 0.14), rail, bottom=True)
            n = max(3, int(w / 0.13))
            for i in range(1, n):
                xx = x0 + w * i / n
                p.boxmm((xx - 0.015, ry0 + 0.02, bot + 0.14), (xx + 0.015, ry1 - 0.02, bot + 0.92), rail, bottom=True)
            p.col_boxmm("cover", (x0, yo - 0.06, bot), (x1, yo + 0.12, bot + 0.98))


def doorway(p, a, b, op, t, look, hinge=-1, step=True, porch=None, transom=False):
    """Open doorway: frame, lintel, the leaf swung flat against the inside wall (hinge -1 = at the
    opening's start, +1 = at its end), a stone step outside and an optional slate porch canopy."""
    a, b, length, yaw, mid = _frame_of(a, b)
    at, w, bot, tp = op
    x0, x1 = at - length / 2 - w / 2, at - length / 2 + w / 2
    fr = look["door_frame"]
    yo = -t / 2
    with p.frame((mid.x, mid.y, 0.0), rot_z=yaw):
        p.boxmm((x0 - 0.18, yo - 0.05, tp), (x1 + 0.18, yo + 0.12, tp + 0.28), look["lintel"], bottom=True)
        f = 0.09
        for xa, xb in ((x0 - f, x0), (x1, x1 + f)):
            p.boxmm((xa, yo - 0.04, bot), (xb, yo + 0.1, tp), fr, bottom=True)
        p.boxmm((x0 - f, yo - 0.04, tp - 0.02), (x1 + f, yo + 0.1, tp + 0.07), fr, bottom=True)
        # leaf flat against the inner face, 4 cm off the wall
        lw = w - 0.08
        hx = x0 if hinge < 0 else x1
        lx0, lx1 = sorted((hx, hx + hinge * lw))
        ly0, ly1 = t / 2 + 0.03, t / 2 + 0.08
        p.boxmm((lx0, ly0, bot + 0.02), (lx1, ly1, tp - 0.04), look["door"], bottom=True)
        for zz in (bot + 0.35, bot + 1.05, tp - 0.4):
            p.boxmm((lx0 + 0.06, ly1, zz - 0.06), (lx1 - 0.06, ly1 + 0.03, zz + 0.06), look.get("door_dark", "wood_dark"), bottom=True)
        p.sphere(0.045, ((lx1 - 0.1) if hinge > 0 else (lx0 + 0.1), ly1 + 0.06, bot + 1.0), "bronze", segs=5, rings=3, smooth=False)
        if step:
            p.boxmm((x0 - 0.25, yo - 0.6, 0.0), (x1 + 0.25, yo + 0.02, GF), look["sill"], col="floor")
        if transom:
            p.boxmm((x0, yo + 0.04, tp + 0.07), (x1, yo + 0.1, tp + 0.07), fr, bottom=True)
        if porch:
            # small gabled slate canopy on two timber brackets
            cz = tp + 0.45
            for xx in (x0 - 0.15, x1 + 0.15):
                p.tube((xx, yo, cz - 0.55), (xx, yo - 0.85, cz - 0.02), 0.05, "timber", segs=4)
            pw, pd, pitch = w + 1.0, 1.1, 30
            for side in (-1, 1):
                sl = (pw / 2) / math.cos(math.radians(pitch))
                with p.frame(((x0 + x1) / 2 + side * pw / 4, yo - pd / 2 + 0.02, cz + math.tan(math.radians(pitch)) * pw / 4)):
                    p.box((sl + 0.05, pd, 0.08), (0, 0, 0), porch, rot=(0, side * pitch, 0), bottom=True)
            p.prism([(-pw / 2 + 0.1, cz - 0.04), (pw / 2 - 0.1, cz - 0.04), (0, cz + math.tan(math.radians(pitch)) * (pw / 2 - 0.1) - 0.04)],
                    0.06, ((x0 + x1) / 2, yo - 0.04, 0), "timber", axis="Y")


def plaster_patches(p, a, b, height, t, openings, rng, count, z0=0.0):
    """Spots where the render has fallen off and the brick shows (mesh only, on the outer face)."""
    a, b, length, yaw, mid = _frame_of(a, b)
    with p.frame((mid.x, mid.y, z0), rot_z=yaw):
        placed = 0
        for _ in range(count * 8):
            if placed >= count:
                break
            u = rng.range(-length / 2 + 0.8, length / 2 - 0.8)
            z = rng.range(0.6, height - 0.8)
            if any(abs(u - (at - length / 2)) < ow / 2 + 0.9 and bot - 0.6 < z < tp + 0.6 for at, ow, bot, tp in openings):
                continue
            pw, ph = rng.range(0.7, 1.1), rng.range(0.45, 0.7)
            p.boxmm((u - pw / 2, -t / 2 - 0.012, z - ph / 2), (u + pw / 2, -t / 2 + 0.01, z + ph / 2), "plaster_dark", bottom=True)
            for row in range(3):
                zz = z - ph / 2 + 0.1 + row * (ph - 0.2) / 2
                off = 0.12 if row % 2 else 0.0
                for k in range(2):
                    xx = u - pw / 2 + 0.14 + off + k * 0.3
                    if xx + 0.13 < u + pw / 2:
                        p.boxmm((xx, -t / 2 - 0.03, zz - 0.06), (xx + 0.25, -t / 2, zz + 0.06), "brick", bottom=True)
            placed += 1


# ---------------------------------------------------------------- roofs
def tiled_roof(p, W, D, eave, pitch, overhang, thick, look, along="X", wall_t=0.4, course=0.42, gable=True, col="roof", gutters=True):
    """kit.gable_roof plus tile courses, barge boards on the gables, fascia boards and gutters on the eaves.
    Returns (ridge_z, slope_unit(side), top_point(side, s)) helpers via a dict."""
    ridge = kit.gable_roof(p, W, D, eave, pitch, overhang, thick, look["roof"], ridge_cell=look["ridge"], along=along,
                           gable_cell=look["gable"] if gable else None, wall_t=wall_t, col=col)
    t = math.radians(pitch)
    span = (D if along == "X" else W) / 2
    run = span + overhang
    slope_len = run / math.cos(t)
    length = (W if along == "X" else D) + 2 * overhang

    def u_of(side):
        return Vector((0, side * math.cos(t), -math.sin(t))) if along == "X" else Vector((side * math.cos(t), 0, -math.sin(t)))

    def n_of(side):
        return Vector((0, side * math.sin(t), math.cos(t))) if along == "X" else Vector((side * math.sin(t), 0, math.cos(t)))

    def rot(side):
        return (-side * pitch, 0, 0) if along == "X" else (0, side * pitch, 0)

    top0 = Vector((0, 0, ridge))
    for side in (-1, 1):
        u, n = u_of(side), n_of(side)
        k = 0
        s = 0.35
        while s < slope_len - 0.12:
            c = top0 + n * (thick + 0.022) + u * s
            size = (length - 0.04, 0.09, 0.045) if along == "X" else (0.09, length - 0.04, 0.045)
            p.box(size, tuple(c), look["course"], rot=rot(side), bottom=True)
            s += course
            k += 1
        # fascia board and gutter at the eave
        e = top0 + u * slope_len + n * (thick / 2)
        if along == "X":
            p.box((length, 0.06, thick + 0.14), (0, e.y + side * 0.03, e.z - 0.02), look["fascia"], bottom=True)
            if gutters:
                p.tube((-length / 2 + 0.05, e.y + side * 0.12, e.z - 0.14), (length / 2 - 0.05, e.y + side * 0.12, e.z - 0.14), 0.07, look["gutter"], segs=5)
        else:
            p.box((0.06, length, thick + 0.14), (e.x + side * 0.03, 0, e.z - 0.02), look["fascia"], bottom=True)
            if gutters:
                p.tube((e.x + side * 0.12, -length / 2 + 0.05, e.z - 0.14), (e.x + side * 0.12, length / 2 - 0.05, e.z - 0.14), 0.07, look["gutter"], segs=5)
        # barge boards along both gable verges
        mid_c = top0 + u * (slope_len / 2) + n * (thick / 2)
        for g in (-1, 1):
            if along == "X":
                p.box((0.07, slope_len + 0.05, thick + 0.12), (g * (length / 2 + 0.03), mid_c.y, mid_c.z), look["fascia"], rot=rot(side), bottom=True)
            else:
                p.box((slope_len + 0.05, 0.07, thick + 0.12), (mid_c.x, g * (length / 2 + 0.03), mid_c.z), look["fascia"], rot=rot(side), bottom=True)
    return {"ridge": ridge, "slope_len": slope_len, "u": u_of, "n": n_of, "thick": thick}


def downpipe(p, x, y, top_z, out_y, cell="steel"):
    """Gutter outlet at (x, out_y, top_z) bending back to the wall at y, then down to the ground."""
    p.tube((x, out_y, top_z), (x, y, top_z - 0.45), 0.055, cell, segs=5)
    p.tube((x, y, top_z - 0.45), (x, y, 0.35), 0.055, cell, segs=5)
    p.tube((x, y, 0.35), (x, y + (out_y - y) * 0.6, 0.12), 0.055, cell, segs=5)


def chimney(p, x, y, z0, z1, cell, cap="stone_dark", pots="tile", sx=0.9, sy=0.7):
    p.box((sx, sy, z1 - z0), (x, y, (z0 + z1) / 2), cell, bottom=True)
    p.box((sx + 0.14, sy + 0.14, 0.12), (x, y, z1 + 0.06), cap, bottom=True)
    for dx in (-sx / 4, sx / 4):
        p.cyl(0.1, 0.38, (x + dx, y, z1 + 0.31), pots, segs=6, cap_cell="char", r2=0.08)


def dormer(p, x, eave, pitch, D, look, depth_in=0.9, w=1.5, h=1.45):
    """Front dormer on a ridge-along-X roof (front slope faces -Y). Mesh plus a roof collider."""
    t = math.tan(math.radians(pitch))
    yf = -D / 2 + depth_in
    zs = eave + depth_in * t
    z0, z1 = zs - 0.4, zs + h
    back = yf + 2.2
    p.boxmm((x - w / 2, yf, z0), (x + w / 2, back, z1), look["dormer"], col="roof", bottom=True)
    p.prism([(x - w / 2 - 0.18, z1 - 0.02), (x + w / 2 + 0.18, z1 - 0.02), (x, z1 + 0.62)], back - yf + 0.25, (0, (yf + back) / 2 - 0.12, 0), look["roof"], axis="Y", side_cell=look["dormer"])
    # window: dark pane, white frame with a cross bar
    p.boxmm((x - 0.45, yf - 0.02, zs + 0.2), (x + 0.45, yf + 0.02, zs + 1.2), "window", bottom=True)
    fr = look["frame"]
    for xa, xb in ((x - 0.52, x - 0.45), (x + 0.45, x + 0.52), (x - 0.03, x + 0.03)):
        p.boxmm((xa, yf - 0.05, zs + 0.15), (xb, yf - 0.01, zs + 1.27), fr, bottom=True)
    for za, zb in ((zs + 0.13, zs + 0.2), (zs + 1.2, zs + 1.27), (zs + 0.68, zs + 0.74)):
        p.boxmm((x - 0.52, yf - 0.05, za), (x + 0.52, yf - 0.01, zb), fr, bottom=True)


# ---------------------------------------------------------------- stairs, floors, ceilings
def stair_ramp(p, axis, band, start, d, z0, rise_total, steps, run, lip=0.05):
    """The collider under a flight: one smooth wedge (`stairs` kind) through the step noses, 5 cm below
    them, starting 0.2 m in front of the first riser. The character controller's autostep stalls on
    0.27 m treads at walking and crouching speed; a 36 degree ramp is climbed at any speed (max 46)."""
    rise = rise_total / steps
    k = rise / run
    L = steps * run
    a0 = -(rise - lip) / k
    a_top = (rise_total - rise + lip) / k
    prof = [(a0, z0), (L, z0), (L, z0 + rise_total), (a_top, z0 + rise_total)]
    pts = []
    for b in band:
        for rel, z in prof:
            a = start + d * rel
            pts.append((a, b, z) if axis == "x" else (b, a, z))
    p.col_hull("stairs", pts)


def stair_run(p, axis, band, start, d, z0, rise_total, steps, run, look, open_side=None, banister=True):
    """Straight flight: solid steps with tread and riser cells (mesh), one smooth ramp collider under them
    (see stair_ramp), a stringer and a banister on the open side (mesh only). axis 'x': climbs along X
    between band = (y0, y1); 'y': along Y between band = (x0, x1). open_side: -1 or +1 (which band edge
    is open). Returns the end coordinate."""
    rise = rise_total / steps
    b0, b1 = band
    for i in range(steps):
        a0 = start + d * i * run
        a1 = a0 + d * run
        ztop = z0 + (i + 1) * rise
        lo, hi = min(a0, a1), max(a0, a1)
        if axis == "x":
            p.boxmm((lo, b0, z0), (hi, b1, ztop), look["riser"], top=look["tread"])
        else:
            p.boxmm((b0, lo, z0), (b1, hi, ztop), look["riser"], top=look["tread"])
    stair_ramp(p, axis, band, start, d, z0, rise_total, steps, run)
    end = start + d * steps * run
    if open_side:
        edge = b0 if open_side < 0 else b1
        L = steps * run
        ang = math.degrees(math.atan2(rise_total, L))
        slope = math.hypot(L, rise_total)
        mid_a = start + d * L / 2
        zc = z0 + rise_total / 2 - 0.12
        e = edge + open_side * 0.03
        if axis == "x":
            p.box((slope, 0.05, 0.32), (mid_a, e, zc), look["stringer"], rot=(0, -d * ang, 0), bottom=True)
        else:
            p.box((0.05, slope, 0.32), (e, mid_a, zc), look["stringer"], rot=(d * ang, 0, 0), bottom=True)
        if banister:
            pts = []
            for i in range(0, steps + 1, 2):
                a = start + d * (i * run + run * 0.5) if i < steps else end - d * 0.05
                z = z0 + min(i + 1, steps) * rise
                hgt = 0.9 if 0 < i < steps else 1.05
                pos = (a, e, z + hgt / 2) if axis == "x" else (e, a, z + hgt / 2)
                sz = 0.1 if i in (0, steps) else 0.045
                p.box((sz, sz, hgt), pos, look["stringer"], bottom=True)
                pts.append((a, z + 0.9))
            (a0, h0), (a1, h1) = pts[0], pts[-1]
            if axis == "x":
                p.tube((a0, e, h0), (a1, e, h1), 0.04, look["rail"], segs=5)
            else:
                p.tube((e, a0, h0), (e, a1, h1), 0.04, look["rail"], segs=5)
    return end


def slab_with_hole(p, rect, hole, z_top, cell, top="wood", col="floor", thick=SLAB):
    x0, y0, x1, y1 = rect
    pieces = []
    if hole is None:
        pieces.append((x0, y0, x1, y1))
    else:
        hx0, hy0, hx1, hy1 = hole
        if hx0 > x0 + 1e-3:
            pieces.append((x0, y0, hx0, y1))
        if hx1 < x1 - 1e-3:
            pieces.append((hx1, y0, x1, y1))
        if hy0 > y0 + 1e-3:
            pieces.append((hx0, y0, hx1, hy0))
        if hy1 < y1 - 1e-3:
            pieces.append((hx0, hy1, hx1, y1))
    for a0, b0, a1, b1 in pieces:
        p.boxmm((a0, b0, z_top - thick), (a1, b1, z_top), cell, col=col, bottom=True, top=top)


def _cut(lo, hi, holes):
    """Split [lo, hi] around the holes [(h0, h1)]."""
    segs = [(lo, hi)]
    for h0, h1 in holes:
        out = []
        for s0, s1 in segs:
            if h1 <= s0 or h0 >= s1:
                out.append((s0, s1))
                continue
            if h0 > s0:
                out.append((s0, h0))
            if h1 < s1:
                out.append((h1, s1))
        segs = out
    return [(a, b) for a, b in segs if b - a > 0.05]


def planks(p, rect, z, cells=("wood", "wood_light"), width=0.32, along="x", holes=(), h=0.012):
    """Floor boards (mesh only, 12 mm proud of the floor collider) in alternating cells, cut around holes."""
    x0, y0, x1, y1 = rect
    if along == "x":
        n = max(1, round((y1 - y0) / width))
        for i in range(n):
            ya, yb = y0 + (y1 - y0) * i / n, y0 + (y1 - y0) * (i + 1) / n
            hs = [(hx0, hx1) for hx0, hy0, hx1, hy1 in holes if hy0 < yb - 1e-3 and hy1 > ya + 1e-3]
            for xa, xb in _cut(x0, x1, hs):
                p.boxmm((xa, ya + 0.004, z), (xb, yb - 0.004, z + h), cells[i % len(cells)])
    else:
        n = max(1, round((x1 - x0) / width))
        for i in range(n):
            xa, xb = x0 + (x1 - x0) * i / n, x0 + (x1 - x0) * (i + 1) / n
            hs = [(hy0, hy1) for hx0, hy0, hx1, hy1 in holes if hx0 < xb - 1e-3 and hx1 > xa + 1e-3]
            for ya, yb in _cut(y0, y1, hs):
                p.boxmm((xa + 0.004, ya, z), (xb - 0.004, yb, z + h), cells[i % len(cells)])


def flagstones(p, rect, z, rng, base="flagstone", dark="stone_dark", size=0.75):
    """Stone floor: a base slab and every other flag a shade darker, slightly jittered (mesh only)."""
    x0, y0, x1, y1 = rect
    p.boxmm((x0, y0, z), (x1, y1, z + 0.01), base)
    nx, ny = max(1, round((x1 - x0) / size)), max(1, round((y1 - y0) / size))
    for i in range(nx):
        for j in range(ny):
            if (i + j) % 2:
                continue
            xa, xb = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
            ya, yb = y0 + (y1 - y0) * j / ny, y0 + (y1 - y0) * (j + 1) / ny
            jx, jy = rng.range(-0.03, 0.03), rng.range(-0.03, 0.03)
            p.boxmm((xa + 0.03 + jx, ya + 0.03 + jy, z), (xb - 0.03 + jx, yb - 0.03 + jy, z + 0.018), dark)


def beams(p, rect, z_under, along="y", spacing=1.2, size=(0.16, 0.2), cell="timber", holes=()):
    """Ceiling joists hanging under a slab (mesh only), cut around stairwell holes."""
    x0, y0, x1, y1 = rect
    w, h = size
    if along == "y":
        n = max(1, int((x1 - x0) / spacing))
        for i in range(1, n + 1):
            x = x0 + (x1 - x0) * i / (n + 1)
            hs = [(hy0, hy1) for hx0, hy0, hx1, hy1 in holes if hx0 - w < x < hx1 + w]
            for ya, yb in _cut(y0, y1, hs):
                p.boxmm((x - w / 2, ya, z_under - h), (x + w / 2, yb, z_under), cell, bottom=True)
    else:
        n = max(1, int((y1 - y0) / spacing))
        for i in range(1, n + 1):
            y = y0 + (y1 - y0) * i / (n + 1)
            hs = [(hx0, hx1) for hx0, hy0, hx1, hy1 in holes if hy0 - w < y < hy1 + w]
            for xa, xb in _cut(x0, x1, hs):
                p.boxmm((xa, y - w / 2, z_under - h), (xb, y + w / 2, z_under), cell, bottom=True)


def rail(p, a, b, z, cell="wood_dark", h=0.95, t=0.12, col="cover"):
    """Railing with a cover collider (stairwell edges, lofts, belfry)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    yaw = math.degrees(math.atan2(d.y, d.x))
    mid = (a + b) / 2
    with p.frame((mid.x, mid.y, z), rot_z=yaw):
        p.boxmm((-d.length / 2, -t / 2, h - 0.1), (d.length / 2, t / 2, h), cell, col=col, bottom=True)
        n = max(2, int(d.length / 0.42) + 1)
        for i in range(n):
            x = -d.length / 2 + d.length * i / (n - 1)
            x = max(-d.length / 2 + 0.05, min(d.length / 2 - 0.05, x))
            big = i in (0, n - 1)
            p.box((0.1 if big else 0.05, 0.1 if big else 0.05, h - 0.1), (x, 0, (h - 0.1) / 2), cell, bottom=True)


def skirting(p, rect, z, cell, h=0.12, gaps=()):
    """Skirting boards around a room (mesh only). gaps: (side, u0, u1) door gaps, side in 'S','N','W','E'."""
    x0, y0, x1, y1 = rect
    sides = {"S": (x0, x1), "N": (x0, x1), "W": (y0, y1), "E": (y0, y1)}
    for side, (lo, hi) in sides.items():
        for a, b in _cut(lo, hi, [(u0, u1) for s, u0, u1 in gaps if s == side]):
            if side == "S":
                p.boxmm((a, y0, z), (b, y0 + 0.03, z + h), cell)
            elif side == "N":
                p.boxmm((a, y1 - 0.03, z), (b, y1, z + h), cell)
            elif side == "W":
                p.boxmm((x0, a, z), (x0 + 0.03, b, z + h), cell)
            else:
                p.boxmm((x1 - 0.03, a, z), (x1, b, z + h), cell)


# ---------------------------------------------------------------- ruins
def jag(seed, base_fn, amp=0.6):
    cache = {}

    def fn(x, y):
        key = (round(x * 1.4), round(y * 1.4))
        if key not in cache:
            cache[key] = Rng(seed + key[0] * 7919 + key[1] * 104729).range(-amp, amp)
        return base_fn(x, y) + cache[key]
    return fn


def rubble_heap(p, cx, cy, size, rng, col="berm", z=0.0):
    """Walkable rubble mound (hull collider) with loose blocks on top."""
    pts = []
    for k in range(10):
        a = 2 * math.pi * k / 10
        r = size * rng.range(0.75, 1.1)
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r * 0.8, z))
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.3
        r = size * rng.range(0.2, 0.45)
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r, z + size * rng.range(0.4, 0.55)))
    p.hull(pts, "rubble", col=col, cells_fn=lambda c, n: "rubble" if n.z > 0.5 else "stone_dark")
    for k in range(5):
        a = rng.range(0, 2 * math.pi)
        r = size * rng.range(0.3, 0.85)
        s = rng.range(0.22, 0.42)
        cell = "brick" if k % 3 == 0 else "stone"
        p.box((s * 1.4, s, s * 0.6), (cx + math.cos(a) * r, cy + math.sin(a) * r, z + size * 0.22 + rng.range(0, 0.15)), cell,
              rot=(rng.range(-25, 25), rng.range(-25, 25), rng.range(0, 90)), bevel=0.03, bottom=True)


# ---------------------------------------------------------------- LOD shells
def shell_patches(p, W, D, items, look, t=0.4):
    """Window and door decals on a closed LOD shell. items: (side, v, bot, top, w, kind) with side
    'front', 'back', 'east', 'west' and kind 'door', 'win' or 'shop'."""
    for side, v, bot, tp, w, kind in items:
        if side == "front":
            c, n = (v, -D / 2, 0), (0, -1, 0)
        elif side == "back":
            c, n = (v, D / 2, 0), (0, 1, 0)
        elif side == "east":
            c, n = (W / 2, v, 0), (1, 0, 0)
        else:
            c, n = (-W / 2, v, 0), (-1, 0, 0)
        zc = (bot + tp) / 2
        p.patch((c[0], c[1], zc), n, w, tp - bot, "wood_dark" if kind == "door" else "window")
        if kind == "win" and look.get("shutter"):
            nv = Vector(n)
            r = Vector((0, 0, 1)).cross(nv)
            for sgn in (-1, 1):
                sc = Vector((c[0], c[1], zc)) + r * sgn * (w / 2 + 0.04 + w / 4)
                p.patch(sc, n, w / 2, tp - bot - 0.04, look["shutter"])


def roof_hull(p, W, D, H, pitch, overhang, cell, along="X"):
    span = (D if along == "X" else W) / 2
    ridge = H + math.tan(math.radians(pitch)) * span
    ox, oy = W / 2 + overhang, D / 2 + overhang
    if along == "X":
        pts = [(sx * ox, sy * oy, H - 0.1) for sx in (-1, 1) for sy in (-1, 1)] + [(sx * ox, 0, ridge + 0.2) for sx in (-1, 1)]
    else:
        pts = [(sx * ox, sy * oy, H - 0.1) for sx in (-1, 1) for sy in (-1, 1)] + [(0, sy * oy, ridge + 0.2) for sy in (-1, 1)]
    p.hull(pts, cell)
    return ridge
