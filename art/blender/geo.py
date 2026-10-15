"""Small procedural mesh toolkit: everything is a stack of rings, which keeps the topology clean
(quads everywhere, triangle fans only at poles) and makes skin weights easy to compute."""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector


def hex_to_srgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(value):
    return tuple(srgb_to_linear(c) for c in hex_to_srgb(value))


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def interp(keys, s):
    """Smooth 1D interpolation through (s, value) keys (monotone cubic Hermite)."""
    if s <= keys[0][0]:
        return keys[0][1]
    if s >= keys[-1][0]:
        return keys[-1][1]
    n = len(keys)
    slopes = []
    for i in range(n):
        if i == 0:
            m = (keys[1][1] - keys[0][1]) / (keys[1][0] - keys[0][0])
        elif i == n - 1:
            m = (keys[-1][1] - keys[-2][1]) / (keys[-1][0] - keys[-2][0])
        else:
            d0 = (keys[i][1] - keys[i - 1][1]) / (keys[i][0] - keys[i - 1][0])
            d1 = (keys[i + 1][1] - keys[i][1]) / (keys[i + 1][0] - keys[i][0])
            m = 0.0 if d0 * d1 <= 0 else (d0 + d1) / 2
        slopes.append(m)
    for i in range(n - 1):
        s0, v0 = keys[i]
        s1, v1 = keys[i + 1]
        if s0 <= s <= s1:
            h = s1 - s0
            t = (s - s0) / h
            t2, t3 = t * t, t * t * t
            return ((2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * slopes[i]
                    + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * slopes[i + 1])
    return keys[-1][1]


def catmull(points, samples):
    """Centripetal-ish Catmull-Rom through points, resampled to `samples` points evenly by arc length."""
    pts = [Vector(p) for p in points]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    dense = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(24):
            t = k / 24
            t2, t3 = t * t, t * t * t
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                                + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    dense.append(pts[-1])
    return resample(dense, samples)


def resample(dense, samples):
    lengths = [0.0]
    for a, b in zip(dense, dense[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    total = lengths[-1]
    out = []
    j = 0
    for i in range(samples):
        target = total * i / (samples - 1)
        while j < len(lengths) - 2 and lengths[j + 1] < target:
            j += 1
        seg = lengths[j + 1] - lengths[j]
        t = 0.0 if seg == 0 else (target - lengths[j]) / seg
        out.append(dense[j].lerp(dense[j + 1], min(1.0, t)))
    return out


class Part:
    """A closed piece of surface: vertices, faces and one palette cell per face."""

    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []
        self.cells = []
        self.outline = 1.0     # 0 keeps this part out of the inverted-hull outline

    def ring_stack(self, rings, cells, pole_start=None, pole_end=None):
        """Quads between consecutive rings (all rings have the same count) plus fans to optional poles.
        `cells` is one cell name per band, or a single name."""
        base = len(self.verts)
        n = len(rings[0])
        for ring in rings:
            self.verts.extend(Vector(v) for v in ring)

        def cell_for(i):
            return cells if isinstance(cells, str) else cells[min(i, len(cells) - 1)]

        def idx(i, j):
            return base + i * n + (j % n)

        for i in range(len(rings) - 1):
            for j in range(n):
                self.faces.append((idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)))
                self.cells.append(cell_for(i))
        if pole_start is not None:
            p = len(self.verts)
            self.verts.append(Vector(pole_start))
            for j in range(n):
                self.faces.append((p, idx(0, j + 1), idx(0, j)))
                self.cells.append(cell_for(0))
        if pole_end is not None:
            p = len(self.verts)
            self.verts.append(Vector(pole_end))
            last = len(rings) - 1
            for j in range(n):
                self.faces.append((p, idx(last, j), idx(last, j + 1)))
                self.cells.append(cell_for(len(rings) - 2))
        return base


def frames_along(path, up=None):
    """Tangent / normal / binormal per path point. With `up`, the normal follows `up` (for flat parts)."""
    out = []
    prev_n = None
    for i, p in enumerate(path):
        a = path[max(0, i - 1)]
        b = path[min(len(path) - 1, i + 1)]
        t = (b - a).normalized()
        if up is not None:
            u = Vector(up)
            n = (u - t * u.dot(t))
            if n.length < 1e-5:
                n = prev_n if prev_n is not None else t.orthogonal()
        elif prev_n is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((0, -1, 0))
            n = ref - t * ref.dot(t)
        else:
            n = prev_n - t * prev_n.dot(t)
        n.normalize()
        prev_n = n
        out.append((t, n, t.cross(n)))
    return out


def tube(part, path, rx, ry, segments, cells, up=None, cap_start=True, cap_end=True,
         cap_rings=3, cap_depth=(1.0, 1.0), ring_fn=None):
    """Sweep an ellipse along `path`. rx/ry are per-point radii (rx across the binormal, ry along the normal).
    Rounded caps close the ends. `ring_fn(point, s, angle, frame)` may move each vertex."""
    frames = frames_along(path, up)
    rings, band_cells, ring_s = [], [], []
    count = len(path)

    def ring_at(c, t, n, b, sx, sy, s):
        ring = []
        for j in range(segments):
            a = 2 * math.pi * j / segments
            v = c + b * (math.cos(a) * sx) + n * (math.sin(a) * sy)
            if ring_fn:
                v = ring_fn(v, s, a, (t, n, b))
            ring.append(v)
        return ring

    cell_list = cells if isinstance(cells, list) else [cells] * count
    pole_start = pole_end = None
    if cap_start:
        t, n, b = frames[0]
        depth = min(rx[0], ry[0]) * cap_depth[0]
        for k in range(1, cap_rings):
            th = math.pi / 2 * k / cap_rings
            c = path[0] - t * (math.cos(th) * depth)
            rings.append(ring_at(c, t, n, b, rx[0] * math.sin(th), ry[0] * math.sin(th), 0.0))
            band_cells.append(cell_list[0])
        pole_start = path[0] - t * depth
        if ring_fn:
            pole_start = ring_fn(pole_start, 0.0, 0.0, (t, n, b))
    for i in range(count):
        t, n, b = frames[i]
        s = i / (count - 1)
        rings.append(ring_at(path[i], t, n, b, rx[i], ry[i], s))
        band_cells.append(cell_list[i])
    if cap_end:
        t, n, b = frames[-1]
        depth = min(rx[-1], ry[-1]) * cap_depth[1]
        for k in range(cap_rings - 1, 0, -1):
            th = math.pi / 2 * k / cap_rings
            c = path[-1] + t * (math.cos(th) * depth)
            rings.append(ring_at(c, t, n, b, rx[-1] * math.sin(th), ry[-1] * math.sin(th), 1.0))
            band_cells.append(cell_list[-1])
        pole_end = path[-1] + t * depth
        if ring_fn:
            pole_end = ring_fn(pole_end, 1.0, 0.0, (t, n, b))
    part.ring_stack(rings, band_cells, pole_start, pole_end)


def lathe(part, profile, rings, segments, cells, center=(0, 0, 0), scale=(1, 1), y_push=None, matrix=None):
    """Revolve a (radius, z) profile running from pole to pole. The profile is smoothed and resampled
    evenly by arc length. `cells(z, angle)` or a name picks the palette cell per band/face."""
    pts = catmull([(r, 0.0, z) for r, z in profile], rings + 2)
    pts[0].x = 0.0
    pts[-1].x = 0.0
    cx, cy, cz = center
    ring_list = []
    for p in pts[1:-1]:
        r, z = p.x, p.z
        push = y_push(z) if y_push else 0.0
        ring = []
        for j in range(segments):
            a = 2 * math.pi * j / segments
            # angle 0 points at -Y (the face), so seams sit at the back
            v = Vector((math.sin(a) * r * scale[0] + cx,
                        -math.cos(a) * r * scale[1] + cy - push * max(0.0, -math.cos(a)) ** 1.5,
                        z + cz))
            ring.append(matrix @ v if matrix else v)
        ring_list.append(ring)
    pole_a = Vector((cx, cy, pts[0].z + cz))
    pole_b = Vector((cx, cy, pts[-1].z + cz))
    if matrix:
        pole_a, pole_b = matrix @ pole_a, matrix @ pole_b
    base_face = len(part.faces)
    part.ring_stack(ring_list, "yellow", pole_a, pole_b)
    # per-face cells, decided from the face center
    for fi in range(base_face, len(part.faces)):
        f = part.faces[fi]
        c = sum((part.verts[i] for i in f), Vector()) / len(f)
        part.cells[fi] = cells(c) if callable(cells) else cells
    return part


def ellipsoid(part, center, radii, frame, segments, rings, cell):
    """Ellipsoid with local axes = columns of `frame` (3x3). Local Y is the pole axis."""
    c = Vector(center)
    m = Matrix(frame)
    ring_list = []
    for i in range(1, rings):
        phi = math.pi * i / rings
        ring = []
        for j in range(segments):
            a = 2 * math.pi * j / segments
            local = Vector((math.sin(phi) * math.cos(a) * radii[0],
                            -math.cos(phi) * radii[1],
                            math.sin(phi) * math.sin(a) * radii[2]))
            ring.append(c + m @ local)
        ring_list.append(ring)
    part.ring_stack(ring_list, cell, c + m @ Vector((0, -radii[1], 0)), c + m @ Vector((0, radii[1], 0)))


def frame_from_normal(normal, up=(0, 0, 1)):
    """3x3 frame whose Y axis is `normal` (pointing out of a surface) and Z stays close to `up`."""
    y = Vector(normal).normalized()
    u = Vector(up)
    z = (u - y * u.dot(y)).normalized()
    x = y.cross(z)
    return Matrix((x, y, z)).transposed()


def build_object(name, parts, cell_uv, collection=None):
    """Join parts into one mesh object with palette UVs. Returns (object, {part: (v0, v1)})."""
    verts, faces, face_cells, ranges, outline = [], [], [], {}, []
    for part in parts:
        off = len(verts)
        verts.extend(part.verts)
        faces.extend(tuple(i + off for i in f) for f in part.faces)
        face_cells.extend(part.cells)
        ranges.setdefault(part.name, []).append((off, len(verts)))
        outline.extend([part.outline] * len(part.verts))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    uv = mesh.uv_layers.new(name="UVMap")
    for poly, cell in zip(mesh.polygons, face_cells):
        u, v = cell_uv(cell)
        for li in poly.loop_indices:
            uv.data[li].uv = (u, v)
    # consistent outward normals per closed piece
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    group = obj.vertex_groups.new(name="outline")
    for i, w in enumerate(outline):
        group.add([i], w, "REPLACE")
    return obj, ranges


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)
