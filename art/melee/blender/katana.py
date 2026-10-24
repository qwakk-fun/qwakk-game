"""The duck katana and its scabbard, built from ring stacks (art/blender/geo.py) with the melee palette.

Katana space (Blender): origin at the grip center of the right fist, blade along +Z, edge toward -Y,
flats facing +X and -X. Scabbard space: origin at the mouth, the channel runs down -Z, edge side -Y.
Chunky toy proportions: a wide blade with a bright edge band, a yellow diamond wrap on the handle, a dark
guard with a yellow rim, a gold collar, an orange tassel on the pommel; a dark scabbard with yellow
fittings and an orange cord.
"""

import math

import bpy
from mathutils import Matrix, Vector

import geo
import mp

CELL_NAMES = list(mp.PALETTE)
PER_ROW = mp.PALETTE_SIZE // mp.PALETTE_CELL


def cell_uv(name):
    i = CELL_NAMES.index(name)
    col, row = i % PER_ROW, i // PER_ROW
    return ((col + 0.5) / PER_ROW, 1.0 - (row + 0.5) / PER_ROW)


def build_palette(path):
    size, cell = mp.PALETTE_SIZE, mp.PALETTE_CELL
    img = bpy.data.images.new("melee_palette", size, size, alpha=False)
    px = [0.0] * (size * size * 4)
    for i, name in enumerate(CELL_NAMES):
        r, g, b = geo.hex_to_srgb(mp.PALETTE[name])
        col, row = i % PER_ROW, i // PER_ROW
        for y in range(size - (row + 1) * cell, size - row * cell):
            for x in range(col * cell, (col + 1) * cell):
                k = (y * size + x) * 4
                px[k:k + 4] = [r, g, b, 1.0]
    img.pixels = px
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


def grid(part, rings, cell_of, pole_start=None, pole_end=None):
    """Quads between rings with a cell per face: cell_of(i, j) for band i, column j (fans use band 0 / last)."""
    base = part.ring_stack(rings, "dark", pole_start, pole_end)
    n = len(rings[0])
    nb = len(rings) - 1
    first = len(part.faces) - nb * n - (n if pole_start is not None else 0) - (n if pole_end is not None else 0)
    k = first
    for i in range(nb):
        for j in range(n):
            part.cells[k] = cell_of(i, j)
            k += 1
    if pole_start is not None:
        for j in range(n):
            part.cells[k] = cell_of(0, j)
            k += 1
    if pole_end is not None:
        for j in range(n):
            part.cells[k] = cell_of(nb - 1, j)
            k += 1
    return base


def sori(z):
    """Spine-ward offset of the blade's center line at height z (the gentle katana curve)."""
    z0, z1 = mp.BLADE_Z
    s = max(0.0, (z - z0) / (z1 - z0))
    return mp.SORI * s * s


def ellipse_ring(cz, rx, ry, n, cy=0.0, phase=0.0):
    return [Vector((math.sin(2 * math.pi * j / n + phase) * rx, cy - math.cos(2 * math.pi * j / n + phase) * ry, cz))
            for j in range(n)]


# ----------------------------------------------------------------- katana


def blade_part():
    """Eight-point sections: edge, hamon line, ridge, spine on each side. The kissaki tapers to a point."""
    part = geo.Part("blade")
    z0, z1 = mp.BLADE_Z
    kz = z1 - mp.KISSAKI
    zs = [z0 + (kz - z0) * i / (mp.SEGMENTS_ALONG - 1) for i in range(mp.SEGMENTS_ALONG)]
    zs += [kz + mp.KISSAKI * f for f in (0.35, 0.68, 0.90)]
    rings = []
    for z in zs:
        s = (min(z, kz) - z0) / (kz - z0)
        w = mp.BLADE_W[0] + (mp.BLADE_W[1] - mp.BLADE_W[0]) * s
        t = mp.BLADE_T * (1.0 - 0.25 * s)
        if z > kz:      # kissaki: the edge sweeps up to meet the spine
            u = (z - kz) / mp.KISSAKI
            w *= max(0.08, 1.0 - u ** 1.6)
            t *= max(0.25, 1.0 - 0.75 * u)
        yc = sori(z)
        spine = yc + w * 0.5
        edge = spine - w
        ridge = spine - w * 0.32
        hamon = edge + w * 0.30
        pts = [(0.0012, edge), (t * 0.27, hamon), (t * 0.5, ridge), (t * 0.36, spine),
               (-t * 0.36, spine), (-t * 0.5, ridge), (-t * 0.27, hamon), (-0.0012, edge)]
        rings.append([Vector((x, y, z)) for x, y in pts])
    tip = Vector((0.0, sori(z1) + mp.BLADE_W[1] * 0.5 - 0.004, z1))
    base = Vector((0.0, sori(z0), z0 - 0.004))
    cols = ["edge", "steel", "steel_deep", "steel_deep", "steel_deep", "steel", "edge", "edge"]
    grid(part, rings, lambda i, j: cols[j], pole_start=base, pole_end=tip)
    return part


def handle_parts():
    parts = []
    # wrapped grip: an oval tube with a yellow diamond wrap (checker of two yellows over the ray skin)
    grip = geo.Part("grip")
    n, m = 12, 14
    z0, z1 = mp.POMMEL_Z + 0.022, mp.HANDLE_TOP_Z - 0.012
    rings = []
    for i in range(m + 1):
        z = z0 + (z1 - z0) * i / m
        bulge = 1.0 + 0.06 * math.sin(math.pi * i / m)
        rings.append(ellipse_ring(z, mp.HANDLE_R[0] * bulge, mp.HANDLE_R[1] * bulge, n))

    def wrap(i, j):
        if (i + j) % 2 == 0:
            return "yellow"
        return "yellow_deep" if (j % 3) else "ray"
    grid(grip, rings, wrap)
    parts.append(grip)
    # collar (fuchi) under the guard and the pommel cap (kashira) with its tassel ring
    fittings = geo.Part("fittings")
    lath = [(0.0, z1 - 0.002), (mp.HANDLE_R[0] * 1.18, z1), (mp.HANDLE_R[0] * 1.2, mp.HANDLE_TOP_Z), (0.0, mp.HANDLE_TOP_Z + 0.002)]
    geo.lathe(fittings, lath, 3, 12, "dark", scale=(1.0, mp.HANDLE_R[1] / mp.HANDLE_R[0]))
    cap = [(0.0, mp.POMMEL_Z), (mp.HANDLE_R[0] * 0.9, mp.POMMEL_Z + 0.002), (mp.HANDLE_R[0] * 1.2, mp.POMMEL_Z + 0.012),
           (mp.HANDLE_R[0] * 1.18, z0 + 0.003), (0.0, z0 + 0.004)]
    geo.lathe(fittings, cap, 4, 12, "dark_light", scale=(1.0, mp.HANDLE_R[1] / mp.HANDLE_R[0]))
    parts.append(fittings)
    # guard (tsuba): a dark oval disc with a raised yellow rim
    tsuba = geo.Part("tsuba")
    rz, th = mp.TSUBA_Z, mp.TSUBA_T
    disc = [(0.0, rz - th / 2), (mp.TSUBA_R * 0.96, rz - th / 2), (mp.TSUBA_R, rz), (mp.TSUBA_R * 0.96, rz + th / 2),
            (0.0, rz + th / 2)]
    geo.lathe(tsuba, disc, 4, 20, "dark", scale=(0.86, 1.0))
    rim = geo.Part("tsuba_rim")
    ring_pts = []
    for i in range(21):
        a = 2 * math.pi * i / 20
        ring_pts.append(Vector((math.sin(a) * mp.TSUBA_R * 0.86 * 0.97, -math.cos(a) * mp.TSUBA_R * 0.97, rz)))
    rings = []
    for c in ring_pts:
        d = Vector((c.x, c.y, 0)).normalized()
        rings.append([c + d * (math.cos(2 * math.pi * k / 6) * 0.0055) + Vector((0, 0, math.sin(2 * math.pi * k / 6) * 0.0085))
                      for k in range(6)])
    rim.ring_stack(rings, "yellow")
    parts += [tsuba, rim]
    # blade collar (habaki), gold
    hab = geo.Part("habaki")
    hz0, hz1 = mp.HABAKI_Z
    rings = [ellipse_ring(z, mp.BLADE_T * 0.95, mp.BLADE_W[0] * 0.56, 8, cy=sori(z), phase=math.pi / 8) for z in (hz0, hz1)]
    hab.ring_stack(rings, "yellow_deep", Vector((0, 0, hz0)), Vector((0, sori(hz1), hz1)))
    parts.append(hab)
    # tassel: a cord loop through the pommel, a knot and a chunky tuft hanging toward the spine side
    tas = geo.Part("tassel")
    p0 = Vector((0.0, 0.0, mp.POMMEL_Z - 0.004))
    loop = [p0 + Vector((0.0, 0.012, 0.010)), p0 + Vector((0.0, 0.030, -0.006)), p0 + Vector((0.0, 0.040, -0.030)),
            p0 + Vector((0.0, 0.046, -0.055))]
    path = geo.catmull(loop, 6)
    geo.tube(tas, path, [0.0065] * 6, [0.0065] * 6, 6, "orange", cap_rings=1)
    knot = p0 + Vector((0.0, 0.046, -0.060))
    geo.ellipsoid(tas, knot, (0.016, 0.014, 0.016), Matrix.Identity(3), 8, 5, "orange_deep")
    tuft = [(0.0, -0.002), (0.012, -0.004), (0.020, -0.030), (0.024, -0.058), (0.010, -0.070), (0.0, -0.072)]
    m = Matrix.Translation(knot + Vector((0, 0, -0.004))) @ Matrix.Rotation(math.radians(-14), 4, "X")
    geo.lathe(tas, tuft, 5, 8, lambda c: "orange" if c.z > knot.z - 0.05 else "orange_deep", matrix=m)
    parts.append(tas)
    return parts


# ----------------------------------------------------------------- scabbard


def scabbard_parts():
    """Scabbard space: mouth at the origin, channel down -Z, the same curve as the blade (toward +Y)."""
    body = geo.Part("saya")
    fittings = geo.Part("saya_fittings")
    n = 12
    L = mp.SAYA_LEN
    # the guard sits at the mouth: blade height z_k maps to scabbard depth seat - z_k (see seat_matrix)
    seat = seat_offset()
    zs = [-L * i / 15 for i in range(16)]
    rings = []
    for z in zs:
        zk = seat - z                       # matching blade height
        yc = sori(max(mp.BLADE_Z[0], min(zk, mp.BLADE_Z[1])))
        s = -z / L
        rx = mp.SAYA_R[0] * (1.0 - 0.10 * s)
        ry = mp.SAYA_R[1] * (1.0 - 0.18 * s)
        rings.append(ellipse_ring(z, rx, ry, n, cy=yc))

    def cells(i, j):
        if j in (5, 6, 7):
            return "dark_light"          # a sheen strip along the back (spine) of the scabbard
        return "dark"
    grid(body, rings, cells, pole_start=Vector((0, 0, 0.004)))
    # mouth band (koiguchi), cord knob band (kurikata) and the yellow end cap (kojiri)
    for z0, z1, cell, grow in ((0.004, -0.032, "yellow", 1.12), (-0.105, -0.122, "orange", 1.10),
                               (-0.140, -0.157, "orange", 1.10)):
        r = [ellipse_ring(z, mp.SAYA_R[0] * grow, mp.SAYA_R[1] * grow, n, cy=0.0) for z in (z0, z1)]
        fittings.ring_stack(r, cell, Vector((0, 0, z0)), Vector((0, 0, z1)))
    zc = -L
    yc = sori(mp.BLADE_Z[1])
    cap = [(0.0, zc - 0.022), (mp.SAYA_R[0] * 0.95, zc - 0.016), (mp.SAYA_R[0] * 1.06, zc), (mp.SAYA_R[0] * 1.02, zc + 0.05),
           (0.0, zc + 0.052)]
    geo.lathe(fittings, cap, 5, n, "yellow", center=(0, yc, 0), scale=(1.0, mp.SAYA_R[1] / mp.SAYA_R[0] * 0.84))
    # the cord knob on the edge side, with a short orange cord loop
    knob = Vector((0.0, -mp.SAYA_R[1] * 1.05, -0.13))
    geo.ellipsoid(fittings, knob, (0.010, 0.014, 0.018), Matrix.Identity(3), 6, 4, "dark_light")
    cord = geo.catmull([knob + Vector((0.0, -0.004, 0.012)), knob + Vector((0.0, -0.030, 0.0)),
                        knob + Vector((0.0, -0.012, -0.025)), knob + Vector((0.0, 0.006, -0.040))], 6)
    geo.tube(fittings, cord, [0.006] * 6, [0.006] * 6, 6, "orange", cap_rings=1)
    return [body, fittings]


def seat_offset():
    """Height of the katana's grip center above the scabbard mouth when sheathed (the guard rests on the lip)."""
    return mp.TSUBA_Z + mp.TSUBA_T / 2 + 0.004


def seat_matrix():
    """The katana's frame in scabbard space when sheathed: blade down the channel, edge on the same side."""
    return Matrix.Translation((0, 0, seat_offset())) @ Matrix.Rotation(math.pi, 4, "Y")


# ----------------------------------------------------------------- objects


def edge_y(z):
    """Y of the cutting edge at blade height z (katana space)."""
    z0 = mp.BLADE_Z[0]
    w = mp.BLADE_W[0] + (mp.BLADE_W[1] - mp.BLADE_W[0]) * min(1.0, max(0.0, (z - z0) / (mp.BLADE_Z[1] - mp.KISSAKI - z0)))
    return sori(z) - w * 0.5


def spots():
    """The katana's contract points (katana space): grip, the trail ribbon's two ends on the edge, the tip."""
    ze = mp.TRAIL["TrailEnd"]
    return {
        "Grip": Vector((0, 0, 0)),
        "TrailStart": Vector((0, edge_y(mp.TRAIL["TrailStart"]), mp.TRAIL["TrailStart"])),
        "TrailEnd": Vector((0, edge_y(ze) * 0.6 + sori(ze) * 0.4, ze)),
        "Tip": Vector((0, sori(mp.BLADE_Z[1]) + mp.BLADE_W[1] * 0.5 - 0.004, mp.BLADE_Z[1])),
    }


def build(material):
    """Blender objects: Katana (mesh, origin at the grip) with the Blade mesh and the empties as children,
    and Scabbard (mesh, origin at the mouth) with its KatanaSeat empty. Returns a dict of objects."""
    katana, _ = geo.build_object("Katana", handle_parts(), cell_uv)
    blade, _ = geo.build_object("Blade", [blade_part()], cell_uv)
    saya, _ = geo.build_object("Scabbard", scabbard_parts(), cell_uv)
    for o in (katana, blade, saya):
        o.data.materials.append(material)
        o.data.name = o.name
    blade.parent = katana
    empties = {}
    spots_ = spots()
    for name, loc in spots_.items():
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.03
        e.empty_display_type = "ARROWS"
        bpy.context.scene.collection.objects.link(e)
        e.parent = katana
        e.location = loc
        empties[name] = e
    seat = bpy.data.objects.new("KatanaSeat", None)
    seat.empty_display_size = 0.05
    seat.empty_display_type = "ARROWS"
    bpy.context.scene.collection.objects.link(seat)
    seat.parent = saya
    seat.matrix_basis = seat_matrix()
    empties["KatanaSeat"] = seat
    return {"katana": katana, "blade": blade, "scabbard": saya, "empties": empties, "spots": spots_}
