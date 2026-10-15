"""Beach defenses, cover, trenches and loot containers.

Blender space: meters, Z up, front faces -Y, origin on the ground. See kit.py for the builder.
"""

import math

from mathutils import Vector

import kit
from kit import Prop, Rng, wall


# ---------------------------------------------------------------- shared bits
def sandbag(p, at, yaw, cell="sandbag", size=(0.62, 0.36, 0.22), rng=None):
    sx, sy, sz = size
    if LOD["level"] > 0:
        if LOD["level"] == 1:
            p.box((sx, sy, sz), at, cell, rot_z=yaw, bottom=True)
        return
    if rng:
        sx *= rng.range(0.94, 1.06)
        yaw += rng.range(-5, 5)
    p.box((sx, sy, sz), at, cell, rot_z=yaw, bevel=0.075, bottom=True)


def sandbag_run(p, length, rows, rng, x0=0.0, cell_cycle=("sandbag", "sandbag", "sandbag_dark")):
    """Bags laid along X from x0 to x0 + length, crosswise (0.36 deep), stacked `rows` high, staggered."""
    bag_len, bag_h = 0.6, 0.235
    n = max(1, round(length / bag_len))
    step = length / n
    k = 0
    for r in range(rows):
        off = 0.0 if r % 2 == 0 else step / 2
        count = n if r % 2 == 0 else n - 1
        for i in range(count):
            x = x0 + off + step * (i + 0.5)
            z = bag_h * (r + 0.5) - 0.01 * r
            cell = cell_cycle[k % len(cell_cycle)]
            k += 7
            sandbag(p, (x, 0, z), 0.0, cell=cell, size=(step * 1.02, 0.42, bag_h + 0.03), rng=rng)
    return bag_h * rows


def ring_decal(p, at, normal_rot, r_out, r_in, cell, depth=0.02, segs=14, dot=None):
    """Flat annulus (the faction ring) lying in the plane given by `normal_rot` (Euler deg, local +Z is the normal)."""
    verts, faces = [], []
    for k, z in enumerate((0.0, depth)):
        for j in range(segs):
            a = 2 * math.pi * j / segs
            verts.append(Vector((math.cos(a) * r_out, math.sin(a) * r_out, z)))
        for j in range(segs):
            a = 2 * math.pi * j / segs
            verts.append(Vector((math.cos(a) * r_in, math.sin(a) * r_in, z)))
    n = segs
    for j in range(n):
        j1 = (j + 1) % n
        # top (z = depth) ring between outer and inner
        faces.append((2 * n + j, 2 * n + j1, 3 * n + j1, 3 * n + j))
        # bottom
        faces.append((j, n + j, n + j1, j1))
        # outer wall
        faces.append((j, j1, 2 * n + j1, 2 * n + j))
        # inner wall
        faces.append((n + j, 3 * n + j, 3 * n + j1, n + j1))
    local = kit.Matrix.Translation(Vector(at)) @ kit.rot_matrix(normal_rot)
    p.add(verts, faces, cell, matrix=local)
    if dot:
        with p.frame(at, rot=normal_rot):
            p.cyl(r_in * 0.5, depth, (0, 0, depth / 2), dot, segs=10)


# ---------------------------------------------------------------- beach defenses
def pillbox_shell(lod):
    p = Prop("bunker_pillbox", "beach")
    apothem, h = 3.0, 2.3
    r_wall = apothem / math.cos(math.radians(22.5))
    r_roof = (apothem + 0.35) / math.cos(math.radians(22.5))
    walls, roof = [], []
    for k in range(8):
        a = math.radians(-90 + 22.5 + 45 * k)
        walls += [(math.cos(a) * r_wall, math.sin(a) * r_wall, z) for z in (0.0, h)]
        roof += [(math.cos(a) * r_roof, math.sin(a) * r_roof, z) for z in (h, h + 0.55)]
    p.hull(walls, "concrete")
    p.hull(roof, "concrete", cells_fn=lambda c, n: "concrete_dark" if n.z > 0.5 else "concrete")
    if lod == 1:
        for k in (7, 0, 1):
            ang = math.radians(-90 + 45 * k)
            n = Vector((math.cos(ang), math.sin(ang), 0))
            p.patch((n.x * apothem, n.y * apothem, 1.32), n, 1.3, 0.35, "dark")
        p.patch((0, apothem, 1.05), (0, 1, 0), 1.1, 2.1, "dark")
        p.boxmm((-1.6, apothem + 1.2, 0), (1.6, apothem + 1.7, 1.9), "concrete", top="concrete_dark")
        p.cyl(0.55, 0.35, (0.0, 0.4, h + 0.72), "steel", segs=6)
    return p


def bunker_pillbox(lod=0):
    """Octagonal concrete pillbox: three embrasures on the front, rear door with a blast wall."""
    if lod > 0:
        return pillbox_shell(lod)
    p = Prop("bunker_pillbox", "beach")
    apothem, t, h = 3.0, 0.6, 2.3
    side = 2 * apothem * math.tan(math.radians(22.5))
    for k in range(8):
        ang = math.radians(-90 + 45 * k)          # k = 0 faces -Y (front)
        n = Vector((math.cos(ang), math.sin(ang)))
        tdir = Vector((-n.y, n.x))                # CCW along the outline, so local -Y is outside
        c = n * (apothem - t / 2)
        a = c - tdir * (side / 2)
        b = c + tdir * (side / 2)
        openings = []
        if k in (7, 0, 1):
            openings.append((side / 2, 1.3, 1.15, 1.5))      # embrasure slit
        if k == 4:
            openings.append((side / 2, 1.1, 0.0, 2.1))       # rear door
        wall(p, a, b, h, t, "concrete", openings=openings, top="concrete_dark")
        if k in (7, 0, 1):
            # chunky sloped hood over the slit
            with p.frame((n.x * (apothem + 0.12), n.y * (apothem + 0.12), 1.62), rot_z=math.degrees(ang) - 90):
                p.box((1.7, 0.36, 0.16), (0, 0, 0), "concrete_dark", rot=(-20, 0, 0), bottom=True)
    # roof slab (thick, overhanging) and a low dome of earth and sandbags on top
    roof = []
    r_roof = (apothem + 0.35) / math.cos(math.radians(22.5))
    for k in range(8):
        a = math.radians(-90 + 22.5 + 45 * k)
        roof.append((math.cos(a) * r_roof, math.sin(a) * r_roof))
    pts = [(x, y, z) for x, y in roof for z in (h, h + 0.55)]
    p.hull(pts, "concrete", col="roof", cells_fn=lambda c, n: "concrete_dark" if n.z > 0.5 else "concrete")
    # observation cupola and a few sandbags on the roof rim
    p.cyl(0.55, 0.35, (0.0, 0.4, h + 0.72), "steel", segs=10, cap_cell="steel_dark")
    p.sphere((0.55, 0.55, 0.3), (0.0, 0.4, h + 0.89), "steel", segs=10, rings=4, smooth=False, flat_bottom=0.0)
    p.box((0.5, 0.06, 0.08), (0.0, -0.13, h + 0.8), "dark")
    rng = Rng(11)
    for a_deg in (-125, -105, -85, -65, 45, 65):
        a = math.radians(a_deg)
        sandbag(p, (math.cos(a) * 2.7, math.sin(a) * 2.7, h + 0.66), a_deg + 90, rng=rng)
    # weathering band
    p.cyl(apothem / math.cos(math.radians(22.5)) + 0.02, 0.35, (0, 0, 0.17), "concrete_dark", segs=8, phase=math.radians(22.5), caps=False)
    inner = apothem - t + 0.05
    r_in = inner / math.cos(math.radians(22.5))
    fl = []
    for k in range(8):
        a = math.radians(-90 + 22.5 + 45 * k)
        fl += [(math.cos(a) * r_in, math.sin(a) * r_in, 0.0), (math.cos(a) * r_in, math.sin(a) * r_in, 0.1)]
    p.hull(fl, "concrete_dark", col="floor")
    # blast wall behind the door
    p.boxmm((-1.6, apothem + 1.2, 0), (1.6, apothem + 1.7, 1.9), "concrete", col="wall", top="concrete_dark")
    p.boxmm((1.6, apothem - 0.2, 0), (2.1, apothem + 1.7, 1.9), "concrete", col="wall", top="concrete_dark")
    # sandbag cheeks along the front sides
    with p.frame((-3.3, -1.0, 0), rot_z=-70):
        sandbag_run(p, 1.8, 3, rng)
    with p.frame((3.3, -1.0, 0), rot_z=250):
        sandbag_run(p, 1.8, 3, rng)
    p.col_box("cover", (-3.3 + math.cos(math.radians(-70)) * 0.9, -1.0 + math.sin(math.radians(-70)) * 0.9, 0.35), (1.8, 0.42, 0.7), rot_z=-70)
    p.col_box("cover", (3.3 + math.cos(math.radians(250)) * 0.9, -1.0 + math.sin(math.radians(250)) * 0.9, 0.35), (1.8, 0.42, 0.7), rot_z=250)
    p.loot_at((0, 0.6, 0.1))
    p.loot_at((-1.2, -0.8, 0.1))
    return p


def _beam_frame():
    """Rotation that takes the (1, 1, 1) diagonal to +Z, so a three-beam hedgehog stands on three ends."""
    q = Vector((1, 1, 1)).normalized().rotation_difference(Vector((0, 0, 1)))
    return q.to_euler("XYZ")


def czech_hedgehog(lod=0):
    p = Prop("czech_hedgehog", "beach")
    L, w = 2.3, 0.17
    if lod > 0:
        rot = tuple(math.degrees(a) for a in _beam_frame())
        with p.frame((0, 0, (L / 2) / math.sqrt(3) + w * 0.3), rot=rot):
            for axis in range(3):
                size = [w, w, w]
                size[axis] = L
                p.box(tuple(size), (0, 0, 0), "rust", bottom=True)
        return p
    e = _beam_frame()
    rot = tuple(math.degrees(a) for a in e)
    cz = (L / 2) / math.sqrt(3) + w * 0.3
    with p.frame((0, 0, cz), rot=rot):
        for axis in range(3):
            size = [w, w, w]
            size[axis] = L
            # angle-iron look: a beam plus a thinner flange
            p.box(tuple(size), (0, 0, 0), "rust", bevel=0.02, bottom=True, col="block")
            fl = [w * 0.35, w * 0.35, w * 0.35]
            fl[axis] = L * 0.98
            off = [0, 0, 0]
            off[(axis + 1) % 3] = w * 0.55
            p.box(tuple(fl), tuple(off), "rust_dark", bottom=True)
        # rivet plate at the crossing
        p.box((0.32, 0.32, 0.32), (0, 0, 0), "rust_dark", bevel=0.05, bottom=True)
    return p


def beach_obstacle():
    """Wooden log ramp: the low end faces the sea (front, -Y), with a mine plate on the high end."""
    p = Prop("beach_obstacle", "beach")
    for x in (-0.5, 0.5):
        p.tube((x, -1.9, 0.05), (x, 1.5, 2.0), 0.13, "wood", segs=6, col="block")
        p.tube((x, 1.35, 0.0), (x, 1.35, 1.95), 0.12, "wood_dark", segs=6, col="block")
        p.tube((x, 1.35, 1.2), (x, 2.6, 0.0), 0.1, "wood_dark", segs=6)
    p.tube((-0.75, 1.35, 1.6), (0.75, 1.35, 1.6), 0.09, "wood_dark", segs=6)
    p.tube((-0.75, -0.2, 0.95), (0.75, -0.2, 0.95), 0.08, "wood_dark", segs=6)
    # mine plate (generic disc), no markings
    with p.frame((0, 1.25, 2.05), rot=(-30, 0, 0)):
        p.cyl(0.24, 0.1, (0, 0, 0.05), "olive_dark", segs=10, cap_cell="olive")
    return p


# ---------------------------------------------------------------- cover
def sandbag_rows(p, length, x0, rows=4, lod=1):
    bag_h = 0.235
    if lod == 1:
        for r in range(rows):
            p.boxmm((x0 + (0.0 if r % 2 == 0 else 0.15), -0.21, r * bag_h), (x0 + length - (0.0 if r % 2 == 0 else 0.15), 0.21, (r + 1) * bag_h),
                    "sandbag" if r % 2 == 0 else "sandbag_dark", bottom=r > 0)
    else:
        p.boxmm((x0, -0.21, 0), (x0 + length, 0.21, rows * bag_h), "sandbag", top="sandbag_dark")
    return rows * bag_h


def sandbag_wall(lod=0):
    p = Prop("sandbag_wall", "cover")
    if lod > 0:
        height = sandbag_rows(p, 3.0, -1.5, lod=lod)
        p.col_boxmm("cover", (-1.5, -0.21, 0), (1.5, 0.21, height + 0.04))
        return p
    rng = Rng(3)
    height = sandbag_run(p, 3.0, 4, rng, x0=-1.5)
    p.col_boxmm("cover", (-1.5, -0.21, 0), (1.5, 0.21, height + 0.04))
    return p


def sandbag_corner(lod=0):
    """L-shaped nest: two 2.2 m arms meeting at the origin corner, inner side toward -Y/+X."""
    p = Prop("sandbag_corner", "cover")
    if lod > 0:
        height = sandbag_rows(p, 2.2, -0.2, lod=lod)
        with p.frame((0, 0, 0), rot_z=90):
            sandbag_rows(p, 2.2, 0.22, lod=lod)
        p.col_boxmm("cover", (-0.21, -0.21, 0), (2.0, 0.21, height + 0.04))
        p.col_boxmm("cover", (-0.21, 0.21, 0), (0.21, 2.42, height + 0.04))
        return p
    rng = Rng(5)
    height = sandbag_run(p, 2.2, 4, rng, x0=-0.2)
    with p.frame((0, 0, 0), rot_z=90):
        sandbag_run(p, 2.2, 4, rng, x0=0.22)
    p.col_boxmm("cover", (-0.21, -0.21, 0), (2.0, 0.21, height + 0.04))
    p.col_boxmm("cover", (-0.21, 0.21, 0), (0.21, 2.42, height + 0.04))
    return p


def barbed_wire(lod=0):
    """3 m concertina coil on crossed pickets. Blocks movement, not bullets or sight."""
    p = Prop("barbed_wire", "cover")
    L, R, cz, loops, per = 3.0, 0.42, 0.5, 9, 8
    if lod > 0:
        pts = [(-L / 2 + L * i / 12, (R if i % 2 else -R), cz + (0.3 if i % 2 else -0.3)) for i in range(13)]
        for a, b in zip(pts, pts[1:]):
            p.tube(a, b, 0.03, "wire", segs=3, caps=False)
        for x in (-1.4, 0.0, 1.4):
            p.tube((x, 0, 0.0), (x, 0, 1.15), 0.05, "wood_dark", segs=3, caps=False)
        p.col_boxmm("wire", (-L / 2, -0.5, 0), (L / 2, 0.5, 1.2))
        return p
    pts = []
    for i in range(loops * per + 1):
        t = i / (loops * per)
        a = 2 * math.pi * loops * t
        pts.append((-L / 2 + L * t, math.sin(a) * R, cz + math.cos(a) * R))
    for a, b in zip(pts, pts[1:]):
        p.tube(a, b, 0.022, "wire", segs=3, caps=False)
    for x in (-1.4, 0.0, 1.4):
        p.tube((x - 0.25, 0, 0.0), (x + 0.25, 0, 1.15), 0.045, "wood_dark", segs=5)
        p.tube((x + 0.25, 0, 0.0), (x - 0.25, 0, 1.15), 0.045, "wood_dark", segs=5)
    p.tube((-L / 2, 0, 1.08), (L / 2, 0, 1.08), 0.02, "wire", segs=3, caps=False)
    p.col_boxmm("wire", (-L / 2, -0.5, 0), (L / 2, 0.5, 1.2))
    return p


# ---------------------------------------------------------------- trench kit (4 m tiles)
TRENCH_HALF = 0.7       # half the inside width
TRENCH_WALL = 1.25      # revetment height
TRENCH_BERM = 1.35      # berm crest
BERM_REACH = 2.4        # crest to outer foot


LOD = {"level": 0}


def revetment(p, y0, y1, side, rng):
    """Plank wall along Y on side +1 (+X) or -1 (-X) with posts, from y0 to y1."""
    x0 = side * TRENCH_HALF
    x1 = side * (TRENCH_HALF + 0.14)
    if LOD["level"] > 0:
        if LOD["level"] == 1:
            p.boxmm((min(x0, x1), y0, 0), (max(x0, x1), y1, TRENCH_WALL), "wood", top="wood_dark")
        p.col_boxmm("wall", (min(x0, x1), y0, 0), (max(x0, x1), y1, TRENCH_WALL))
        return
    planks = 4
    ph = TRENCH_WALL / planks
    for i in range(planks):
        cell = "wood" if i % 2 == 0 else "wood_light"
        p.boxmm((min(x0, x1), y0, i * ph), (max(x0, x1), y1, (i + 1) * ph - 0.02), cell)
    p.col_boxmm("wall", (min(x0, x1), y0, 0), (max(x0, x1), y1, TRENCH_WALL))
    n = max(1, round((y1 - y0) / 1.3))
    for i in range(n + 1):
        y = y0 + (y1 - y0) * i / n
        y = min(max(y, y0 + 0.07), y1 - 0.07)
        p.box((0.14, 0.14, TRENCH_WALL + 0.12), (side * (TRENCH_HALF - 0.02), y, (TRENCH_WALL + 0.12) / 2), "wood_dark", bevel=0.02)


def berm_cells(c, n):
    """Fresh spoil: dark earth on the crest, lighter earth on the slopes, turf only near the foot."""
    if n.z > 0.97 and c.z > 1.0:
        return "earth_dark"
    return "earth" if c.z > 0.35 else "grass_dark"


def berm(p, y0, y1, side):
    """Earth bank outside a revetment: crest just behind the planks, walkable slope down to the ground."""
    xw = side * (TRENCH_HALF + 0.14)
    xc = side * (TRENCH_HALF + 0.6)
    xf = side * (TRENCH_HALF + 0.6 + BERM_REACH)
    pts = []
    for y in (y0, y1):
        pts += [(xw, y, 0.0), (xw, y, TRENCH_WALL), (xc, y, TRENCH_BERM), (xf, y, 0.0)]
    p.hull(pts, "earth", col="berm", cells_fn=berm_cells)


def berm_corner(p, cx, cy, sx, sy):
    """Quarter mound filling an outside corner. (cx, cy) is the revetment corner, (sx, sy) points outward."""
    xw, yw = cx, cy
    reach = 0.6 + BERM_REACH
    pts = [(xw, yw, 0), (xw, yw, TRENCH_WALL), (xw + sx * 0.46, yw + sy * 0.46, TRENCH_BERM),
           (xw + sx * reach, yw, 0), (xw, yw + sy * reach, 0), (xw + sx * reach * 0.72, yw + sy * reach * 0.72, 0),
           (xw + sx * 0.46, yw, TRENCH_BERM), (xw, yw + sy * 0.46, TRENCH_BERM)]
    p.hull(pts, "earth", col="berm", cells_fn=berm_cells)


def duckboards(p, y0, y1, along="Y"):
    if LOD["level"] > 0:
        a, b = sorted((y0, y1))
        if along == "Y":
            p.boxmm((-TRENCH_HALF, a, 0.0), (TRENCH_HALF, b, 0.04), "wood_dark", bottom=False)
        else:
            p.boxmm((a, -TRENCH_HALF, 0.0), (b, TRENCH_HALF, 0.04), "wood_dark", bottom=False)
        return
    n = max(1, int(abs(y1 - y0) / 0.42))
    for i in range(n):
        y = y0 + (y1 - y0) * (i + 0.5) / n
        if along == "Y":
            p.box((TRENCH_HALF * 1.6, 0.3, 0.06), (0, y, 0.03), "wood_light" if i % 3 else "wood", bottom=False)
        else:
            p.box((0.3, TRENCH_HALF * 1.6, 0.06), (y, 0, 0.03), "wood_light" if i % 3 else "wood", bottom=False)


def trench_straight(lod=0):
    LOD["level"] = lod
    try:
        return _trench_straight()
    finally:
        LOD["level"] = 0


def _trench_straight():
    p = Prop("trench_straight", "trench")
    rng = Rng(21)
    for side in (-1, 1):
        revetment(p, -2.0, 2.0, side, rng)
        berm(p, -2.0, 2.0, side)
    duckboards(p, -2.0, 2.0)
    for i, y in enumerate((-1.2, 0.6)):
        sandbag(p, (-(TRENCH_HALF + 0.42), y, TRENCH_BERM + 0.05), 90 + 10 * i, rng=rng)
    p.loot_at((0, 0.0, 0.05))
    p.meta["tile"] = 4.0
    return p


def trench_corner(lod=0):
    LOD["level"] = lod
    try:
        return _trench_corner()
    finally:
        LOD["level"] = 0


def _trench_corner():
    """90 degree turn: one arm runs to the -Y edge (front), the other to the +X edge."""
    p = Prop("trench_corner", "trench")
    rng = Rng(22)
    h, w = TRENCH_HALF, 0.14
    # outer walls: -X side along Y, +Y side along X
    revetment(p, -2.0, h + w, -1, rng)
    with p.frame((0, 0, 0), rot_z=-90):
        revetment(p, -(h + w), 2.0, -1, rng)    # after -90 deg: local -X is world +Y, local y is world x
    # inner walls: +X side from -2 to -h, -Y side from h to 2
    revetment(p, -2.0, -h, 1, rng)
    with p.frame((0, 0, 0), rot_z=-90):
        revetment(p, h, 2.0, 1, rng)
    berm(p, -2.0, h + w, -1)
    with p.frame((0, 0, 0), rot_z=-90):
        berm(p, -(h + w), 2.0, -1)
        berm(p, h, 2.0, 1)
    berm(p, -2.0, -h, 1)
    berm_corner(p, -(h + w), h + w, -1, 1)
    duckboards(p, -2.0, h)
    duckboards(p, h, 2.0, along="X")
    for k in range(5):
        a = math.radians(100 + 18 * k)
        sandbag(p, (-(h + 0.5) + math.cos(a) * 0.3, (h + 0.5) + math.sin(a) * 0.3, TRENCH_BERM + 0.06), math.degrees(a), rng=rng)
    p.loot_at((0, 0, 0.05))
    p.meta["tile"] = 4.0
    return p


def trench_end(lod=0):
    LOD["level"] = lod
    try:
        return _trench_end()
    finally:
        LOD["level"] = 0


def _trench_end():
    """Exit ramp: the floor climbs to the berm crest at the +Y end, then the bank slopes down outside."""
    p = Prop("trench_end", "trench")
    rng = Rng(23)
    ramp_y0, ramp_y1 = -0.4, 1.9
    for side in (-1, 1):
        revetment(p, -2.0, ramp_y1, side, rng)
        berm(p, -2.0, ramp_y1, side)
    # ramp up to the crest, then the closing bank
    h = TRENCH_HALF
    pts = [(-h, ramp_y0, 0), (h, ramp_y0, 0), (-h, ramp_y1, TRENCH_BERM), (h, ramp_y1, TRENCH_BERM),
           (-h, ramp_y1, 0), (h, ramp_y1, 0)]
    p.hull(pts, "earth", col="ramp", cells_fn=lambda c, n: "earth_dark" if n.z > 0.3 else "earth")
    reach = 0.6 + BERM_REACH
    pts = [(-h - 0.14 - reach * 0.6, ramp_y1, 0), (h + 0.14 + reach * 0.6, ramp_y1, 0),
           (-h - 0.14, ramp_y1, TRENCH_BERM), (h + 0.14, ramp_y1, TRENCH_BERM),
           (-h - 0.14, ramp_y1 + 0.5, TRENCH_BERM), (h + 0.14, ramp_y1 + 0.5, TRENCH_BERM),
           (-h, ramp_y1 + 0.5 + BERM_REACH, 0), (h, ramp_y1 + 0.5 + BERM_REACH, 0)]
    p.hull(pts, "earth", col="berm", cells_fn=berm_cells)
    # planks on the ramp so it reads as a dug step
    for i in range(5 if LOD["level"] == 0 else 0):
        y = ramp_y0 + 0.25 + i * 0.45
        z = (y - ramp_y0) / (ramp_y1 - ramp_y0) * TRENCH_BERM
        p.box((h * 1.7, 0.16, 0.08), (0, y, z + 0.02), "wood_dark", rot=(-29, 0, 0), bottom=True)
    duckboards(p, -2.0, ramp_y0)
    p.meta["tile"] = 4.0
    return p


# ---------------------------------------------------------------- loot and props
def _crate(p, sx, sy, sz, ring_r):
    p.box((sx, sy, sz), (0, 0, sz / 2), "wood_light", bevel=0.03, col="crate", top="wood")
    band = 0.11
    for z in (band / 2, sz - band / 2):
        p.box((sx + 0.04, sy + 0.04, band), (0, 0, z), "wood_dark", bevel=0.015, bottom=z > 0.1)
    for x in (-1, 1):
        for y in (-1, 1):
            p.box((0.1, 0.1, sz - 2 * band), (x * (sx / 2 - 0.03), y * (sy / 2 - 0.03), sz / 2), "wood_dark", bottom=True)
    # the yellow loot ring on the front and back faces and the lid
    for side in (-1, 1):
        ring_decal(p, (0, side * (sy / 2 + 0.005), sz / 2), (side * -90, 0, 0), ring_r, ring_r * 0.62, "yellow", depth=0.025)
    ring_decal(p, (0, 0, sz + 0.005), (0, 0, 0), ring_r * 0.8, ring_r * 0.5, "yellow", depth=0.02)


def crate_small():
    p = Prop("crate_small", "loot")
    _crate(p, 0.75, 0.75, 0.7, 0.2)
    p.outline = True
    p.loot_at((0, 0, 0.7))
    p.meta["container"] = "small"
    return p


def crate_large():
    p = Prop("crate_large", "loot")
    _crate(p, 1.45, 0.85, 0.85, 0.26)
    # rope handles on the short ends
    for side in (-1, 1):
        p.tube((side * 0.76, -0.18, 0.55), (side * 0.76, 0.18, 0.55), 0.035, "khaki", segs=4)
    p.outline = True
    p.loot_at((0, 0, 0.85), tier_bonus=1)
    p.meta["container"] = "large"
    return p


def ammo_box():
    p = Prop("ammo_box", "loot")
    p.box((0.5, 0.22, 0.3), (0, 0, 0.15), "olive", bevel=0.025, col="crate")
    p.box((0.52, 0.24, 0.05), (0, 0, 0.29), "olive_dark", bevel=0.012, bottom=True)
    p.box((0.5, 0.235, 0.05), (0, 0, 0.16), "yellow", bottom=True)
    p.tube((-0.11, 0, 0.36), (0.11, 0, 0.36), 0.018, "steel_dark", segs=4)
    p.box((0.06, 0.06, 0.07), (0.2, -0.12, 0.25), "steel", bottom=True)
    p.outline = True
    p.loot_at((0, 0, 0.32))
    p.meta["container"] = "ammo"
    return p


def fuel_barrel():
    p = Prop("fuel_barrel", "loot")
    r, h = 0.29, 0.88
    p.cyl(r, h, (0, 0, h / 2), "olive", segs=12, col="block", cap_cell="olive_dark")
    for z in (0.3, 0.6):
        p.cyl(r + 0.015, 0.035, (0, 0, z), "olive_dark", segs=12, caps=False)
    p.cyl(r + 0.01, 0.03, (0, 0, h - 0.015), "steel", segs=12, caps=False)
    p.cyl(0.045, 0.04, (0.14, 0.05, h + 0.02), "steel_dark", segs=6)
    p.cyl(0.035, 0.03, (-0.15, -0.04, h + 0.015), "steel_dark", segs=6)
    p.box((0.03, 0.16, 0.12), (r + 0.004, 0, 0.45), "yellow")
    return p


BUILDERS = [bunker_pillbox, czech_hedgehog, beach_obstacle, sandbag_wall, sandbag_corner, barbed_wire,
            trench_straight, trench_corner, trench_end, crate_small, crate_large, ammo_box, fuel_barrel]
