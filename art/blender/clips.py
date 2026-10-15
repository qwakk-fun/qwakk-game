"""Every animation clip, authored as code on the duck rig.

Each clip is a function of time returning a Pose (see posing.py for the axis and sign conventions).
Locomotion uses foot IK on a gait cycle tuned to the engine speeds in packages/shared/src/constants.ts,
so the feet stay planted when the clip plays at its authored speed. No root motion: the Hips stay
over the origin and only bob, sway and turn.
"""

import math

from mathutils import Matrix, Quaternion, Vector

import holds
import params as P
from posing import DEG, Pose, foot_matrix

FPS = 30
TAU = 2 * math.pi
CROUCH_DROP = 0.30   # hips drop when crouched (engine crouch capsule is 1.15 m)

# ----------------------------------------------------------------- small helpers


def ss(e0, e1, x):
    if e0 == e1:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def keys(t, pts):
    """Piecewise smooth (ease in-out) interpolation through (time, value) points."""
    if t <= pts[0][0]:
        return pts[0][1]
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t <= t1:
            return lerp(v0, v1, ss(t0, t1, t))
    return pts[-1][1]


def spring(t, start, amp, freq=3.0, damp=6.0):
    """Damped overshoot after `start` (seconds): a cheap follow-through wobble."""
    if t < start:
        return 0.0
    x = t - start
    return amp * math.exp(-damp * x) * math.sin(TAU * freq * x)


class Ctx:
    """Rest data the clips need."""

    def __init__(self, sk):
        self.sk = sk
        self.ankle = {s: sk.head[s + "Foot"].copy() for s in ("Left", "Right")}


def plant_feet(pose, ctx, crouch=0.0, wide=0.0, pitch=None):
    for side, sgn in (("Left", 1), ("Right", -1)):
        a = ctx.ankle[side] + Vector((sgn * wide, 0, 0))
        pose.ik[side + "Foot"] = (foot_matrix(ctx.sk, side, a, (pitch or {}).get(side, 0.0)), knee_pole(sgn, crouch), "leg")


def knee_pole(sgn, crouch=0.0):
    return Vector((sgn * (0.25 + crouch), -1.0, 0.0))


def relaxed_arms(pose, swing_l=0.0, swing_r=0.0, hang=66.0, bend=16.0, out=0.0):
    pose.side("Left", "Arm", rx=swing_l, ry=hang - out)
    pose.side("Right", "Arm", rx=swing_r, ry=hang - out)
    pose.side("Left", "ForeArm", rz=-bend - max(0.0, -swing_l) * 0.5)
    pose.side("Right", "ForeArm", rz=-bend - max(0.0, -swing_r) * 0.5)
    pose.fingers("Left", -14, -16, -8)
    pose.fingers("Right", -14, -16, -8)


def tail(pose, wag=0.0, lift=0.0):
    pose.add("Tail", rx=lift, rz=wag)


# ----------------------------------------------------------------- locomotion

GAITS = {
    # speed m/s (engine constants), cycle seconds (two steps), stance fraction, swing lift m,
    # hips bob m, lean deg, waddle roll deg, arm swing deg, extra
    "walk": dict(speed=2.6, cycle=12 / FPS, stance=0.50, lift=0.075, bob=0.030, lean=9, roll=7, sway=0.022,
                 yaw=9, arms=26, heel=14, toe=22, tail=16),
    "run": dict(speed=5.2, cycle=11 / FPS, stance=0.30, lift=0.13, bob=0.045, lean=22, roll=5, sway=0.016,
                yaw=12, arms=44, heel=8, toe=34, tail=20),
    "sprint": dict(speed=7.0, cycle=10 / FPS, stance=0.24, lift=0.17, bob=0.05, lean=32, roll=4, sway=0.012,
                   yaw=10, arms=0, heel=4, toe=40, tail=26, sprint=True),
    "crouch": dict(speed=2.3, cycle=14 / FPS, stance=0.52, lift=0.06, bob=0.02, lean=22, roll=6, sway=0.02,
                   yaw=7, arms=16, heel=8, toe=20, tail=12, crouch=CROUCH_DROP, wide=0.05),
}

DIRS = {"F": Vector((0, -1, 0)), "B": Vector((0, 1, 0)), "L": Vector((1, 0, 0)), "R": Vector((-1, 0, 0))}


def gait_pose(ctx, ph, g, dirv):
    """One instant of a gait cycle. ph in [0, 1); the left foot lands at ph = 0, the right at 0.5."""
    pose = Pose()
    crouch = g.get("crouch", 0.0)
    fwd = -dirv.y                                       # 1 forward, -1 backward, 0 strafe
    lat = dirv.x                                        # 1 to the duck's left, -1 right
    strafe = abs(lat) > 0.5
    # legs reach less sideways and backward, so those gaits plant each foot for a shorter time
    s = g["stance"] * (0.66 if strafe else 0.78 if fwd < 0.5 else 1.0)
    L = g["speed"] * g["cycle"] * s                     # how far a planted foot slides back per stance

    # hips: two bobs per cycle (lowest at mid-stance), waddle sway and roll toward the planted foot
    bob = -g["bob"] * 0.5 * (1 + math.cos(TAU * 2 * (ph - s * 0.5)))
    side_wave = math.cos(TAU * (ph - s * 0.5))          # +1 over the left foot, -1 over the right
    pose.hips = Vector((g["sway"] * side_wave, 0.0, bob - crouch))
    lean = g["lean"] * fwd + (6 if strafe else 0)
    pose.add("Hips", rx=lean * 0.35, ry=g["roll"] * side_wave + (-8 * lat if strafe else 0),
             rz=-g["yaw"] * math.cos(TAU * ph) * (1 if not strafe else 0.3))
    pose.add("Spine", rx=lean * 0.35, ry=-g["roll"] * 0.4 * math.cos(TAU * (ph - s * 0.5 - 0.08)))
    pose.add("Spine1", rx=lean * 0.3, rz=g["yaw"] * 0.7 * math.cos(TAU * (ph - 0.06)))
    pose.add("Spine2", rx=crouch * 40, rz=g["yaw"] * 0.25 * math.cos(TAU * (ph - 0.1)))
    # head stays level-ish and lags a hair behind the body (keeps the eyes readable)
    pose.add("Neck", rx=-lean * 0.55 - crouch * 30, ry=-g["roll"] * 0.5 * math.cos(TAU * (ph - s * 0.5 - 0.15)))
    pose.add("Head", rx=-lean * 0.25 + 3 * math.cos(TAU * 2 * (ph - s * 0.5 - 0.12)))

    # strafes are a side gallop: the trailing foot runs a little ahead in phase, so the feet
    # move almost together and never cross (their separation only grows while both are planted)
    feet = (("Left", 1, 0.0), ("Right", -1, 0.5))
    if strafe:
        lead = 0.16
        feet = (("Left", 1, 0.0 if lat > 0 else -lead), ("Right", -1, -lead if lat > 0 else 0.0))
    for side, sgn, off in feet:
        u = (ph - off) % 1.0
        base = ctx.ankle[side] + Vector((sgn * (g.get("wide", 0.0) + (0.035 if strafe else 0.0)), 0, 0))
        if u < s:
            k = u / s
            along = L * (0.5 - k)
            lift = 0.0
            pitch = -g["heel"] * (1 - ss(0.0, 0.3, k)) * max(fwd, 0) + g["toe"] * ss(0.55, 1.0, k)
        else:
            k = (u - s) / (1 - s)
            e = k * k * k * (k * (6 * k - 15) + 10)               # smootherstep: fast through the middle
            along = L * (-0.5 + e)
            lift = g["lift"] * math.sin(math.pi * k) ** 0.9
            pitch = g["toe"] * (1 - ss(0.0, 0.45, k)) - g["heel"] * ss(0.55, 1.0, k) * max(fwd, 0)
            if strafe:
                lift *= 0.7
        if fwd < -0.5:
            pitch = -pitch * 0.6 if pitch < 0 else pitch * 0.7  # backpedal: land on the toes
        pos = base + dirv * along + Vector((0, 0, lift))
        # roll the foot over the ball (heel up) or the heel (toes up)
        if pitch > 0:
            pivot = pos + Vector((0, -0.11, -0.075))
        else:
            pivot = pos + Vector((0, 0.06, -0.075))
        r = Matrix.Rotation(pitch * DEG, 3, "X")
        ankle = pivot + r @ (pos - pivot)
        pose.ik[side + "Foot"] = (foot_matrix(ctx.sk, side, ankle, pitch), knee_pole(sgn, crouch), "leg")

    # wings
    c = math.cos(TAU * ph)
    if g.get("sprint"):
        # wings swept back and down, fluttering: the duck's "ninja run"
        flap = 6 * math.sin(TAU * 2 * ph)
        flutter = 7 * math.sin(TAU * 4 * ph)
        pose.both("Arm", rx=50 + flutter, ry=80 + flap)
        pose.both("ForeArm", rz=10)
        pose.fingers("Left", -8, -10, -5)
        pose.fingers("Right", -8, -10, -5)
    elif strafe:
        flap = 10 * math.sin(TAU * 2 * (ph - 0.1))
        relaxed_arms(pose, 0, 0, hang=52 + flap, bend=22)
    else:
        a = g["arms"] * (1 if fwd >= 0 else 0.7)
        relaxed_arms(pose, swing_l=a * c, swing_r=-a * c, hang=64 - crouch * 60, bend=20 + crouch * 60)
    tail(pose, wag=g["tail"] * math.sin(TAU * 2 * ph - 1.2) + (12 * lat if strafe else 0), lift=8 + 6 * math.cos(TAU * 2 * ph))
    if g.get("sprint"):
        pose.add("Jaw", rx=10 + 3 * math.sin(TAU * 2 * ph))
    return pose


def gait_clip(kind, d):
    g = GAITS[kind]
    frames = round(g["cycle"] * FPS)
    dirv = DIRS[d]

    def fn(ctx, t):
        return gait_pose(ctx, (t * FPS / frames) % 1.0, g, dirv)
    return fn, frames


# ----------------------------------------------------------------- idle and crouch idle


def idle(ctx, t, crouch=0.0):
    T = 3.0 if crouch == 0 else 2.0
    ph = t / T
    breathe = math.sin(TAU * ph * (2 if crouch == 0 else 2))
    shift = math.sin(TAU * ph)
    pose = Pose()
    pose.hips = Vector((0.012 * shift, 0, -0.006 * (1 + breathe) * 0.5 - crouch))
    pose.add("Hips", rx=crouch * 30, ry=2.0 * shift)
    pose.add("Spine", rx=crouch * 25, ry=-1.2 * shift)
    pose.add("Spine1", rx=1.5 * breathe)
    pose.add("Spine2", rx=0.8 * breathe + crouch * 25)
    look = math.sin(TAU * ph + 0.6)
    pose.add("Neck", rx=-1.0 * breathe - crouch * 70, rz=6 * look)
    pose.add("Head", rx=2.0 * math.sin(TAU * 2 * ph + 1.0), ry=3 * look)
    relaxed_arms(pose, 3 * breathe, 3 * breathe, hang=64 + 2 * breathe - crouch * 40, bend=18 + crouch * 50)
    # a quick happy tail wag once per loop
    w = ss(0.55, 0.6, ph) * (1 - ss(0.75, 0.8, ph))
    tail(pose, wag=22 * w * math.sin(TAU * 7 * ph), lift=6 + 2 * breathe)
    plant_feet(pose, ctx, crouch=crouch, wide=0.03 if crouch else 0.0)
    return pose


# ----------------------------------------------------------------- jump, fall, land


def jump_start(ctx, t):
    # 0 to 0.12 s: squash down, 0.12 to 0.3 s: spring up onto the toes, wings swing up
    down = keys(t, [(0, 0), (0.12, 1), (0.30, 0)])
    up = keys(t, [(0.10, 0), (0.30, 1)])
    pose = Pose()
    pose.hips = Vector((0, 0, -0.12 * down + 0.05 * up))
    pose.add("Hips", rx=10 * down)
    pose.add("Spine", rx=8 * down - 4 * up)
    pose.add("Neck", rx=-10 * down + 6 * up)
    pose.both("Arm", rx=30 * down - 10 * up, ry=66 * (1 - up) + 5 * up - 10 * down)
    pose.both("ForeArm", rz=-20)
    pose.fingers("Left", -10)
    pose.fingers("Right", -10)
    tail(pose, lift=-10 * down + 20 * up)
    toe = 40 * up
    for side, sgn in (("Left", 1), ("Right", -1)):
        a = ctx.ankle[side]
        pivot = a + Vector((0, -0.11, -0.075))
        r = Matrix.Rotation(toe * DEG, 3, "X")
        ankle = pivot + r @ (a - pivot)
        pose.ik[side + "Foot"] = (foot_matrix(ctx.sk, side, ankle, toe), knee_pole(sgn), "leg")
    return pose


def air_pose(ctx, ph, intensity=1.0):
    pose = Pose()
    flap = math.sin(TAU * ph)
    pose.hips = Vector((0, 0, 0.02))
    pose.add("Spine", rx=6)
    pose.add("Neck", rx=-8)
    pose.add("Head", rx=-4 + 3 * math.sin(TAU * ph - 0.8))
    pose.both("Arm", ry=8 - 38 * flap * intensity, rx=-6)
    pose.both("ForeArm", rz=8 * flap)
    pose.fingers("Left", -4)
    pose.fingers("Right", -4)
    pose.both("UpLeg", rx=-24 + 6 * math.sin(TAU * ph))
    pose.both("Leg", rx=42 + 8 * math.sin(TAU * ph + 1.0))
    pose.both("Foot", rx=22)
    tail(pose, wag=10 * math.sin(TAU * ph * 2), lift=18)
    pose.add("Jaw", rx=8 + 4 * math.sin(TAU * ph))
    return pose


def fall_loop(ctx, t):
    return air_pose(ctx, t / (16 / FPS))


def land(ctx, t):
    # impact squash at 0.08 s, recover with a little overshoot by 0.4 s
    sq = keys(t, [(0, 0), (0.08, 1), (0.40, 0)]) + spring(t, 0.3, 0.08, 3.0, 9.0)
    pose = Pose()
    pose.hips = Vector((0, 0, -0.14 * sq))
    pose.add("Hips", rx=12 * sq)
    pose.add("Spine", rx=10 * sq)
    pose.add("Neck", rx=-14 * sq)
    pose.add("Head", rx=6 * sq)
    a = keys(t, [(0, 1), (0.25, 0)])
    pose.both("Arm", ry=lerp(66, 20, a) + 10 * sq, rx=-10 * a)
    pose.both("ForeArm", rz=-16 - 10 * sq)
    pose.fingers("Left", -12)
    pose.fingers("Right", -12)
    tail(pose, wag=spring(t, 0.05, 18, 4.0, 7.0), lift=10 - 14 * sq)
    plant_feet(pose, ctx, crouch=0.1 * sq)
    return pose


# ----------------------------------------------------------------- hit and deaths


def hit_react(ctx, t):
    k = keys(t, [(0, 0), (0.06, 1), (0.40, 0)]) + spring(t, 0.3, 0.1, 3.0, 10)
    pose = Pose()
    pose.hips = Vector((0, 0.03 * k, -0.02 * k))
    pose.add("Hips", rx=-6 * k)
    pose.add("Spine", rx=-10 * k, ry=6 * k)
    pose.add("Spine1", rx=-6 * k, rz=-8 * k)
    pose.add("Neck", rx=-14 * k, rz=6 * k)
    pose.add("Head", rx=-8 * k)
    relaxed_arms(pose, -20 * k, -10 * k, hang=lerp(64, 30, k), bend=16 + 30 * k)
    pose.add("Jaw", rx=22 * k)
    tail(pose, wag=spring(t, 0.04, 25, 5, 6), lift=20 * k)
    plant_feet(pose, ctx)
    return pose


def death_a(ctx, t):
    """Knocked onto the back, feet up in the air, a last little kick."""
    hit = keys(t, [(0, 0), (0.10, 1), (0.25, 0.6)])
    fall = keys(t, [(0.08, 0), (0.55, 1)])
    fall = fall * fall * (1.4 - 0.4 * fall)          # gravity-ish ease-in
    bounce = spring(t, 0.55, 0.05, 2.5, 6.0)
    pose = Pose()
    pose.hips = Vector((0, 0.10 * fall, lerp(0, 0.30 - 0.66, fall) + abs(bounce)))
    pose.add("Hips", rx=-88 * fall - 8 * hit)
    pose.add("Spine", rx=-10 * hit + 6 * fall)
    pose.add("Neck", rx=-20 * hit + 18 * fall, rz=40 * ss(0.5, 0.9, t))
    pose.add("Head", rx=10 * fall, ry=-12 * ss(0.5, 0.9, t))
    arms = keys(t, [(0, 0), (0.2, 1)])
    pose.both("Arm", ry=lerp(64, -5, arms) + 10 * fall, rx=-20 * arms)
    pose.both("ForeArm", rz=-10 - 15 * arms)
    pose.fingers("Left", -6 - 20 * fall)
    pose.fingers("Right", -6 - 20 * fall)
    kick = math.sin(TAU * 3 * ss(0.85, 1.2, t)) * (1 - ss(1.1, 1.3, t))
    pose.add("LeftUpLeg", rx=-80 * fall - 6 * hit + 12 * kick)
    pose.add("RightUpLeg", rx=-70 * fall - 6 * hit - 12 * kick)
    pose.both("Leg", rx=25 * fall + 15 * hit)
    pose.both("Foot", rx=-20 * fall)
    pose.add("Jaw", rx=lerp(0, 26, hit) * (1 - fall) + 18 * fall)
    tail(pose, wag=spring(t, 0.6, 20, 3, 4), lift=-30 * fall)
    return pose


def death_b(ctx, t):
    """Face-plant forward, tail up, one last tail twitch."""
    knees = keys(t, [(0, 0), (0.25, 1)])
    fall = keys(t, [(0.15, 0), (0.6, 1)])
    fall = fall * fall * (1.4 - 0.4 * fall)
    bounce = spring(t, 0.6, 0.04, 2.5, 6.0)
    pose = Pose()
    pose.hips = Vector((0, -0.08 * fall, -0.18 * knees + lerp(0, 0.33 - 0.48, fall) + abs(bounce)))
    pose.add("Hips", rx=12 * knees + 76 * fall)
    pose.add("Spine", rx=10 * knees + 8 * fall)
    pose.add("Neck", rx=-10 * fall, rz=-50 * ss(0.4, 0.8, t))
    pose.add("Head", rx=-14 * fall)
    pose.both("Arm", ry=lerp(64, 30, knees) - 40 * fall, rx=-30 * knees - 30 * fall)
    pose.both("ForeArm", rz=-30 * knees + 20 * fall)
    pose.fingers("Left", -10)
    pose.fingers("Right", -10)
    pose.both("UpLeg", rx=-20 * knees + 70 * fall)
    pose.both("Leg", rx=60 * knees + 30 * fall)
    pose.both("Foot", rx=10 * fall)
    pose.add("Jaw", rx=20 * knees)
    twitch = math.sin(TAU * 4 * ss(0.9, 1.25, t)) * (1 - ss(1.15, 1.3, t))
    tail(pose, wag=25 * twitch, lift=30 * fall)
    return pose


# ----------------------------------------------------------------- weapons (upper body layer)

AIM = {
    # weapon grip position (armature space, rest hips), pitch/roll/yaw degrees, spine twist, left elbow pole
    "rifle": dict(pos=(-0.24, -0.33, 0.88), rot=(0, 0, 0), twist=-35, lean=4),
    "pistol": dict(pos=(-0.07, -0.40, 0.95), rot=(0, 0, 0), twist=-8, lean=3),
}


def weapon_pose(ctx, kind, gun_offset=None, left_override=None, breathe=0.0, extra=None):
    """Upper-body pose holding `kind` at its aim spot. gun_offset is a 4x4 applied in weapon space."""
    a = AIM[kind]
    pose = Pose()
    tw = a["twist"]
    pose.add("Spine", rx=a["lean"] * 0.5, rz=tw * 0.3)
    pose.add("Spine1", rx=a["lean"] * 0.5 + breathe, rz=tw * 0.35)
    pose.add("Spine2", rx=breathe * 0.5, rz=tw * 0.35)
    pose.add("Neck", rx=-a["lean"] - breathe, rz=-tw * 0.6)
    pose.add("Head", rz=-tw * 0.3)
    pose.both("Shoulder", rz=0)
    gun = holds.frame(Vector(a["pos"]) + Vector((0, 0, breathe * 0.002)), *a["rot"])
    if gun_offset is not None:
        gun = gun @ gun_offset
    pose.ik["RightHand"] = (holds.hand_target(ctx.sk, "Right", gun), Vector((-1.0, 0.6, -0.9)), "arm")
    support = left_override(gun) if left_override else holds.support_frame(gun, kind)
    pose.ik["LeftHand"] = (holds.hand_target(ctx.sk, "Left", support), Vector((0.5, 0.2, -1.0)), "arm")
    gc, sc = holds.GRIP_CURL, holds.SUPPORT_CURL
    pose.fingers("Right", gc["index"], gc["middle"], gc["thumb"])
    if left_override is None:
        pose.fingers("Left", sc["index"], sc["middle"], sc["thumb"])
    if extra:
        extra(pose)
    pose.gun = gun
    return pose


def aim_loop(kind):
    def fn(ctx, t):
        return weapon_pose(ctx, kind, breathe=1.2 * math.sin(TAU * t / 2.0))
    return fn


def fire(kind):
    kick_back, kick_up = (0.035, 5.0) if kind == "rifle" else (0.025, 12.0)

    def fn(ctx, t):
        k = keys(t, [(0, 0), (0.033, 1), (0.2, 0)])
        off = Matrix.Translation((0, kick_back * k, 0)) @ Matrix.Rotation(-kick_up * k * DEG, 4, "X")   # muzzle climbs

        def extra(pose):
            pose.add("Spine2", rx=-2.5 * k)
            pose.add("Neck", rx=1.5 * k)
        return weapon_pose(ctx, kind, gun_offset=off, extra=extra)
    return fn


def reload_rifle(ctx, t):
    # tilt the rifle in, left hand: support -> magazine -> pull down -> back in -> slap -> support
    tilt = keys(t, [(0, 0), (0.25, 1), (1.45, 1), (1.7, 0)])
    off = Matrix.Rotation(-22 * tilt * DEG, 4, "Y") @ Matrix.Rotation(10 * tilt * DEG, 4, "X")
    mag = Vector((0.0, -0.10, -0.03))
    path = [(0.0, None), (0.30, mag), (0.45, mag), (0.70, mag + Vector((0.12, 0.02, -0.26))),
            (0.95, mag + Vector((0.10, 0.03, -0.22))), (1.15, mag + Vector((0, 0, -0.03))), (1.25, mag),
            (1.40, mag), (1.70, None)]

    def left(gun):
        base = holds.support_frame(gun, "rifle")
        pts = [(tt, (gun.inverted() @ base).to_translation() if p is None else p) for tt, p in path]
        x = keys(t, [(tt, p.x) for tt, p in pts])
        y = keys(t, [(tt, p.y) for tt, p in pts])
        z = keys(t, [(tt, p.z) for tt, p in pts])
        m = base.copy()
        m.translation = gun @ Vector((x, y, z))
        return m

    def extra(pose):
        pose.fingers("Left", -30 * keys(t, [(0.3, 0.2), (0.4, 1.0), (1.3, 1.0), (1.5, 0.6)]) - 10)
        pose.add("Neck", rx=10 * tilt, rz=10 * tilt)
        pose.add("Head", rx=6 * tilt)
    return weapon_pose(ctx, "rifle", gun_offset=off, left_override=left, extra=extra)


def reload_pistol(ctx, t):
    # tip the pistol up and in, off hand drops for a fresh mag, slaps it in, racks the slide
    tilt = keys(t, [(0, 0), (0.18, 1), (1.05, 1), (1.3, 0)])
    off = Matrix.Translation((0.04 * tilt, 0.08 * tilt, 0.04 * tilt)) @ Matrix.Rotation(28 * tilt * DEG, 4, "Y") \
        @ Matrix.Rotation(20 * tilt * DEG, 4, "X")
    grip_bottom = Vector((0.0, 0.03, -0.11))
    slide = Vector((0.02, 0.02, 0.10))
    path = [(0.0, None), (0.25, grip_bottom + Vector((0.06, 0.0, -0.20))), (0.45, grip_bottom + Vector((0.0, 0.0, -0.06))),
            (0.55, grip_bottom), (0.75, slide), (0.88, slide + Vector((0, 0.07, 0))), (1.0, slide + Vector((0, 0.06, 0.03))),
            (1.3, None)]

    def left(gun):
        base = holds.support_frame(gun, "pistol")
        pts = [(tt, (gun.inverted() @ base).to_translation() if p is None else p) for tt, p in path]
        m = base.copy()
        m.translation = gun @ Vector((keys(t, [(tt, p.x) for tt, p in pts]), keys(t, [(tt, p.y) for tt, p in pts]),
                                      keys(t, [(tt, p.z) for tt, p in pts])))
        return m

    def extra(pose):
        pose.fingers("Left", -25, -28, -12)
        pose.add("Neck", rx=8 * tilt)
    return weapon_pose(ctx, "pistol", gun_offset=off, left_override=left, extra=extra)


def equip(ctx, t):
    # rifle swings up from a low ready (muzzle down, at the hip) into the aim
    k = keys(t, [(0, 0), (0.45, 1)])
    settle = spring(t, 0.42, 0.6, 3, 9)
    # weapon-space offset at the start: lower, closer, muzzle pitched down 55 degrees
    off = Matrix.Translation(Vector((0.0, 0.18, -0.20)) * (1 - k)) @ Matrix.Rotation((55 * (1 - k) - settle) * DEG, 4, "X")
    return weapon_pose(ctx, "rifle", gun_offset=off)


def quack(ctx, t):
    pose = Pose()
    q1 = keys(t, [(0.05, 0), (0.15, 1), (0.30, 0)])
    q2 = keys(t, [(0.45, 0), (0.55, 1), (0.75, 0)])
    q = max(q1, q2)
    pose.hips = Vector((0, 0, -0.03 * q))
    pose.add("Spine", rx=-6 * q)
    pose.add("Spine1", rx=-4 * q)
    pose.add("Neck", rx=-14 * q)
    pose.add("Head", rx=-8 * q, ry=6 * math.sin(TAU * t))
    pose.add("Jaw", rx=34 * q)
    relaxed_arms(pose, -10 * q, -10 * q, hang=lerp(64, 22, q), bend=16)
    tail(pose, wag=24 * math.sin(TAU * 4 * t) * (1 - ss(0.8, 1.0, t)), lift=10 + 20 * q)
    plant_feet(pose, ctx)
    return pose


# ----------------------------------------------------------------- registry

UPPER = "upper"
FULL = "full"


def registry():
    """name -> (fn(ctx, t), frames, loop, layer)."""
    clips = {}
    clips["Idle"] = (lambda c, t: idle(c, t), 90, True, FULL)
    for d in "FBLR":
        fn, n = gait_clip("walk", d)
        clips["Walk_" + d] = (fn, n, True, FULL)
        fn, n = gait_clip("run", d)
        clips["Run_" + d] = (fn, n, True, FULL)
    fn, n = gait_clip("sprint", "F")
    clips["Sprint"] = (fn, n, True, FULL)
    clips["Crouch_Idle"] = (lambda c, t: idle(c, t, crouch=CROUCH_DROP), 60, True, FULL)
    fn, n = gait_clip("crouch", "F")
    clips["Crouch_Walk"] = (fn, n, True, FULL)
    clips["Jump_Start"] = (jump_start, 9, False, FULL)
    clips["Fall_Loop"] = (fall_loop, 16, True, FULL)
    clips["Land"] = (land, 12, False, FULL)
    clips["Death_A"] = (death_a, 42, False, FULL)
    clips["Death_B"] = (death_b, 40, False, FULL)
    clips["Hit_React"] = (hit_react, 12, False, FULL)
    clips["Rifle_Aim"] = (aim_loop("rifle"), 60, True, UPPER)
    clips["Pistol_Aim"] = (aim_loop("pistol"), 60, True, UPPER)
    clips["Rifle_Reload"] = (reload_rifle, 54, False, UPPER)
    clips["Pistol_Reload"] = (reload_pistol, 42, False, UPPER)
    clips["Rifle_Fire"] = (fire("rifle"), 6, False, UPPER)
    clips["Pistol_Fire"] = (fire("pistol"), 6, False, UPPER)
    clips["Equip"] = (equip, 18, False, UPPER)
    clips["Quack"] = (quack, 30, False, FULL)
    return clips
