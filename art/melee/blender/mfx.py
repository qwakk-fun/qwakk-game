"""Swing effect helpers (melee_fx.glb): a slash crescent, a shockwave ring, an elite enemy ring and the
XP feather pickup.

FX space (Blender): built around the origin, the ground plane is XY, forward is -Y (glTF: the XZ plane,
forward +Z, Y up). The additive pieces (SlashArc, Shockwave, EliteRing) are flat ribbons with:
  - UVMap: u along the piece (0 to 1), v across it (0 inner edge, 1 outer edge), for shader fades;
  - a vertex color (COLOR_0, linear) that already holds a white-hot to transparent ramp, so additive
    blending with vertexColors alone looks right (black is invisible).
The feather is a regular toon mesh on the melee palette.
"""

import math

import bpy
from mathutils import Matrix, Vector

import geo
import katana
import mp


def _fx_material():
    mat = bpy.data.materials.new("MeleeFx")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = "Col"
    nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(col.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 1.0
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    mat.use_backface_culling = False
    return mat


def _ribbon(name, rings, colors, uvs, material):
    """A quad strip mesh: rings[i] is a list of points across the strip (same count each)."""
    n = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = []
    for i in range(len(rings) - 1):
        for j in range(n - 1):
            a = i * n + j
            faces.append((a, a + 1, a + n + 1, a + n))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    uv = me.uv_layers.new(name="UVMap")
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    flat_c = [c for r in colors for c in r]
    flat_uv = [u for r in uvs for u in r]
    for poly in me.polygons:
        poly.use_smooth = True
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = flat_uv[vi]
            col.data[li].color = flat_c[vi]
    # every face looks up (+Z), so a ground ribbon lights the same from both sides
    for poly in me.polygons:
        if poly.normal.z < 0:
            poly.flip()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    me.materials.append(material)
    return obj


def _hot(k, tint):
    """White-hot core fading to a tint, scaled by k (0 transparent for additive blending)."""
    w = max(0.0, min(1.0, k))
    core = max(0.0, (w - 0.6) / 0.4)
    r, g, b = geo.hex_to_linear(tint)
    return (w * (r + (1 - r) * core), w * (g + (1 - g) * core), w * (b + (1 - b) * core), w)


def slash_arc(material):
    """A crescent on the ground plane, radius 1 m, ARC_DEGREES wide, centered on forward (-Y).
    u = 0 at the duck's right end (where a right-to-left swing starts), u = 1 at the left end (the leading
    edge: brightest). Thickest in the middle, tapering to points. Mirror x for a left-to-right swing."""
    segs, across = 28, 4
    half = mp.ARC_DEGREES / 2
    rings, cols, uvs = [], [], []
    for i in range(segs + 1):
        u = i / segs
        a = math.radians(-half + mp.ARC_DEGREES * u)
        d = Vector((math.sin(a), -math.cos(a), 0.0))
        width = 0.34 * math.sin(math.pi * u) ** 0.75 + 0.004
        ring, col, uv = [], [], []
        for j in range(across + 1):
            v = j / across
            r = mp.ARC_RADIUS - width * (1 - v)
            ring.append(d * r)
            lead = 0.18 + 0.82 * u ** 1.4
            edge = v ** 1.8
            col.append(_hot(lead * edge * (1.0 if v < 1 else 0.85), "#ffd43b"))
            uv.append((u, v))
        rings.append(ring)
        cols.append(col)
        uvs.append(uv)
    return _ribbon("SlashArc", rings, cols, uvs, material)


def shockwave(material):
    """A ground ring, outer radius 1 m: a bright rim fading inward, plus a short wall (0.22 m) fading up.
    u runs around (0 to 1 from forward, counter-clockwise from above), v from the inner edge (0) over the
    rim to the wall top (1)."""
    segs = 48
    profile = [(0.62, 0.0, 0.0), (0.86, 0.0, 0.35), (0.97, 0.0, 0.9), (1.0, 0.0, 1.0), (1.0, 0.08, 0.7), (1.0, 0.22, 0.0)]
    rings, cols, uvs = [], [], []
    for i in range(segs + 1):
        u = i / segs
        a = 2 * math.pi * u
        d = Vector((math.sin(a), -math.cos(a), 0.0))
        rings.append([d * r * mp.SHOCK_RADIUS + Vector((0, 0, z)) for r, z, _k in profile])
        cols.append([_hot(k, "#ff8a3d") for _r, _z, k in profile])
        uvs.append([(u, j / (len(profile) - 1)) for j in range(len(profile))])
    obj = _ribbon("Shockwave", rings, cols, uvs, material)
    return obj


def elite_ring(material):
    """The elite enemy marker: a ground ring (radius 0.6 m) with eight outward spikes, hot orange-red."""
    segs = 64
    rings, cols, uvs = [], [], []
    for i in range(segs + 1):
        u = i / segs
        a = 2 * math.pi * u
        d = Vector((math.sin(a), -math.cos(a), 0.0))
        spike = max(0.0, math.cos(8 * a)) ** 6
        r_in, r_mid, r_out = 0.84, 0.95, 1.0 + 0.22 * spike
        rings.append([d * r * mp.ELITE_RADIUS for r in (r_in, r_mid, r_out)])
        cols.append([_hot(0.0, "#ff4b2b"), _hot(1.0, "#ff6a2b"), _hot(0.25 + 0.6 * spike, "#ff4b2b")])
        uvs.append([(u, 0.0), (u, 0.5), (u, 1.0)])
    return _ribbon("EliteRing", rings, cols, uvs, material)


def feather(material):
    """XP pickup: a chunky golden feather, 0.30 m tall, standing up (spin it about its vertical axis),
    origin at its middle. Toon mesh on the melee palette."""
    vane = geo.Part("vane")
    rachis = geo.Part("rachis")
    n_along, curve = 12, 0.05
    rings = []
    for i in range(n_along + 1):
        s = i / n_along
        z = -0.11 + 0.25 * s
        x = curve * math.sin(math.pi * s * 0.9)
        half = 0.06 * math.sin(math.pi * min(1.0, s * 1.08)) ** 0.7 + 0.004
        notch = 0.010 if i in (4, 8) else 0.0
        t = 0.010 * (1 - s) + 0.004
        rings.append([Vector((x + 0.0, 0.0, z)) + Vector(v) for v in (
            (half - notch, 0.0, -0.012 * (1 - s)), (half * 0.5, t, 0.0), (0.0, t * 1.2, 0.0),
            (-half * 0.5, t, 0.0), (-(half - notch), 0.0, -0.012 * (1 - s)), (-half * 0.5, -t, 0.0),
            (0.0, -t * 1.2, 0.0), (half * 0.5, -t, 0.0))])
    katana.grid(vane, rings, lambda i, j: "feather_deep" if j in (0, 4) or i < 2 else "feather",
                pole_start=Vector((0.0, 0.0, -0.115)), pole_end=Vector((curve * math.sin(math.pi * 0.9), 0.0, 0.145)))
    path = [Vector((curve * math.sin(math.pi * s * 0.9) * (1 if s > 0 else 0), 0.0, -0.165 + 0.30 * s)) for s in
            (0.0, 0.2, 0.45, 0.7, 0.92)]
    geo.tube(rachis, geo.catmull(path, 8), [0.009, 0.008, 0.007, 0.006, 0.005, 0.004, 0.003, 0.002],
             [0.009, 0.008, 0.007, 0.006, 0.005, 0.004, 0.003, 0.002], 6, "quill", cap_rings=1)
    obj, _ = geo.build_object("Feather", [vane, rachis], katana.cell_uv)
    obj.data.materials.append(material)
    obj.data.name = "Feather"
    return obj


def build(palette_material):
    fx_mat = _fx_material()
    objs = {
        "SlashArc": slash_arc(fx_mat),
        "Shockwave": shockwave(fx_mat),
        "EliteRing": elite_ring(fx_mat),
        "Feather": feather(palette_material),
    }
    return objs, fx_mat
