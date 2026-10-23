"""Mesh helpers for the hunters: the duck's ring-stack toolkit (art/blender/geo.py) plus skin weights per part,
world-projected camo UVs, chamfered boxes, LOD segment counts and the shared palette texture."""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "blender"))
import geo  # noqa: E402  (the duck's toolkit: Part, tube, lathe, ellipsoid, catmull)

import hp  # noqa: E402

CELL_NAMES = list(hp.PALETTE)
PER_ROW = hp.PALETTE_SIZE // hp.PALETTE_CELL
assert len(CELL_NAMES) <= PER_ROW * 8, "palette cells overflow the top half"


def seg(n, lod, lo=4):
    """Segment count for a ring at this LOD (always even, so left and right stay symmetric)."""
    v = max(lo, int(round(n * hp.LOD_FACTORS[lod])))
    return v + (v % 2)


class Part(geo.Part):
    """A closed piece with a palette cell per face and a skin-weight rule (a bone name or a function)."""

    def __init__(self, name, w):
        super().__init__(name)
        self.w = w


# ----------------------------------------------------------------- palette image


def _hash(ix, iy, seed):
    h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def _vnoise(x, y, period, seed):
    """Periodic value noise, smooth, in [0, 1]."""
    x0, y0 = math.floor(x), math.floor(y)
    fx, fy = x - x0, y - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)

    def h(i, j):
        return _hash(i % period, j % period, seed)

    a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * fx
    b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * fx
    return a + (b - a) * fy


def camo_index(px, py, tile):
    """Which of the 4 camo colors a pixel of a 128 px tile gets: blotches from two noise octaves."""
    out = 0
    for k, (thr, seed) in enumerate(((0.60, 11), (0.62, 23), (0.66, 37))):
        s = seed + tile * 101
        n = 0.68 * _vnoise(px / 16.0, py / 16.0, 8, s) + 0.32 * _vnoise(px / 8.0, py / 8.0, 16, s + 5)
        if n > thr:
            out = k + 1
    return out


def build_palette(path):
    size, cell = hp.PALETTE_SIZE, hp.PALETTE_CELL
    img = bpy.data.images.new("hunter_palette", size, size, alpha=False)
    px = [0.0] * (size * size * 4)

    def put(x, y_top, rgb):
        y = size - 1 - y_top              # Blender rows go bottom-up
        k = (y * size + x) * 4
        px[k:k + 4] = [rgb[0], rgb[1], rgb[2], 1.0]

    for i, name in enumerate(CELL_NAMES):
        rgb = geo.hex_to_srgb(hp.PALETTE[name])
        col, row = i % PER_ROW, i // PER_ROW
        for y in range(row * cell, (row + 1) * cell):
            for x in range(col * cell, (col + 1) * cell):
                put(x, y, rgb)
    half = size // 2
    for tile in (0, 1):
        cols = [geo.hex_to_srgb(c) for c in hp.CAMO[tile]]
        for y in range(half):
            for x in range(half):
                put(tile * half + x, half + y, cols[camo_index(x, y, tile)])
    img.pixels = px
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


def cell_uv(name):
    i = CELL_NAMES.index(name)
    col, row = i % PER_ROW, i // PER_ROW
    c = hp.PALETTE_CELL / hp.PALETTE_SIZE
    return ((col + 0.5) * c, 1.0 - (row + 0.5) * c)


def camo_uv(tile, co, normal):
    """World projection into a camo tile: front and back faces use (x, z), side faces (y, z), top faces (x, y)."""
    n = normal
    span = hp.CAMO_METERS
    if abs(n.z) > 0.8:
        a, b = co.x, co.y + span / 2
    elif abs(n.x) > abs(n.y):
        a, b = co.y, co.z
    else:
        a, b = co.x, co.z
    u = min(0.985, max(0.015, (a + span / 2) / span))
    v = min(0.985, max(0.015, b / span))
    return (tile * 0.5 + u * 0.5, v * 0.5)


# ----------------------------------------------------------------- shapes


def box(part, p0, p1, w, h, up, cell, chamfer=0.32, taper=1.0):
    """A chamfered box from p0 to p1 (centers of the end faces), width w across, height h along `up`.
    Eight vertices per ring, flat end caps. `taper` scales the far end."""
    p0, p1 = Vector(p0), Vector(p1)
    t = (p1 - p0).normalized()
    u = Vector(up)
    u = (u - t * u.dot(t)).normalized()
    r = t.cross(u)
    c = chamfer
    shape = [(1, c), (c, 1), (-c, 1), (-1, c), (-1, -c), (-c, -1), (c, -1), (1, -c)]

    def ring(p, s):
        return [p + r * (x * w / 2 * s) + u * (y * h / 2 * s) for x, y in shape]

    part.ring_stack([ring(p0, 1.0), ring(p1, taper)], cell, p0, p1)


def ellipsoid_xyz(part, center, radii, cell, segments, rings, rot=None):
    """Ellipsoid with radii along world x, y, z, pole axis z, optionally rotated by a 3x3 `rot`."""
    # geo.ellipsoid: local Y is the pole axis; map local (x, y, z) -> world (x, z, -y)
    base = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
    m = (rot @ base) if rot is not None else base
    geo.ellipsoid(part, center, (radii[0], radii[2], radii[1]), m, segments, rings, cell)


def tube(part, pts, radii, segments, cells, up=None, caps=True, ry=None, cap_rings=2, samples=None):
    """Swept ellipse through `pts` (Catmull-Rom, `samples` rings). Radii lists are interpolated along the path."""
    n = samples or len(pts)
    path = geo.catmull(pts, n) if len(pts) > 2 or n > 2 else [Vector(p) for p in pts]
    n = len(path)

    def along(r):
        if not isinstance(r, list):
            return [r] * n
        if len(r) == n:
            return r
        out = []
        for i in range(n):
            f = i / (n - 1) * (len(r) - 1)
            k = min(int(f), len(r) - 2)
            out.append(r[k] + (r[k + 1] - r[k]) * (f - k))
        return out

    rx = along(radii)
    ryy = along(ry) if ry is not None else rx
    if isinstance(cells, list) and len(cells) != n:
        cells = [cells[int(round(i / (n - 1) * (len(cells) - 1)))] for i in range(n)]
    geo.tube(part, path, rx, ryy, segments, cells, up=up, cap_start=caps, cap_end=caps, cap_rings=cap_rings)


def lathe(part, profile, rings, segments, cells, center=(0, 0, 0), scale=(1, 1), matrix=None):
    return geo.lathe(part, profile, rings, segments, cells, center=center, scale=scale, matrix=matrix)


def star(part, center, normal, radius, depth, cell, points=5, spin=0.0):
    """A chunky 5-point star: a ring of 10 points (alternating radii) extruded to `depth`, capped."""
    n = Vector(normal).normalized()
    a = n.orthogonal().normalized()
    b = n.cross(a)
    c = Vector(center)
    ring = []
    for i in range(points * 2):
        ang = spin + math.pi * i / points
        rr = radius if i % 2 == 0 else radius * 0.48
        ring.append(c + a * (math.cos(ang) * rr) + b * (math.sin(ang) * rr))
    front = [v + n * (depth / 2) for v in ring]
    back = [v - n * (depth / 2) for v in ring]
    part.ring_stack([back, front], cell, c - n * depth * 0.9, c + n * depth * 0.9)


# ----------------------------------------------------------------- objects


def build_object(name, parts, collection=None):
    """Join parts into one mesh with palette (and camo) UVs and an 'outline' group.
    Returns (object, [(part, v0, v1)])."""
    verts, faces, face_cells, spans, outline = [], [], [], [], []
    for part in parts:
        off = len(verts)
        verts.extend(part.verts)
        faces.extend(tuple(i + off for i in f) for f in part.faces)
        face_cells.extend(part.cells)
        spans.append((part, off, len(verts)))
        outline.extend([part.outline] * len(part.verts))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    uv = mesh.uv_layers.new(name="UVMap")
    for poly, cell in zip(mesh.polygons, face_cells):
        if cell.startswith("camo"):
            tile = int(cell[4:])
            for li in poly.loop_indices:
                co = mesh.vertices[mesh.loops[li].vertex_index].co
                uv.data[li].uv = camo_uv(tile, co, poly.normal)
        else:
            u, v = cell_uv(cell)
            for li in poly.loop_indices:
                uv.data[li].uv = (u, v)
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    group = obj.vertex_groups.new(name="outline")
    for i, w in enumerate(outline):
        group.add([i], w, "REPLACE")
    return obj, spans


def skin(obj, rig_obj, spans, bones):
    """Weights from each part's rule; at most 4 bones per vertex, normalized."""
    obj.parent = rig_obj
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig_obj
    groups = {b: obj.vertex_groups.new(name=b) for b in bones}
    verts = obj.data.vertices
    for part, v0, v1 in spans:
        for i in range(v0, v1):
            w = part.w if isinstance(part.w, dict) else ({part.w: 1.0} if isinstance(part.w, str) else part.w(verts[i].co))
            w = {k: v for k, v in w.items() if v > 1e-4}
            total = sum(w.values())
            for b, val in sorted(w.items(), key=lambda kv: (-kv[1], kv[0]))[:4]:
                groups[b].add([i], val / total, "REPLACE")


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def L(lod, *values):
    """Pick a per-LOD value: L(lod, 16, 10, 6)."""
    return values[min(lod, len(values) - 1)]
