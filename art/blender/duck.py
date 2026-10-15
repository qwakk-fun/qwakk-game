"""Builds the Qwakk duck mesh (one object, one material, palette UVs) and the beanie accessory."""

import math
import os

import bpy
from mathutils import Matrix, Vector

import geo
import params as P

CELL_NAMES = list(P.PALETTE.keys())
PER_ROW = P.PALETTE_SIZE // P.PALETTE_CELL


def cell_uv(name):
    i = CELL_NAMES.index(name)
    col, row = i % PER_ROW, i // PER_ROW
    return ((col + 0.5) / PER_ROW, 1.0 - (row + 0.5) / PER_ROW)


def build_palette(path):
    """256 px palette texture: one flat 16 px cell per color, row 0 at the top."""
    size, cell = P.PALETTE_SIZE, P.PALETTE_CELL
    img = bpy.data.images.new("duck_palette", size, size, alpha=False)
    px = [0.0] * (size * size * 4)
    for i, name in enumerate(CELL_NAMES):
        r, g, b = geo.hex_to_srgb(P.PALETTE[name])
        col, row = i % PER_ROW, i // PER_ROW
        for y in range(size - (row + 1) * cell, size - row * cell):   # Blender rows go bottom-up
            for x in range(col * cell, (col + 1) * cell):
                k = (y * size + x) * 4
                px[k:k + 4] = [r, g, b, 1.0]
    img.pixels = px
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


# ------------------------------------------------------------------ head
def head_point(yaw_deg, pitch_deg):
    """Point and outward normal on the head ellipsoid in a yaw/pitch direction (yaw 0 = face)."""
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    d = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    a, b, c = P.HEAD_RADII
    t = 1.0 / math.sqrt((d.x / a) ** 2 + (d.y / b) ** 2 + (d.z / c) ** 2)
    p = d * t
    n = Vector((p.x / a ** 2, p.y / b ** 2, p.z / c ** 2)).normalized()
    return Vector(P.HEAD_CENTER) + p, n


def build_head(parts):
    head = geo.Part("head")
    a, b, c = P.HEAD_RADII
    # slightly fuller cheeks below the equator keep the head from reading as a perfect ball
    profile = []
    for i in range(13):
        phi = math.pi * i / 12
        z = -math.cos(phi) * c
        r = math.sin(phi) * a * (1.0 + 0.035 * max(0.0, math.cos(phi)) * math.sin(phi))
        profile.append((r, z))
    geo.lathe(head, profile, P.HEAD_RINGS, P.HEAD_SEGMENTS, "yellow", center=P.HEAD_CENTER, scale=(1.0, b / a))
    parts.append(head)

    for side in (1, -1):
        p, n = head_point(side * P.EYE_YAW_DEG, P.EYE_PITCH_DEG)
        toe = Matrix.Rotation(math.radians(-side * P.EYE_TOE_IN_DEG), 3, "Z")
        n_eye = (toe @ n).normalized()
        frame = geo.frame_from_normal(n_eye)
        center = p - n * P.EYE_SINK
        eye = geo.Part("eye")
        geo.ellipsoid(eye, center, P.EYE_RADII, frame, 14, 7, "eye")
        parts.append(eye)
        # catchlights on the upper side toward the key light (viewer's left)
        w, bulge, h = P.EYE_RADII
        for (u, v), radii in (((0.36 * side, 0.40), P.SHINE_BIG), ((-0.30 * side, -0.36), P.SHINE_SMALL)):
            depth = bulge * math.sqrt(max(0.0, 1 - u * u - v * v)) - radii[1] * 0.15
            local = Vector((u * w, depth, v * h))
            # mirrored, on the inner upper side of each eye, so a shine never pokes past the head silhouette
            s_center = center + Matrix(frame) @ local
            shine = geo.Part("shine")
            shine.outline = 0.0
            geo.ellipsoid(shine, s_center, radii, frame, 7, 3, "shine")
            parts.append(shine)

        bp, bn = head_point(side * P.BLUSH_YAW_DEG, P.BLUSH_PITCH_DEG)
        blush = geo.Part("blush")
        blush.outline = 0.0
        geo.ellipsoid(blush, bp - bn * (P.BLUSH_RADII[1] * 0.55), P.BLUSH_RADII, geo.frame_from_normal(bn), 12, 5, "blush")
        parts.append(blush)

    build_bill(parts)
    build_tuft(parts)


def bill_ring_fn(smile):
    def fn(v, s, a, frame):
        t, n, b = frame
        lateral = math.cos(a)
        return v + Vector((0, 0, 1)) * (smile * lateral * lateral * (1 - s) ** 1.5)
    return fn


def build_bill(parts):
    base = Vector(P.BILL_BASE)
    steps = 10
    path = [base + Vector((0, -P.BILL_LENGTH * s, P.BILL_TIP_LIFT * s * s)) for s in (i / (steps - 1) for i in range(steps))]
    ss = [i / (steps - 1) for i in range(steps)]
    W, T = P.BILL_WIDTH, P.BILL_THICK
    rx = [geo.interp([(0, W * 0.80), (0.3, W * 0.97), (0.7, W), (0.9, W * 0.9), (1.0, W * 0.68)], s) for s in ss]
    ry = [geo.interp([(0, T), (0.45, T * 0.74), (1.0, T * 0.56)], s) for s in ss]
    upper = geo.Part("bill")
    geo.tube(upper, path, rx, ry, 16, "orange", up=(0, 0, 1), cap_depth=(1.0, 1.6), ring_fn=bill_ring_fn(P.BILL_SMILE))
    parts.append(upper)

    jaw_base = Vector(P.JAW_PIVOT) + Vector((0, 0.0, -P.JAW_THICK * 0.25))
    jpath = [jaw_base + Vector((0, -P.JAW_LENGTH * s, P.BILL_TIP_LIFT * 0.5 * s * s)) for s in ss]
    JW, JT = P.JAW_WIDTH, P.JAW_THICK
    jrx = [geo.interp([(0, JW * 0.85), (0.35, JW), (0.8, JW * 0.9), (1.0, JW * 0.6)], s) for s in ss]
    jry = [geo.interp([(0, JT), (1.0, JT * 0.7)], s) for s in ss]
    jaw = geo.Part("jaw")
    geo.tube(jaw, jpath, jrx, jry, 16, "orange_deep", up=(0, 0, 1), cap_depth=(1.0, 1.6), ring_fn=bill_ring_fn(P.BILL_SMILE * 0.8))
    parts.append(jaw)

    mouth = geo.Part("mouth")
    mouth.outline = 0.0
    mc = Vector(P.JAW_PIVOT) + Vector((0, -0.06, -0.004))
    geo.ellipsoid(mouth, mc, (0.085, 0.095, 0.02), Matrix.Identity(3), 12, 6, "mouth")
    parts.append(mouth)


def build_tuft(parts):
    def feather(points, radii, cells, name, samples=12, segments=8, up=(1, 0, 0)):
        path = geo.catmull(points, samples)
        keys = [(i / (len(radii) - 1), r) for i, r in enumerate(radii)]
        rr = [geo.interp(keys, i / (samples - 1)) for i in range(samples)]
        cell_list = [cells[0] if i < samples * 2 // 3 else cells[1] for i in range(samples)]
        part = geo.Part(name)
        geo.tube(part, path, rr, [r * 0.85 for r in rr], segments, cell_list, up=up, cap_rings=3)
        parts.append(part)

    feather(P.TUFT_POINTS, P.TUFT_RADII, ("yellow", "yellow"), "tuft")

    root = Vector(P.TUFT_POINTS[0])
    off = Vector(P.TUFT2_OFFSET)
    pts2 = [root + off + (Vector(p) - root) * P.TUFT2_SCALE for p in P.TUFT_POINTS]
    pts2 = [p + Vector((0.4 * (p.z - pts2[0].z), 0, 0)) for p in pts2]   # lean the small feather outward
    feather(pts2, [r * 0.8 for r in P.TUFT_RADII], ("yellow", "yellow_deep"), "tuft")

    # back swirl: a raised deep-yellow spiral on the back of the head, the Q curl seen from behind
    yaw0, pitch0 = P.BACK_SWIRL_CENTER
    pts, radii = [], []
    count = 30
    for i in range(count):
        t = i / (count - 1)
        ang = P.BACK_SWIRL_TURNS * 2 * math.pi * t
        rad = P.BACK_SWIRL_RADIUS * (1.0 - 0.82 * t)
        p, n = head_point(180 + yaw0 + rad * math.cos(ang), pitch0 + rad * math.sin(ang))
        pts.append(p + n * 0.002)
        radii.append(geo.lerp(0.017, 0.008, t))
    swirl = geo.Part("tuft")
    swirl.outline = 0.4
    geo.tube(swirl, pts, radii, [r * 0.7 for r in radii], 6, "yellow_deep", cap_rings=2)
    parts.append(swirl)


# ------------------------------------------------------------------ body
def build_body(parts):
    body = geo.Part("body")

    def push(z):
        return P.BODY_BELLY_PUSH * geo.smoothstep(0.50, 0.70, z) * (1 - geo.smoothstep(0.80, 1.05, z))

    geo.lathe(body, P.BODY_PROFILE, P.BODY_RINGS, P.BODY_SEGMENTS, "yellow", scale=P.BODY_SCALE_XY, y_push=push)
    parts.append(body)

    # lighter belly: an ellipsoid that only just breaks the body surface, so its edge is a smooth oval
    belly = geo.Part("belly")
    belly.outline = 0.0
    geo.ellipsoid(belly, (0, -0.105, 0.69), (0.215, 0.21, 0.225), geo.frame_from_normal((0, -1, 0)), 20, 8, "belly")
    parts.append(belly)

    # tail: a plump feather that sticks out of the rump and flips up, flanked by two smaller ones
    for side, yaw, scale in P.TAIL_FEATHERS:
        root = Vector(P.TAIL_ROOT) + Vector((side, 0, -0.02 * abs(side) / 0.075))
        rot = Matrix.Rotation(math.radians(yaw), 3, "Z")
        local = [Vector((0, 0, 0)), Vector((0, 0.10, 0.02)), Vector((0, 0.18, 0.07)), Vector((0, 0.22, 0.15))]
        path = geo.catmull([root + rot @ (p * scale) for p in local], 7)
        ss = [i / 6 for i in range(7)]
        rx = [geo.interp([(0, 0.075), (0.45, 0.07), (1, 0.014)], s) * scale for s in ss]
        ry = [geo.interp([(0, 0.045), (0.5, 0.034), (1, 0.012)], s) * scale for s in ss]
        tail = geo.Part("tail")
        geo.tube(tail, path, rx, ry, 8, ["yellow"] * 5 + ["yellow_deep"] * 2, up=rot @ Vector((0, -0.3, 1)), cap_depth=(1.0, 1.2))
        parts.append(tail)


def mirror_part(part):
    m = geo.Part(part.name + "_R")
    m.outline = part.outline
    m.verts = [Vector((-v.x, v.y, v.z)) for v in part.verts]
    m.faces = [tuple(reversed(f)) for f in part.faces]
    m.cells = list(part.cells)
    return m


def build_arm_left():
    out = []
    x0, x1 = P.ARM_JOINT_X, P.HAND_END_X
    steps = 16
    xs = [x0 + (x1 - x0) * i / (steps - 1) for i in range(steps)]
    ur0, ur1 = P.UPPER_ARM_R
    fr0, fr1 = P.FOREARM_R
    pw, pt = P.PALM_HALF
    wr = P.WRIST_X
    # rx: front-back width (Y), ry: thickness (Z)
    rx_keys = [(x0, ur0), (P.ELBOW_X, ur1), (wr - 0.05, fr1), (wr, fr1 * 0.86), (wr + 0.05, pw), (x1, pw * 0.86)]
    ry_keys = [(x0, ur0), (P.ELBOW_X, ur1 * 0.97), (wr - 0.05, fr1 * 0.86), (wr, pt * 1.25), (wr + 0.05, pt), (x1, pt * 0.9)]
    path = [Vector((x, 0, P.SHOULDER_Z)) for x in xs]
    rx = [geo.interp(rx_keys, x) for x in xs]
    ry = [geo.interp(ry_keys, x) for x in xs]
    arm = geo.Part("arm")
    geo.tube(arm, path, rx, ry, 12, "yellow", up=(0, 0, 1), cap_depth=(1.0, 0.8))
    out.append(arm)

    wrist = Vector((wr, 0, P.SHOULDER_Z))
    for name, off, direction, length, w, t in P.FINGERS:
        root = wrist + Vector(off)
        d = Vector(direction).normalized()
        n = P.FINGER_RINGS
        ss = [i / (n - 1) for i in range(n)]
        path = [root + d * (length * s) + Vector((0, 0, -0.018)) * s * s for s in ss]
        rx = [geo.interp([(0, w * 0.95), (0.45, w * 1.04), (0.8, w * 0.86), (1, w * 0.55)], s) for s in ss]
        ry = [geo.interp([(0, t), (1, t * 0.72)], s) for s in ss]
        f = geo.Part("finger_" + name)
        cells = ["yellow"] * (n - 3) + ["yellow_deep"] * 3
        geo.tube(f, path, rx, ry, P.FINGER_SEGMENTS, cells, up=(0, 0, 1), cap_depth=(1.0, 1.3))
        f.finger = (name, root, d, length)
        out.append(f)

    # wing feathers on the trailing edge of the forearm: the arm reads as a wing from the side
    for x, length in ((0.50, 0.085), (0.565, 0.105), (0.625, 0.12)):
        root = Vector((x, 0.035, P.SHOULDER_Z))
        d = Vector((0.42, 0.88, -0.06)).normalized()
        n = 5
        ss = [i / (n - 1) for i in range(n)]
        path = [root + d * (length * s) for s in ss]
        rx = [geo.interp([(0, 0.030), (0.5, 0.033), (1, 0.010)], s) for s in ss]
        ry = [geo.interp([(0, 0.018), (1, 0.010)], s) for s in ss]
        wf = geo.Part("wingfeather")
        geo.tube(wf, path, rx, ry, 6, ["yellow"] * 3 + ["yellow_deep"] * 2, up=(0, 0, 1), cap_rings=2, cap_depth=(1.0, 1.4))
        out.append(wf)
    return out


def build_leg_left():
    out = []
    s0, s1 = P.SHIN_R
    t0, t1 = P.THIGH_R
    # (z, radius): drumstick thigh, a rounded feather roll at the knee, then the orange shin
    profile = [(0.63, t0), (0.54, t0 * 0.97), (0.465, t0 * 0.86), (0.435, t1),
               (0.415, P.CUFF_R * 0.93), (0.40, P.CUFF_R), (0.386, P.CUFF_R * 0.97), (0.374, P.CUFF_R * 0.86),
               (0.366, P.CUFF_R * 0.73), (0.360, s0), (0.31, s0 * 0.98), (0.24, s0 * 0.955),
               (0.16, s0 * 0.93), (P.ANKLE_Z, s1)]
    path = [Vector((P.HIP_X, 0, z)) for z, _ in profile]
    rr = [r for _, r in profile]
    cells = ["yellow" if z >= 0.366 else "orange" for z, _ in profile]
    def feathers(v, s, ang, frame):
        # the underside of the knee roll hangs down in rounded feather points
        z = v.z
        w = geo.smoothstep(0.405, 0.385, z) * geo.smoothstep(0.355, 0.364, z)
        if w <= 0:
            return v
        point = max(0.0, math.cos(P.KNEE_FEATHERS * ang)) ** 1.5
        return v + Vector((0, 0, -P.KNEE_FEATHER_DROP * point * w))

    leg = geo.Part("leg")
    geo.tube(leg, path, rr, rr, P.LEG_SEGMENTS, cells, up=(0, -1, 0), cap_rings=3, ring_fn=feathers)
    out.append(leg)
    out.append(build_foot_left())
    return out


def build_foot_left():
    F, B, S = P.FOOT_FRONT, P.FOOT_BACK, P.FOOT_SIDE
    spread = P.FOOT_TOE_SPREAD_DEG
    outline = []
    count = 26
    for i in range(count):
        phi = -180 + 360 * i / count            # degrees from forward (-Y), positive toward +X
        a = abs(phi)
        base = geo.interp([(0, F * 0.74), (40, F * 0.72), (85, S), (135, (S + B) * 0.5), (180, B)], a)
        lobes = sum(math.exp(-((phi - c) / 9.0) ** 2) for c in (-spread, 0.0, spread)) if a < 70 else 0.0
        r = base + F * 0.27 * lobes
        rad = math.radians(phi)
        outline.append(Vector((math.sin(rad) * r, -math.cos(rad) * r, 0)))
    T = P.FOOT_THICK
    levels = [(0.55, 0.0), (0.9, 0.003), (0.975, 0.014), (1.0, T * 0.48), (0.975, T * 0.8),
              (0.9, T * 0.95), (0.55, T)]
    turn = Matrix.Rotation(math.radians(-P.FOOT_TURN_OUT_DEG), 3, "Z")
    center = Vector((P.HIP_X, P.FOOT_CENTER_Y, 0))
    ankle = Vector((P.HIP_X, 0, 0))

    def place(v):
        fwd = -v.y
        lift = 0.016 * geo.smoothstep(F * 0.55, F, fwd)
        p = center + Vector((v.x, v.y, v.z + lift))
        return ankle + turn @ (p - ankle)

    rings = [[place(o * s + Vector((0, 0, z))) for o in outline] for s, z in levels]
    cells = ["orange_deep"] * 2 + ["orange"] * (len(levels) - 2)
    foot = geo.Part("foot")
    foot.ring_stack(rings, cells, place(Vector((0, 0, 0))), place(Vector((0, 0, T))))
    return foot


def build_duck(collection=None):
    parts = []
    build_head(parts)
    build_body(parts)
    left = build_arm_left() + build_leg_left()
    for part in left:
        parts.append(part)
        mirrored = mirror_part(part)
        if hasattr(part, "finger"):
            name, root, d, length = part.finger
            mirrored.finger = (name, Vector((-root.x, root.y, root.z)), Vector((-d.x, d.y, d.z)), length)
        parts.append(mirrored)
    obj, ranges = geo.build_object("QwakkDuck", parts, cell_uv, collection)
    return obj, ranges, parts


def build_beanie(collection=None):
    """Doomer beanie: a slightly tall knit dome over the head plus a folded cuff. Rigid on the Head bone."""
    a, b, c = P.HEAD_RADII
    S = P.BEANIE_SCALE
    zb = P.BEANIE_BOTTOM_Z
    top = c * S * P.BEANIE_DOME + 0.012
    shell = geo.Part("beanie")
    profile = [(0.0, zb - 0.01), (a * S * 0.92, zb - 0.01)]
    for i in range(10):
        z = zb + (top - zb) * i / 9
        r = a * S * math.sqrt(max(0.0, 1 - ((z - zb) / (top - zb)) ** 2 * (1 - (zb / (c * S)) ** 2) - (zb / (c * S)) ** 2))
        profile.append((max(r, 0.0), z))
    profile[-1] = (0.0, top)
    tilt = Matrix.Translation(P.HEAD_CENTER) @ Matrix.Rotation(math.radians(P.BEANIE_TILT_DEG), 4, "X")
    geo.lathe(shell, profile, 12, 28, "beanie", scale=(1.0, b / a), matrix=tilt)

    # cuff: a thick folded band; ribs are vertical grooves on the middle rings only
    cuff = geo.Part("beanie_cuff")
    rz = zb + 0.04
    r_head = a * S * math.sqrt(max(0.0, 1 - (rz / (c * S)) ** 2))
    rc = r_head + 0.014
    segs = 40
    h0, h1 = zb - 0.012, zb + 0.085
    levels = [(rc * 0.95, h0, False), (rc, h0 + 0.012, False), (rc + 0.004, h0 + 0.035, True),
              (rc + 0.004, h1 - 0.03, True), (rc, h1 - 0.01, False), (rc * 0.95, h1, False)]
    rings = []
    for r, z, ribbed in levels:
        ring = []
        for j in range(segs):
            ang = 2 * math.pi * j / segs
            rib = 1.0 + (0.012 * (1 if j % 2 == 0 else -1) if ribbed else 0.0)
            ring.append(tilt @ Vector((math.sin(ang) * r * rib, -math.cos(ang) * r * rib * (b / a), z)))
        rings.append(ring)
    cuff.ring_stack(rings, "beanie_cuff", tilt @ Vector((0, 0, h0)), tilt @ Vector((0, 0, h1)))
    obj, _ = geo.build_object("Acc_Beanie", [shell, cuff], cell_uv, collection)
    return obj
