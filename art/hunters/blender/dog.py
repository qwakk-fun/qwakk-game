"""The hunting dog: a toony retriever in a blaze-orange vest, its own skeleton, LODs and clips (embedded in dog.glb).

Blender axes as everywhere: Z up, the dog faces -Y (glTF +Z), its left is +X. About 1.0 m to the head top,
1.25 m nose to tail tip.
"""

import math
import os

from mathutils import Matrix, Quaternion, Vector

import hbake
import hpose
import human as H
import mesh
from hclips import keys, spring, ss
from hpose import DEG, Pose, foot_matrix
from mesh import L, Part, ellipsoid_xyz, geo, tube

FPS = 30
TAU = 2 * math.pi
Z = (0, 0, 1)
FWD = (0, -1, 0)
FRONT_Y, BACK_Y, LEG_X = -0.18, 0.31, 0.115


def bone_specs():
    specs = [
        ("Root", (0, 0, 0), (0, 0, 0.12), None, FWD),
        ("Hips", (0, 0.30, 0.60), (0, 0.08, 0.62), "Root", Z),
        ("Spine", (0, 0.08, 0.62), (0, -0.14, 0.65), "Hips", Z),
        ("Chest", (0, -0.14, 0.65), (0, -0.26, 0.70), "Spine", Z),
        ("Neck", (0, -0.26, 0.70), (0, -0.36, 0.84), "Chest", Z),
        ("Head", (0, -0.36, 0.84), (0, -0.56, 0.86), "Neck", Z),
        ("Jaw", (0, -0.43, 0.815), (0, -0.60, 0.80), "Head", Z),
        ("HeadTop", (0, -0.38, 1.10), (0, -0.38, 1.16), "Head", FWD),
        ("Tail", (0, 0.40, 0.66), (0, 0.51, 0.77), "Hips", Z),
        ("Tail1", (0, 0.51, 0.77), (0, 0.60, 0.92), "Tail", Z),
        ("FxStars", (0, -0.40, 1.16), (0, -0.40, 1.26), "Root", FWD),
        ("FxPoof", (0, 0, 0), (0, 0, 0.1), "Root", FWD),
    ]
    for s, pre in ((1, "Left"), (-1, "Right")):
        x = LEG_X * s
        specs += [
            (pre + "Ear", (0.085 * s, -0.37, 0.96), (0.125 * s, -0.37, 0.82), "Head", FWD),
            (pre + "FrontLeg", (x, FRONT_Y, 0.56), (x, FRONT_Y, 0.32), "Chest", FWD),
            (pre + "FrontShin", (x, FRONT_Y, 0.32), (x, FRONT_Y, 0.08), pre + "FrontLeg", FWD),
            (pre + "FrontPaw", (x, FRONT_Y, 0.08), (x, FRONT_Y - 0.09, 0.035), pre + "FrontShin", Z),
            (pre + "BackLeg", (x * 0.95, BACK_Y, 0.56), (x * 0.95, BACK_Y - 0.05, 0.33), "Hips", FWD),
            (pre + "BackShin", (x * 0.95, BACK_Y - 0.05, 0.33), (x * 0.95, BACK_Y, 0.08), pre + "BackLeg", FWD),
            (pre + "BackPaw", (x * 0.95, BACK_Y, 0.08), (x * 0.95, BACK_Y - 0.09, 0.035), pre + "BackShin", Z),
        ]
    return specs


CHAINS = {}
for _pre in ("Left", "Right"):
    CHAINS[_pre + "FrontPaw"] = (_pre + "FrontLeg", _pre + "FrontShin", _pre + "FrontPaw", (0, 1, 0))
    CHAINS[_pre + "BackPaw"] = (_pre + "BackLeg", _pre + "BackShin", _pre + "BackPaw", (0, -1, 0))
SPECIAL = ("FxStars", "FxPoof")
STATIC = ("Root", "HeadTop")


# ----------------------------------------------------------------- weights

def _side(co):
    return "Left" if co.x >= 0 else "Right"


def w_body(co):
    keys_ = [("Hips", 0.24), ("Spine", 0.0), ("Chest", -0.20), ("Neck", -0.32)]
    y = co.y
    if y >= keys_[0][1]:
        return {"Hips": 1.0}
    if y <= keys_[-1][1]:
        return {"Neck": 1.0}
    for (a, ya), (b, yb) in zip(keys_, keys_[1:]):
        if yb <= y <= ya:
            t = ss(ya, yb, y)
            return {a: 1 - t, b: t}
    return {"Chest": 1.0}


def w_neck(co):
    t = ss(0.72, 0.86, co.z)
    return {"Chest": (1 - t) * 0.5, "Neck": 0.5, "Head": t * 0.5}


def w_front(co):
    pre = _side(co)
    k = ss(0.30, 0.34, co.z)
    p = ss(0.10, 0.07, co.z)
    w = {pre + "FrontLeg": k, pre + "FrontShin": (1 - k) * (1 - p), pre + "FrontPaw": p * (1 - k)}
    top = ss(0.54, 0.62, co.z)
    if top > 0:
        w = {b: v * (1 - top) for b, v in w.items()}
        w["Chest"] = top
    return w


def w_back(co):
    pre = _side(co)
    k = ss(0.31, 0.35, co.z)
    p = ss(0.10, 0.07, co.z)
    w = {pre + "BackLeg": k, pre + "BackShin": (1 - k) * (1 - p), pre + "BackPaw": p * (1 - k)}
    top = ss(0.56, 0.66, co.z)
    if top > 0:
        w = {b: v * (1 - top) for b, v in w.items()}
        w["Hips"] = top
    return w


def w_tail(co):
    t = ss(0.72, 0.80, co.z)
    return {"Tail": 1 - t, "Tail1": t}


# ----------------------------------------------------------------- mesh


def dog_parts(lod):
    parts = []

    def add(name, w):
        p = Part(name, w)
        parts.append(p)
        return p

    body = add("body", w_body)
    path = [(0, 0.42, 0.625), (0, 0.25, 0.62), (0, 0.02, 0.63), (0, -0.18, 0.665), (0, -0.30, 0.71)]
    tube(body, path, [0.125, 0.16, 0.155, 0.18, 0.145], L(lod, 12, 8, 6), "dog", ry=[0.135, 0.17, 0.16, 0.19, 0.155],
         samples=L(lod, 8, 6, 4), up=(0, 0, 1))
    belly = add("belly", w_body)
    ellipsoid_xyz(belly, (0, -0.10, 0.52), (0.11, 0.18, 0.06), "dog_light", L(lod, 8, 6, 5), L(lod, 5, 4, 3))
    vest = add("vest", w_body)
    tube(vest, [(0, 0.16, 0.63), (0, -0.02, 0.635), (0, -0.19, 0.67)], [0.177, 0.172, 0.195], L(lod, 12, 8, 6),
         ["blaze", "yellow", "blaze"], ry=[0.187, 0.177, 0.207], caps=False, samples=3, up=(0, 0, 1))
    neck = add("neck", w_neck)
    tube(neck, [(0, -0.24, 0.70), (0, -0.39, 0.87)], [0.105, 0.09], L(lod, 8, 6, 5), "dog", caps=False)
    if lod <= 1:
        collar = add("collar", w_neck)
        H.torus(collar, (0, -0.295, 0.765), 0.1, 0.02, "leather", L(lod, 10, 8), 3, tilt_x=-50)
        ellipsoid_xyz(collar, (0, -0.375, 0.715), (0.018, 0.01, 0.022), "brass", 5, 3)
    head = add("head", "Head")
    ellipsoid_xyz(head, (0, -0.40, 0.905), (0.13, 0.135, 0.125), "dog", L(lod, 12, 10, 8), L(lod, 8, 6, 4))
    ellipsoid_xyz(head, (0, -0.535, 0.865), (0.068, 0.11, 0.058), "dog_light", L(lod, 10, 8, 6), L(lod, 6, 4, 3))
    ellipsoid_xyz(head, (0, -0.643, 0.885), (0.036, 0.03, 0.028), "dog_nose", L(lod, 8, 6, 5), L(lod, 5, 4, 3))
    for s in (1, -1):
        n = Vector((0.55 * s, -1.0, 0.25)).normalized()
        c = Vector((0.052 * s, -0.495, 0.94))
        geo.ellipsoid(head, c, (0.03, 0.016, 0.036), geo.frame_from_normal(n), L(lod, 8, 6, 5), L(lod, 4, 4, 3), "eye_white")
        geo.ellipsoid(head, c + n * 0.012 - Vector((0.004 * s, 0, 0.004)), (0.017, 0.01, 0.021), geo.frame_from_normal(n),
                      L(lod, 6, 6, 4), 3, "pupil")
        if lod <= 1:
            tube(head, [c + Vector((-0.02 * s, -0.01, 0.045)), c + Vector((0.03 * s, 0.0, 0.05))], 0.009, 4, "dog_deep",
                 cap_rings=1)
    jaw = add("jaw", "Jaw")
    ellipsoid_xyz(jaw, (0, -0.525, 0.815), (0.056, 0.10, 0.028), "dog_light", L(lod, 8, 6, 5), L(lod, 5, 4, 3))
    if lod <= 1:
        ellipsoid_xyz(jaw, (0, -0.565, 0.838), (0.03, 0.06, 0.012), "tongue", 6, 4)
    for s, pre in ((1, "Left"), (-1, "Right")):
        ear = add("ear", pre + "Ear")
        ellipsoid_xyz(ear, (0.125 * s, -0.37, 0.88), (0.035, 0.07, 0.1), "dog_deep", L(lod, 8, 6, 5), L(lod, 5, 4, 3),
                      rot=Matrix.Rotation(math.radians(12 * s), 3, "Y"))
    front = add("front", w_front)
    back = add("back", w_back)
    for s in (1, -1):
        x = LEG_X * s
        tube(front, [(x, FRONT_Y, 0.60), (x, FRONT_Y, 0.32), (x, FRONT_Y, 0.10)], [0.072, 0.056, 0.05], L(lod, 8, 6, 5),
             "dog", caps=False, samples=L(lod, 5, 4, 3))
        ellipsoid_xyz(front, (x, FRONT_Y - 0.03, 0.042), (0.062, 0.082, 0.042), "dog_light", L(lod, 8, 6, 5), L(lod, 5, 4, 3))
        xb = x * 0.95
        ellipsoid_xyz(back, (xb, BACK_Y - 0.01, 0.53), (0.088, 0.13, 0.14), "dog", L(lod, 8, 6, 5), L(lod, 5, 4, 3))
        tube(back, [(xb, BACK_Y, 0.53), (xb, BACK_Y - 0.05, 0.33), (xb, BACK_Y, 0.10)], [0.07, 0.054, 0.048],
             L(lod, 8, 6, 5), "dog", caps=False, samples=L(lod, 5, 4, 3))
        ellipsoid_xyz(back, (xb, BACK_Y - 0.03, 0.042), (0.06, 0.08, 0.042), "dog_light", L(lod, 8, 6, 5), L(lod, 5, 4, 3))
    tl = add("tail", w_tail)
    tube(tl, [(0, 0.40, 0.66), (0, 0.51, 0.77), (0, 0.60, 0.92)], [0.048, 0.038, 0.024], L(lod, 6, 6, 4),
         ["dog", "dog", "dog_light"], samples=L(lod, 5, 4, 3), cap_rings=1)
    return parts


# ----------------------------------------------------------------- clips

GAIT = dict(speed=4.5, cycle=12 / FPS, stance=0.32, lift=0.12, drop=0.045)
PHASE = {"LeftFrontPaw": 0.0, "RightFrontPaw": 0.10, "LeftBackPaw": 0.52, "RightBackPaw": 0.62}


class Ctx:
    def __init__(self, sk):
        self.sk = sk
        self.paw = {e: sk.head[e].copy() for e in PHASE}


def pole(end):
    s = 1 if end.startswith("Left") else -1
    return Vector((0.15 * s, 1.0, 0)) if "Front" in end else Vector((0.15 * s, -1.0, 0))


def plant(pose, ctx, offsets=None):
    for end in PHASE:
        a = ctx.paw[end] + Vector((0, -(offsets or {}).get(end, 0.0), 0))
        pose.ik[end] = (foot_matrix(ctx.sk, end, a), pole(end), "leg")


def ears(pose, flop):
    pose.side("Left", "Ear", rx=flop * 0.6, ry=flop)
    pose.side("Right", "Ear", rx=flop * 0.6, ry=flop)


def idle(ctx, t):
    ph = t / 2.0
    pose = Pose()
    br = math.sin(TAU * ph * 2)
    pose.hips = Vector((0, 0, -0.02 + 0.004 * br))
    pose.add("Spine", rx=1.0 * br)
    plant(pose, ctx)
    look = math.sin(TAU * ph + 0.5)
    pose.add("Neck", rz=10 * look, rx=-4)
    pose.add("Head", ry=8 * math.sin(TAU * ph + 1.0), rx=3)
    pose.add("Jaw", rx=10 + 5 * math.sin(TAU * ph * 8))
    pose.add("Tail", rx=-25, rz=28 * math.sin(TAU * ph * 5))
    pose.add("Tail1", rz=18 * math.sin(TAU * ph * 5 - 0.8))
    ears(pose, 4 * math.sin(TAU * ph * 2 + 0.4))
    return pose


def run(ctx, t):
    g = GAIT
    ph = (t / g["cycle"]) % 1.0
    s = g["stance"]
    L_ = g["speed"] * g["cycle"] * s
    pose = Pose()
    flex = math.sin(TAU * ph)
    pose.hips = Vector((0, 0, -g["drop"] + 0.03 * math.sin(TAU * (ph - 0.25))))
    pose.add("Hips", rx=7 * flex)
    pose.add("Spine", rx=-5 * flex)
    pose.add("Chest", rx=-4 * flex)
    pose.add("Neck", rx=6 * flex - 8)
    pose.add("Head", rx=-4 * flex + 6)
    pose.add("Jaw", rx=16 + 4 * math.sin(TAU * 2 * ph))
    pose.add("Tail", rx=-50 + 8 * flex, rz=6 * math.sin(TAU * ph))
    pose.add("Tail1", rx=-10)
    ears(pose, -25 + 15 * math.sin(TAU * (ph - 0.2)))
    for end, off in PHASE.items():
        u = (ph - off) % 1.0
        base = ctx.paw[end]
        if u < s:
            k = u / s
            along, lift, pitch = L_ * (0.5 - k), 0.0, 25 * ss(0.6, 1.0, k)
        else:
            k = (u - s) / (1 - s)
            e = k * k * k * (k * (6 * k - 15) + 10)
            along = L_ * (-0.5 + e)
            lift = g["lift"] * math.sin(math.pi * k)
            pitch = 40 * (1 - ss(0.0, 0.6, k))
        pos = base + Vector((0, -along, lift))
        pose.ik[end] = (foot_matrix(ctx.sk, end, pos, pitch), pole(end), "leg")
    return pose


BITE_EVENTS = {"bite": 0.32}


def bite(ctx, t):
    pose = Pose()
    crouch = keys(t, [(0, 0), (0.18, 1), (0.30, -1), (0.42, -0.6), (0.6, 0)])
    lunge = max(0.0, -crouch)
    pose.hips = Vector((0, -0.22 * lunge + 0.04 * max(crouch, 0), -0.08 * max(crouch, 0) + 0.03 * lunge))
    pose.add("Hips", rx=-6 * max(crouch, 0) + 4 * lunge)
    pose.add("Spine", rx=6 * max(crouch, 0) - 6 * lunge)
    pose.add("Neck", rx=10 * max(crouch, 0) - 22 * lunge)
    pose.add("Head", rx=6 * lunge)
    jaw = keys(t, [(0, 8), (0.20, 40), (0.30, 44), (0.33, 0), (0.42, 4), (0.6, 8)])
    pose.add("Jaw", rx=jaw)
    pose.add("Tail", rx=-35 - 15 * lunge)
    ears(pose, -20 * lunge + 8 * max(crouch, 0))
    plant(pose, ctx, {"LeftFrontPaw": 0.18 * lunge, "RightFrontPaw": 0.14 * lunge})
    return pose


def hit(ctx, t):
    k = keys(t, [(0, 0), (0.05, 1), (0.35, 0)]) + spring(t, 0.25, 0.1, 3.0, 10)
    pose = Pose()
    pose.hips = Vector((0.03 * k, 0.05 * k, -0.03 * k))
    pose.add("Hips", ry=-6 * k)
    pose.add("Spine", rz=10 * k)
    pose.add("Neck", rx=-18 * k, rz=-12 * k)
    pose.add("Head", rx=-10 * k)
    pose.add("Jaw", rx=10 + 20 * k)
    pose.add("Tail", rx=20 * k)
    ears(pose, -35 * k)
    plant(pose, ctx)
    return pose


DEFEAT_LIE, DEFEAT_STARS = 0.55, 0.85


def _belly_up(pose, t, legs=1.0):
    tw = math.sin(TAU * t / 1.2)
    pose.hips = Vector((0, -0.02, -(0.60 - 0.21)))
    pose.add("Hips", ry=172)
    pose.add("Neck", rx=48, rz=18)        # upside down, a forward nod lifts the head off the ground
    pose.add("Head", rx=22, rz=15)
    pose.add("Jaw", rx=28)
    pose.add("Tail", rx=-20, rz=30)
    for side, f in (("Left", 1), ("Right", -1)):
        pose.side(side, "FrontLeg", rx=-25 * legs + 4 * tw * f, ry=8)
        pose.side(side, "FrontShin", rx=-40 * legs)
        pose.side(side, "BackLeg", rx=20 * legs - 4 * tw * f, ry=10)
        pose.side(side, "BackShin", rx=25 * legs)
    ears(pose, 60)


def _stars(ctx, t, t0):
    def fn(M):
        head = M["Head"] @ (ctx.sk.rest["Head"].inverted() @ Vector((0, -0.42, 0.90)))
        m = (Quaternion((0, 0, 1), 120 * DEG * (t - t0)).to_matrix() @ ctx.sk.rest["FxStars"].to_3x3()).to_4x4()
        m.translation = head + Vector((0, 0, 0.24 + 0.02 * math.sin(TAU * t / 0.6)))
        return m
    return fn


def defeat(ctx, t):
    pose = Pose()
    if t < DEFEAT_LIE:
        hop = math.sin(math.pi * min(1.0, t / DEFEAT_LIE))
        roll = 172 * ss(0.08, DEFEAT_LIE, t)
        pose.hips = Vector((0, -0.02 * ss(0, DEFEAT_LIE, t), 0.25 * hop - 0.39 * ss(0.25, DEFEAT_LIE, t)))
        pose.add("Hips", ry=roll)
        pose.add("Jaw", rx=28 * ss(0, 0.3, t))
        pose.add("Neck", rx=48 * ss(0.15, DEFEAT_LIE, t), rz=18 * ss(0.15, DEFEAT_LIE, t))
        pose.add("Head", rx=22 * ss(0.15, DEFEAT_LIE, t))
        legs = ss(0.1, DEFEAT_LIE, t)
        for side in ("Left", "Right"):
            pose.side(side, "FrontLeg", rx=-25 * legs, ry=8 * legs)
            pose.side(side, "FrontShin", rx=-40 * legs)
            pose.side(side, "BackLeg", rx=20 * legs, ry=10 * legs)
            pose.side(side, "BackShin", rx=25 * legs)
        ears(pose, 60 * legs)
    else:
        kick = keys(t, [(DEFEAT_LIE, 1.0), (0.7, 1.4), (0.95, 0.9), (1.2, 1.0)])
        _belly_up(pose, t, kick)
        pose.hips = pose.hips + Vector((0, 0, spring(t, DEFEAT_LIE, 0.05, 3.0, 8)))
    if t >= DEFEAT_STARS:
        pose.world["FxStars"] = _stars(ctx, t, DEFEAT_STARS)
        pose.scale["FxStars"] = keys(t, [(DEFEAT_STARS, 0.0), (1.0, 1.15), (1.15, 1.0)])
    else:
        pose.scale["FxStars"] = 0.0
    pm = ctx.sk.rest["FxPoof"].copy()
    pm.translation = Vector((0, -0.05, 0))
    pose.world["FxPoof"] = pm
    pose.scale["FxPoof"] = keys(t, [(DEFEAT_LIE - 0.04, 0.0), (0.7, 0.95), (0.95, 0.8), (1.2, 0.0)])
    return pose


def defeat_dizzy(ctx, t):
    pose = Pose()
    _belly_up(pose, t)
    pose.world["FxStars"] = _stars(ctx, t, 0.0)
    pose.scale["FxStars"] = 1.0
    return pose


def registry():
    return {
        "Idle": (idle, 60, True, "full", ()),
        "Run": (run, round(GAIT["cycle"] * FPS), True, "full", ()),
        "Bite": (bite, 18, False, "full", ()),
        "Hit": (hit, 11, False, "full", ()),
        "Defeat": (defeat, 45, False, "full", ("FxStars", "FxPoof")),
        "Defeat_Dizzy": (defeat_dizzy, 36, True, "full", ("FxStars",)),
    }


EVENTS = {"Bite": BITE_EVENTS, "Defeat": {"ground": DEFEAT_LIE, "stars": DEFEAT_STARS}}


# ----------------------------------------------------------------- build and export


class Dog:
    def __init__(self, material):
        self.rig, self.bones = _armature("Rig_dog")
        self.lods, self.spans = [], None
        for lod in range(3):
            obj, spans = mesh.build_object(f"dog_LOD{lod}", dog_parts(lod))
            mesh.skin(obj, self.rig, spans, self.bones)
            obj.data.materials.append(material)
            self.lods.append(obj)
            self.spans = self.spans or spans
        self.sk = hpose.Skeleton(self.rig, CHAINS)
        self.ctx = Ctx(self.sk)


def _armature(name):
    from hrig import build_armature
    return build_armature(name, bone_specs())


def measure(d):
    """Head sphere and a horizontal body capsule (along the dog's forward axis), standing and running."""
    import measure as ms
    out = {}
    reg = registry()
    for pname, (clip, t) in (("stand", ("Idle", 0.0)), ("run", ("Run", 0.1))):
        ms.apply(d.rig, d.sk, reg[clip][0](d.ctx, t))
        pts = ms.positions(d.lods[0])
        hd = ms.pick(pts, d.spans, {"head"})
        c = sum(hd, Vector()) / len(hd)
        hr = ms.pct([(p - c).length for p in hd], 0.8)
        body = ms.pick(pts, d.spans, {"body", "vest"})
        ys = [p.y for p in body]
        axis_z = sum(p.z for p in body) / len(body)
        r = ms.pct([math.hypot(p.x, p.z - axis_z) for p in body], 0.9)
        out[pname] = {"headY": round(c.z, 3), "headZ": round(-c.y, 3), "headR": round(hr, 3),
                      "bodyY": round(axis_z, 3), "bodyZ0": round(-(max(ys) - r), 3), "bodyZ1": round(-(min(ys) + r), 3),
                      "bodyR": round(r, 3)}
        if pname == "stand":
            out["height"] = round(max(p.z for p in pts), 3)
            out["length"] = round(max(p.y for p in pts) - min(p.y for p in pts), 3)
    ms.reset(d.rig)
    return out


def build_and_export(material, path):
    d = Dog(material)
    reg = registry()
    info = {"clips": hbake.bake_all(d.rig, d.sk, d.ctx, reg, SPECIAL, STATIC, upper_root="Chest")}
    hbake.export_renamed(path, [(d.rig, "DogRig")] + [(o, f"LOD{k}") for k, o in enumerate(d.lods)], animations=True)
    hbake.postprocess(path, hidden=("FxStars", "FxPoof"),
                      rules=hbake.track_rules(d.sk, reg, SPECIAL, STATIC, upper_root="Chest"))
    hbake.drop_actions(d.rig)
    info["triangles"] = [mesh.triangle_count(o) for o in d.lods]
    info["glb_bytes"] = os.path.getsize(path)
    hb = measure(d)
    clips = {n: {"seconds": round(f / FPS, 3), "loop": lp} for n, (_fn, f, lp, _l, _e) in reg.items()}
    clips["Run"]["authoredSpeed"] = GAIT["speed"]
    for n, ev in EVENTS.items():
        clips[n]["events"] = ev
    info["manifest"] = {"file": "dog.glb", "triangles": info["triangles"], "glbBytes": info["glb_bytes"],
                        "clips": clips, "hitbox": {k: v for k, v in hb.items() if isinstance(v, dict)},
                        "height": hb["height"], "length": hb["length"]}
    info["obj"] = d
    return info
