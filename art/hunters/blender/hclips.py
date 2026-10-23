"""Every hunter clip as code on the shared hunter rig (the boss plays the same clips under its Root scale).

Each clip is a function of time returning a hpose.Pose. Locomotion uses foot IK on a gait cycle, so the feet
stay planted when the clip plays at its authored speed (timeScale = speed / authored speed). No root motion:
the Hips stay over the origin and only bob, sway and turn. The gun rides WeaponSocket on the right hand;
both hands are placed on it by IK, so it is always held the same way whichever gun the look carries.
"""

import math

from mathutils import Matrix, Quaternion, Vector

import hp
from hpose import DEG, Pose, foot_matrix, frame

FPS = 30
TAU = 2 * math.pi
FULL, UPPER = "full", "upper"

CHAINS = {
    "LeftHand": ("LeftArm", "LeftForeArm", "LeftHand", (0, 1, 0)),
    "RightHand": ("RightArm", "RightForeArm", "RightHand", (0, 1, 0)),
    "LeftFoot": ("LeftUpLeg", "LeftLeg", "LeftFoot", (0, -1, 0)),
    "RightFoot": ("RightUpLeg", "RightLeg", "RightFoot", (0, -1, 0)),
}
# Bones that only move in the clips that need them (their tracks exist only there; elsewhere the engine
# keeps the model's own node transform: the hat on the head, the effects at scale 0).
SPECIAL = ("Hat", "FxStars", "FxPoof", "Whistle", "LeftHandProp")
STATIC = ("Root", "HeadTop", "WeaponSocket", "Muzzle")


# ----------------------------------------------------------------- helpers


def ss(e0, e1, x):
    if e0 == e1:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def keys(t, pts):
    if t <= pts[0][0]:
        return pts[0][1]
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t <= t1:
            return lerp(v0, v1, ss(t0, t1, t))
    return pts[-1][1]


def vkeys(t, pts):
    """keys() for vectors."""
    if t <= pts[0][0]:
        return Vector(pts[0][1])
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t <= t1:
            return Vector(v0).lerp(Vector(v1), ss(t0, t1, t))
    return Vector(pts[-1][1])


def spring(t, start, amp, freq=3.0, damp=6.0):
    if t < start:
        return 0.0
    x = t - start
    return amp * math.exp(-damp * x) * math.sin(TAU * freq * x)


def blend_m(a, b, k):
    """Matrix blend: lerp translation, slerp rotation."""
    if k <= 0:
        return a.copy()
    if k >= 1:
        return b.copy()
    qa, qb = a.to_quaternion(), b.to_quaternion()
    m = qa.slerp(qb, k).to_matrix().to_4x4()
    m.translation = a.to_translation().lerp(b.to_translation(), k)
    return m


class Ctx:
    """Rest data the clips need."""

    def __init__(self, sk):
        self.sk = sk
        self.ankle = {s: sk.head[s + "Foot"].copy() for s in ("Left", "Right")}
        self.sock_rel = sk.rest["RightHand"].inverted() @ sk.rest["WeaponSocket"]
        self.sock_rel_inv = self.sock_rel.inverted()
        # left fist center in LeftHand bone space, and the support grip in socket space
        self.lfist = sk.rest["LeftHand"].inverted() @ sk.head["LeftHandProp"]
        # LeftHand bone axes in socket space (columns): X (thumb) along the barrel, Y (fingers) to the gun's
        # right, Z (back of the hand) down, so the palm cups the forend from below.
        rot = Matrix(((0, 1, 0), (1, 0, 0), (0, 0, -1)))
        sup = rot.to_4x4()
        sup.translation = Vector((0.0, hp.SUPPORT_Y, -0.012)) - rot @ self.lfist
        self.support = sup
        self.rest_spine2 = sk.rest["Spine2"].copy()


def chest_gun(ctx, Gc):
    """A gun frame given in rest character space that follows the chest (Spine2)."""
    inv = ctx.rest_spine2.inverted()
    return lambda M: M["Spine2"] @ inv @ Gc


def hold(pose, ctx, gun, left=True, right=True, pole_r=(-1.0, 0.3, -0.7), pole_l=(0.4, 0.2, -1.0), left_override=None):
    """Both hands on the gun. `gun` is a world matrix or a callable(M) -> world matrix (socket frame)."""
    g = gun if callable(gun) else (lambda M: gun)
    if right:
        pose.ik["RightHand"] = lambda M: (g(M) @ ctx.sock_rel_inv, pole_r, "arm")
    if left:
        if left_override is not None:
            pose.ik["LeftHand"] = left_override
        else:
            pose.ik["LeftHand"] = lambda M: (g(M) @ ctx.support, pole_l, "arm")
    pose.curl("RightHandFingers", -85)
    pose.curl("LeftHandFingers", -80 if left else -30)


def knee_pole(sgn):
    return Vector((sgn * 0.2, -1.0, 0.0))


def plant(pose, ctx, offsets=None, drop=0.0, yaw=None):
    """Feet planted at their rest spots plus (x out, y forward) offsets."""
    for side, sgn in (("Left", 1), ("Right", -1)):
        ox, oy = (offsets or {}).get(side, (0.0, 0.0))
        a = ctx.ankle[side] + Vector((sgn * ox, -oy, 0))
        pose.ik[side + "Foot"] = (foot_matrix(ctx.sk, side + "Foot", a, 0.0, (yaw or {}).get(side, 0.0)), knee_pole(sgn), "leg")
    pose.hips = Vector((0, 0, -drop))


# ----------------------------------------------------------------- the carry and the aim

CARRY = frame((-0.17, -0.17, 1.04), (0.42, -0.88, 0.10), (-0.1, 0.05, 1.0))
AIM_FIST = Vector((-0.085, -0.25, 1.305))
AIM_PIVOT = Vector((-0.06, 0.02, 1.27))
AIM_TWIST = (-12, -10, -8)          # Spine, Spine1, Spine2 (rz): the left shoulder comes forward


def aim_gun(pitch=0.0, back=0.0, kick=0.0):
    """The shouldered aim, pitched about AIM_PIVOT (degrees, up > 0); `back` pulls it toward the shoulder."""
    rot = Matrix.Rotation(math.radians(-(pitch + kick)), 3, "X")     # +X rotation tips -Y down, so negate
    p = AIM_PIVOT + rot @ (AIM_FIST + Vector((0, back, 0)) - AIM_PIVOT)
    return frame(p, rot @ Vector((0, -1, 0)), rot @ Vector((0, 0, 1)))


def aim_spine(pose, pitch, breathe=0.0):
    tw = AIM_TWIST
    pose.add("Spine", rx=-pitch * 0.22 + 2, rz=tw[0])
    pose.add("Spine1", rx=-pitch * 0.22 + 1.2 * breathe, rz=tw[1])
    pose.add("Spine2", rx=-pitch * 0.18 + 0.6 * breathe, rz=tw[2])
    pose.add("Neck", rx=-pitch * 0.2 + 4, rz=14, ry=-4)
    pose.add("Head", rx=-pitch * 0.25 + 4, rz=15, ry=-6)


def carry_upper(pose, ctx, breathe=0.0, look=0.0, gun=None):
    pose.add("Spine1", rx=1.5 * breathe)
    pose.add("Spine2", rx=0.8 * breathe)
    pose.add("Neck", rx=-1.0 * breathe, rz=6 * look)
    pose.add("Head", ry=2 * look)
    hold(pose, ctx, chest_gun(ctx, gun or CARRY))


# ----------------------------------------------------------------- idle and locomotion


def idle(ctx, t):
    T = 2.4
    ph = t / T
    breathe = math.sin(TAU * ph * 2)
    shift = math.sin(TAU * ph)
    pose = Pose()
    plant(pose, ctx, {"Left": (0.03, 0.04), "Right": (0.04, -0.05)}, drop=0.025 + 0.006 * (1 + breathe) * 0.5,
          yaw={"Left": 6, "Right": -10})
    pose.loc["Hips"] += Vector((0.012 * shift, 0, 0))
    pose.add("Hips", ry=1.8 * shift)
    pose.add("Spine", ry=-1.2 * shift)
    carry_upper(pose, ctx, breathe, math.sin(TAU * ph + 0.6))
    return pose


GAITS = {
    "walk": dict(speed=1.4, cycle=24 / FPS, stance=0.58, lift=0.09, bob=0.025, drop=0.065, lean=5, roll=3, sway=0.02,
                 yaw=7, heel=16, toe=20),
    "run": dict(speed=3.6, cycle=18 / FPS, stance=0.36, lift=0.16, bob=0.04, drop=0.09, lean=14, roll=3, sway=0.014,
                yaw=10, heel=10, toe=32),
}


def gait_pose(ctx, ph, g):
    pose = Pose()
    s = g["stance"]
    Lh = g["speed"] * g["cycle"] * s
    bob = -g["bob"] * 0.5 * (1 + math.cos(TAU * 2 * (ph - s * 0.5)))
    side_wave = math.cos(TAU * (ph - s * 0.5))
    pose.hips = Vector((g["sway"] * side_wave, 0.0, bob - g["drop"]))
    pose.add("Hips", rx=g["lean"] * 0.4, ry=g["roll"] * side_wave, rz=-g["yaw"] * math.cos(TAU * ph))
    pose.add("Spine", rx=g["lean"] * 0.4)
    pose.add("Spine1", rx=g["lean"] * 0.2, rz=g["yaw"] * 0.7 * math.cos(TAU * (ph - 0.06)))
    pose.add("Neck", rx=-g["lean"] * 0.6)
    pose.add("Head", rx=-g["lean"] * 0.3 + 2 * math.cos(TAU * 2 * (ph - s * 0.5 - 0.12)))
    for side, sgn, off in (("Left", 1, 0.0), ("Right", -1, 0.5)):
        u = (ph - off) % 1.0
        base = ctx.ankle[side] + Vector((sgn * 0.01, 0, 0))
        if u < s:
            k = u / s
            along = Lh * (0.5 - k)
            lift = 0.0
            pitch = -g["heel"] * (1 - ss(0.0, 0.3, k)) + g["toe"] * ss(0.55, 1.0, k)
        else:
            k = (u - s) / (1 - s)
            e = k * k * k * (k * (6 * k - 15) + 10)
            along = Lh * (-0.5 + e)
            lift = g["lift"] * math.sin(math.pi * k) ** 0.9
            pitch = g["toe"] * (1 - ss(0.0, 0.45, k)) - g["heel"] * ss(0.55, 1.0, k)
        pos = base + Vector((0, -along, lift))
        pivot = pos + (Vector((0, -0.12, -0.085)) if pitch > 0 else Vector((0, 0.07, -0.085)))
        r = Matrix.Rotation(pitch * DEG, 3, "X")
        ankle = pivot + r @ (pos - pivot)
        pose.ik[side + "Foot"] = (foot_matrix(ctx.sk, side + "Foot", ankle, pitch), knee_pole(sgn), "leg")
    bounce = math.sin(TAU * 2 * (ph - 0.1))
    gun = CARRY if g["speed"] < 2 else frame((-0.16, -0.19, 1.10), (0.5, -0.8, 0.3), (-0.2, 0.1, 1.0))
    gun = Matrix.Translation((0, 0, 0.008 * bounce)) @ gun
    carry_upper(pose, ctx, 0.0, 0.0, gun)
    return pose


def gait_clip(kind):
    g = GAITS[kind]
    frames = round(g["cycle"] * FPS)
    return (lambda ctx, t: gait_pose(ctx, (t * FPS / frames) % 1.0, g)), frames


# ----------------------------------------------------------------- aiming and shooting


def aim(pitch):
    def fn(ctx, t):
        ph = t / 2.0
        breathe = math.sin(TAU * ph)
        pose = Pose()
        plant(pose, ctx, {"Left": (0.02, 0.12), "Right": (0.06, -0.10)}, drop=0.04, yaw={"Left": -8, "Right": -24})
        aim_spine(pose, pitch, breathe)
        hold(pose, ctx, Matrix.Translation((0, 0, 0.004 * breathe)) @ aim_gun(pitch))
        return pose
    return fn


def fire(ctx, t):
    k = keys(t, [(0, 0), (0.035, 1), (0.30, 0)]) + spring(t, 0.12, 0.12, 4.0, 10)
    pose = aim(0.0)(ctx, 0.0)
    pose.add("Spine2", rx=-3 * k)
    pose.add("Head", rx=-2 * k)
    hold(pose, ctx, aim_gun(0.0, back=0.05 * k, kick=7 * k))
    return pose


RELOAD_SECONDS = 1.8
RELOAD_EVENTS = {"shellIn": 1.0, "ready": 1.45}


def reload(ctx, t):
    """Gun tips up to the chest, left hand fetches a shell from the right hip pouch, loads it, back to the aim."""
    down = keys(t, [(0, 0), (0.28, 1), (1.40, 1), (1.75, 0)])
    pose = Pose()
    plant(pose, ctx, {"Left": (0.02, 0.12), "Right": (0.06, -0.10)}, drop=0.04, yaw={"Left": -8, "Right": -24})
    aim_spine(pose, 0.0)
    pose.add("Spine1", rx=6 * down)
    pose.add("Neck", rx=10 * down, rz=-8 * down)
    pose.add("Head", rx=10 * down)
    load = frame((-0.14, -0.20, 1.13), (0.25, -0.75, 0.62), (-0.55, 0.2, 0.8))
    pump = keys(t, [(1.18, 0), (1.26, 1), (1.36, 0)])
    G = blend_m(aim_gun(0.0), load, down)
    G = G @ Matrix.Translation((0, -0.025 * pump, 0))

    def left(M):
        sup = G @ ctx.support
        pouch = frame((-0.24, -0.06, 1.00), (-0.2, -0.3, -0.95), (0.9, 0.1, 0.0))
        port = G @ Matrix.Translation((0.06, 0.07, 0.07)) @ frame((0, 0, 0), (-0.9, 0.2, -0.3), (0, 0.4, -1.0))
        push = 0.02 * math.sin(TAU * 4 * max(0.0, t - 0.92)) if 0.92 < t < 1.17 else 0.0
        if t < 0.30:
            m = sup
        elif t < 0.58:
            m = blend_m(sup, pouch, ss(0.30, 0.58, t))
        elif t < 0.72:
            m = pouch
        elif t < 0.92:
            m = blend_m(pouch, port, ss(0.72, 0.92, t))
        elif t < 1.17:
            m = port @ Matrix.Translation((0, push, 0))
        else:
            m = blend_m(port, sup, ss(1.17, 1.30, t))
        return (m, (0.4, 0.2, -1.0), "arm")

    hold(pose, ctx, G, left_override=left)
    pose.curl("LeftHandFingers", 30 if 0.4 < t < 1.25 else 0)
    return pose


THROW_EVENTS = {"pick": 0.25, "release": 0.70}


def throw(ctx, t):
    """One-handed gun low, the left hand pulls a decoy from the hip bag and lobs it overhand."""
    pose = Pose()
    plant(pose, ctx, {"Left": (0.03, 0.10), "Right": (0.05, -0.08)}, drop=0.04)
    wind = keys(t, [(0.2, 0), (0.5, 1), (0.66, -1), (0.95, -0.3), (1.2, 0)])
    pose.add("Spine", rz=14 * wind, rx=-3 * max(wind, 0) + 6 * max(-wind, 0))
    pose.add("Spine1", rz=10 * wind, rx=4 * max(-wind, 0))
    pose.add("Spine2", rz=6 * wind)
    pose.add("Neck", rz=-16 * wind, rx=-4)
    pose.add("Head", rz=-8 * wind)
    one_hand = frame((-0.22, -0.12, 0.98), (0.12, -0.75, -0.65), (-0.3, -0.6, 0.6))
    gk = keys(t, [(0, 0), (0.2, 1), (1.0, 1), (1.2, 0)])
    G = chest_gun(ctx, blend_m(CARRY, one_hand, gk))
    hand_pts = [
        (0.20, frame((0.30, -0.02, 1.07), (0.1, -0.2, -1.0), (1, 0, 0))),        # in the bag
        (0.30, frame((0.30, 0.0, 1.10), (0.1, -0.3, -0.95), (1, 0, 0))),
        (0.52, frame((0.32, 0.30, 1.42), (0.0, 0.5, 0.85), (0, -0.9, 0.4))),     # wound up behind the shoulder
        (0.70, frame((0.20, -0.42, 1.58), (0.0, -0.9, 0.4), (0, -0.4, -0.9))),   # release, high in front
        (0.85, frame((0.10, -0.48, 1.22), (-0.1, -0.7, -0.7), (0, 0.7, -0.7))),  # follow through
    ]
    def left(M):
        sup = G(M) @ ctx.support
        if t < 0.20:
            m = blend_m(sup, hand_pts[0][1], ss(0.0, 0.20, t))
        elif t >= 0.85:
            m = blend_m(hand_pts[-1][1], sup, ss(0.85, 1.15, t))
        else:
            for (t0, m0), (t1, m1) in zip(hand_pts, hand_pts[1:]):
                if t0 <= t <= t1:
                    m = blend_m(m0, m1, ss(t0, t1, t) if t1 - t0 > 0.16 else (t - t0) / (t1 - t0))
                    break
        return (m, (0.6, 0.6, -0.8), "arm")

    hold(pose, ctx, G, left_override=left)
    pose.curl("LeftHandFingers", -55 if 0.25 <= t < 0.70 else -15)
    pose.scale["LeftHandProp"] = 1.0 if THROW_EVENTS["pick"] <= t < THROW_EVENTS["release"] else 0.0
    return pose


# ----------------------------------------------------------------- hit, defeat, taunt, whistle


def hit(ctx, t):
    k = keys(t, [(0, 0), (0.06, 1), (0.40, 0)]) + spring(t, 0.3, 0.1, 3.0, 10)
    pose = Pose()
    plant(pose, ctx, {"Left": (0.03, 0.04), "Right": (0.04, -0.05)}, drop=0.03 + 0.03 * k)
    pose.loc["Hips"] += Vector((0, 0.04 * k, 0))
    pose.add("Hips", rx=-5 * k)
    pose.add("Spine", rx=-9 * k, ry=5 * k)
    pose.add("Spine1", rx=-6 * k, rz=-7 * k)
    pose.add("Neck", rx=-12 * k, rz=6 * k)
    pose.add("Head", rx=-10 * k, ry=-6 * k)
    hold(pose, ctx, chest_gun(ctx, Matrix.Translation((0, 0.04 * k, 0.06 * k)) @ CARRY))
    return pose


HAT_REST = Vector(hp.HAT_PIVOT)
DEFEAT_LIE = 0.62           # the back hits the ground
DEFEAT_STARS = 0.95


def _hat_flight(ctx, t):
    """The hat pops off at t = 0 and lands in front, after two flips (world matrix of the Hat bone)."""
    vz, vy, vx, g = 2.6, -0.42, 0.16, 9.8
    z0 = HAT_REST.z
    t_land = (vz + math.sqrt(vz * vz + 2 * g * (z0 - 0.04))) / g
    tt = min(t, t_land)
    pos = HAT_REST + Vector((vx * tt, vy * tt, vz * tt - 0.5 * g * tt * tt))
    spin = -720.0 * ss(0.0, t_land, tt) ** 0.85
    if t > t_land:                     # a small hop and a wobble where it lands
        h = t - t_land
        pos.z += max(0.0, 0.07 * math.sin(math.pi * min(1.0, h / 0.18))) if h < 0.18 else 0.0
        pos.x += 0.03 * ss(0, 0.2, h)
        spin += spring(t, t_land, 14, 3.0, 7)
    rot = Quaternion((1, 0, 0), spin * DEG) @ Quaternion((0, 0, 1), 25 * DEG * ss(0, t_land, tt))
    m = (rot.to_matrix() @ ctx.sk.rest["Hat"].to_3x3()).to_4x4()
    m.translation = pos
    return m


def _lying(pose, ctx, t, legs=1.0):
    """The final pose on the back: legs up in the air, arms out, head lifted a little."""
    tw = math.sin(TAU * t / 1.2)
    pose.hips = Vector((0, 0.34, -(hp.HIPS_Z - 0.19)))
    pose.add("Hips", rx=-88)
    pose.add("Spine", rx=4)
    pose.add("Neck", rx=14)
    pose.add("Head", rx=6, rz=18)
    pose.side("Left", "UpLeg", rx=-62 * legs - 3 * tw, rz=-8)
    pose.side("Left", "Leg", rx=14)
    pose.side("Left", "Foot", rx=-20)
    pose.side("Right", "UpLeg", rx=-38 * legs + 3 * tw, rz=6)
    pose.side("Right", "Leg", rx=48 + 6 * tw)
    pose.side("Right", "Foot", rx=-10)
    pose.side("Left", "Arm", ry=10, rx=-25)
    pose.side("Left", "ForeArm", rz=-35)
    pose.side("Right", "Arm", ry=20, rx=-15)
    pose.side("Right", "ForeArm", rz=-20)
    pose.curl("LeftHandFingers", -20)
    pose.curl("RightHandFingers", -85)


def _stars(ctx, t, t0, pop=True):
    def fn(M):
        head = M["Head"] @ (ctx.sk.rest["Head"].inverted() @ Vector(hp.HEAD_CENTER))
        pos = head + Vector((0, 0, 0.26 + 0.025 * math.sin(TAU * t / 0.6)))
        spin = 120.0 * (t - t0)
        rot = Quaternion((0, 0, 1), spin * DEG)
        m = (rot.to_matrix() @ ctx.sk.rest["FxStars"].to_3x3()).to_4x4()
        m.translation = pos
        return m
    return fn


def defeat(ctx, t):
    """Toony defeat: a jolt, the hat pops off, a stiff plank fall onto the back, a dust poof, legs kick up,
    then dizzy stars. Hold the last frame or continue with Defeat_Dizzy."""
    pose = Pose()
    fall = ss(0.10, DEFEAT_LIE, t) ** 1.6
    jolt = keys(t, [(0, 0), (0.07, 1), (0.16, 0)])
    bounce = spring(t, DEFEAT_LIE, 0.05, 3.0, 8)
    if t < DEFEAT_LIE + 0.02:
        a = -88 * fall
        lie = Vector((0, 0.34, -(hp.HIPS_Z - 0.19)))
        pose.hips = Vector((0, lie.y * fall, lie.z * fall ** 1.3 + 0.06 * jolt))
        pose.add("Hips", rx=a)
        pose.add("Spine", rx=-10 * jolt + 4 * fall)
        pose.add("Neck", rx=-14 * jolt + 10 * fall)
        pose.add("Head", rx=-10 * jolt + 6 * fall, rz=18 * fall)
        flail = math.sin(TAU * 3.0 * t)
        pose.side("Left", "Arm", ry=lerp(60, 10, ss(0.0, 0.3, t)) + 12 * flail, rx=-25 * fall)
        pose.side("Right", "Arm", ry=lerp(60, 20, ss(0.0, 0.3, t)) - 12 * flail, rx=-15 * fall)
        pose.side("Left", "ForeArm", rz=-20 - 15 * fall)
        pose.side("Right", "ForeArm", rz=-20)
        pose.both("UpLeg", rx=-10 * fall)
        pose.curl("LeftHandFingers", -20)
        pose.curl("RightHandFingers", -85)
    else:
        kick = keys(t, [(DEFEAT_LIE, 0.2), (0.80, 1.35), (1.10, 0.9), (1.4, 1.0)])
        _lying(pose, ctx, t, legs=kick)
        pose.hips = pose.hips + Vector((0, 0, bounce))
    pose.world["Hat"] = _hat_flight(ctx, t)
    if t >= DEFEAT_STARS:
        pose.world["FxStars"] = _stars(ctx, t, DEFEAT_STARS)
        pose.scale["FxStars"] = keys(t, [(DEFEAT_STARS, 0.0), (1.10, 1.18), (1.25, 1.0)])
    else:
        pose.scale["FxStars"] = 0.0
    poof = keys(t, [(DEFEAT_LIE - 0.04, 0.0), (0.78, 1.25), (1.05, 1.0), (1.30, 0.0)])
    pm = ctx.sk.rest["FxPoof"].copy()
    pm.translation = Vector((0, 0.36, 0.0))
    pose.world["FxPoof"] = pm @ Matrix.Rotation(30 * DEG * ss(DEFEAT_LIE, 1.3, t), 4, "Y")
    pose.scale["FxPoof"] = poof
    return pose


def defeat_dizzy(ctx, t):
    pose = Pose()
    _lying(pose, ctx, t)
    pose.world["Hat"] = _hat_flight(ctx, 10.0)
    pose.world["FxStars"] = _stars(ctx, t, -0.0)
    pose.scale["FxStars"] = 1.0
    return pose


def taunt(ctx, t):
    """The gun shaken overhead, the other hand on the belly, a belly laugh."""
    pose = Pose()
    plant(pose, ctx, {"Left": (0.05, 0.04), "Right": (0.06, -0.03)}, drop=0.03)
    up = keys(t, [(0, 0), (0.3, 1), (1.45, 1), (1.8, 0)])
    laugh = up * math.sin(TAU * 4.5 * t)
    pose.loc["Hips"] += Vector((0, 0, 0.012 * laugh))
    pose.add("Spine", rx=-5 * up)
    pose.add("Spine1", rx=4 * laugh - 3 * up)
    pose.add("Spine2", rx=2 * laugh)
    pose.add("Neck", rx=-10 * up)
    pose.add("Head", rx=-12 * up + 5 * laugh, rz=-6 * up)
    shake = up * math.sin(TAU * 3.0 * t)
    over = frame((-0.30, -0.06, 1.86 + 0.03 * shake), (0.25, -0.35 + 0.25 * shake, 0.9), (0.2, -0.9, 0.1))
    G = chest_gun(ctx, blend_m(CARRY, over, up))
    belly = frame((0.10, -0.28, 1.08), (-0.75, -0.3, 0.3), (0.2, -0.95, 0.1))

    def left(M):
        sup = G(M) @ ctx.support
        return (blend_m(sup, belly, up), (0.8, 0.4, -0.6), "arm")

    hold(pose, ctx, G, left_override=left, pole_r=(-1.0, 0.2, 0.0))
    pose.curl("LeftHandFingers", lerp(-80, -10, up))
    return pose


WHISTLE_EVENTS = {"toot1": 0.55, "toot2": 0.95}
MOUTH = Vector((0.0, -0.275, 1.495))     # where the whistle sits at the mouth (head rest space)


def whistle(ctx, t):
    """Boss: call reinforcements. The whistle comes up to the mouth on its lanyard, two toots, a wave."""
    pose = Pose()
    plant(pose, ctx, {"Left": (0.05, 0.08), "Right": (0.06, -0.06)}, drop=0.03)
    k = keys(t, [(0, 0), (0.3, 1), (1.25, 1), (1.55, 0)])
    toot = sum(math.exp(-((t - e) / 0.07) ** 2) for e in WHISTLE_EVENTS.values())
    pose.add("Spine", rx=-4 * k - 3 * toot)
    pose.add("Spine1", rx=-3 * toot)
    pose.add("Neck", rx=-4 * k)
    pose.add("Head", rx=-6 * toot)
    pose.loc["Hips"] += Vector((0, 0, 0.02 * toot))
    wave = k * math.sin(TAU * 1.6 * (t - 0.3))
    side = frame((-0.30, -0.18, 1.32), (0.05, -0.45 - 0.2 * wave, 0.88), (-0.2, -0.9, -0.2))
    G = chest_gun(ctx, blend_m(CARRY, side, k))
    rest_w = ctx.sk.rest["Whistle"]
    w_mouth = (Quaternion((1, 0, 0), 90 * DEG).to_matrix() @ rest_w.to_3x3()).to_4x4()
    w_mouth.translation = MOUTH

    def wmat(M):
        default = M["Spine2"] @ ctx.sk.rel["Whistle"]
        at_mouth = M["Head"] @ ctx.sk.rest["Head"].inverted() @ w_mouth
        return blend_m(default, at_mouth, k)

    pose.world["Whistle"] = wmat
    pinch = frame((0, 0, 0), (-1.0, 0.0, 0.25), (0.0, -1.0, 0.0))

    def left(M):
        sup = G(M) @ ctx.support
        w = wmat(M)
        hand = pinch.copy()
        hand.translation = w.to_translation() + Vector((0.0, -0.02, -0.035)) - pinch.to_3x3() @ ctx.lfist
        return (blend_m(sup, hand, ss(0.0, 0.25, t) if t < 1.3 else 1 - ss(1.3, 1.55, t)), (0.9, 0.3, -0.6), "arm")

    hold(pose, ctx, G, left_override=left, pole_r=(-1.0, 0.3, -0.4))
    pose.curl("LeftHandFingers", lerp(-80, -60, k))
    return pose


def registry():
    """name -> (fn, frames, loop, layer, special bones animated)."""
    walk, wf = gait_clip("walk")
    run, rf = gait_clip("run")
    return {
        "Idle": (idle, 72, True, FULL, ()),
        "Walk": (walk, wf, True, FULL, ()),
        "Run": (run, rf, True, FULL, ()),
        "Aim": (aim(0.0), 60, True, UPPER, ()),
        "Aim_Up": (aim(40.0), 60, True, UPPER, ()),
        "Aim_Down": (aim(-40.0), 60, True, UPPER, ()),
        "Fire": (fire, 9, False, UPPER, ()),
        "Reload": (reload, round(RELOAD_SECONDS * FPS), False, UPPER, ()),
        "Throw": (throw, 36, False, UPPER, ("LeftHandProp",)),
        "Hit": (hit, 12, False, FULL, ()),
        "Defeat": (defeat, 60, False, FULL, ("Hat", "FxStars", "FxPoof")),
        "Defeat_Dizzy": (defeat_dizzy, 36, True, FULL, ("Hat", "FxStars")),
        "Taunt": (taunt, 54, False, FULL, ()),
        "Whistle": (whistle, 48, False, FULL, ("Whistle",)),
    }


EVENTS = {"Reload": RELOAD_EVENTS, "Throw": THROW_EVENTS, "Whistle": WHISTLE_EVENTS,
          "Defeat": {"hatOff": 0.0, "ground": DEFEAT_LIE, "stars": DEFEAT_STARS}}
AUTHORED_SPEED = {"Walk": GAITS["walk"]["speed"], "Run": GAITS["run"]["speed"]}
