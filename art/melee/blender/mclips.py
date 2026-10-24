"""The duck's katana clips, authored as code on the classic duck rig (art/blender/posing.py conventions).

A clip is a function of time returning a posing.Pose. Most poses come from a small parameter set (`St`):
the katana's grip in polar coordinates around the chest (yaw, radius, height), the blade's direction
(yaw, pitch), the side the edge faces, the body twist and lean, the hips drop, the free (left) wing, the
feet and the face. Keyframes of those parameters are interpolated with eased keys, so a swing whose grip
yaw goes from the right to the left follows a true arc around the duck, not a straight chord.

The katana rides the right hand (RightHand joint, `KATANA_ATTACH`), so the right hand is placed by IK
wherever the code puts the katana. No root motion: the hips stay over the origin (Dash, Heavy_Release
and the spins included); the engine moves and turns the duck.

Yaw angles here are in degrees from the duck's forward, positive toward the duck's LEFT (+X), the
posing.py convention. The contract (README, melee.json) reports hit arcs with positive to the RIGHT,
which is how the sim and a player read them; mmeasure.py converts.
"""

import math

from mathutils import Matrix, Quaternion, Vector

import clips as dclips          # art/blender/clips.py: FPS, ss, keys, spring, idle, run gait
import holds
import mp
from posing import DEG, Pose, foot_matrix, solve

FPS = dclips.FPS
TAU = 2 * math.pi
FULL, UPPER = dclips.FULL, dclips.UPPER
ss, keys, spring, lerp = dclips.ss, dclips.keys, dclips.spring, dclips.lerp

CHEST = Vector((0.0, -0.02, 0.0))          # polar center of the grip (height comes from the stance)


def dirv(yaw, pitch=0.0):
    """Unit vector at yaw (degrees, + toward the duck's left) and pitch (+ up), forward is -Y."""
    y, p = yaw * DEG, pitch * DEG
    return Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))


def kframe(pos, blade, edge_hint):
    """Katana frame (world): blade along +Z, the edge (-Y) as close to `edge_hint` as possible."""
    z = Vector(blade).normalized()
    e = Vector(edge_hint)
    e = e - z * e.dot(z)
    if e.length < 1e-6:
        e = z.orthogonal()
    e.normalize()
    y = -e
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(pos)
    return m


def blend_m(a, b, k):
    if k <= 0:
        return a.copy()
    if k >= 1:
        return b.copy()
    qa, qb = a.to_quaternion(), b.to_quaternion()
    if qa.dot(qb) < 0:
        qb = -qb
    m = qa.slerp(qb, k).to_matrix().to_4x4()
    m.translation = a.to_translation().lerp(b.to_translation(), k)
    return m


def rot_z(deg):
    return Matrix.Rotation(deg * DEG, 4, "Z")


# ----------------------------------------------------------------- rest data


class MCtx:
    """Rest data the melee clips need, on top of the duck's own clips.Ctx."""

    def __init__(self, sk):
        self.sk = sk
        self.base = dclips.Ctx(sk)
        self.ankle = self.base.ankle
        # the right fist's grip frame without the gun rake: the katana's handle runs along the curled fingers
        k_rest = holds._rest_grip_frame("Right") @ Matrix.Rotation(holds.GRIP_RAKE_DEG * DEG, 4, "X")
        self.k_rest = k_rest
        self.attach = sk.rest["RightHand"].inverted() @ k_rest          # katana in RightHand space (Blender)
        self.attach_inv = self.attach.inverted()
        # the scabbard on the back (rest pose, armature space) and the katana's seat inside it
        tip = Vector(mp.SAYA_TIP_DIR).normalized()
        edge = Vector(mp.SAYA_EDGE)
        edge = (edge - tip * edge.dot(tip)).normalized()
        zs, ys = -tip, -edge
        xs = ys.cross(zs)
        saya = Matrix((xs, ys, zs)).transposed().to_4x4()
        saya.translation = Vector(mp.SAYA_MOUTH)
        self.saya_rest = saya
        import katana
        self.seat_rest = saya @ katana.seat_matrix()
        self.saya_bone = mp.SAYA_BONE
        self.saya_local = sk.rest[mp.SAYA_BONE].inverted() @ saya           # scabbard in its bone's space
        self.seat_local = sk.rest[mp.SAYA_BONE].inverted() @ self.seat_rest

    def hand_for(self, K):
        return K @ self.attach_inv


# ----------------------------------------------------------------- the stance parameter set

BASE = dict(
    # katana: grip yaw / radius / height, blade yaw / pitch, edge hint offsets (relative to the blade)
    gy=-38.0, gr=0.40, gh=0.86, by=-12.0, bp=42.0, ey=0.0, ep=-90.0, roll=0.0,
    # right elbow pole: yaw and pitch of the direction the elbow points
    py=-100.0, pp=-45.0,
    # body: twist (+ left), forward lean, side lean (+ toward the left), hips drop, hips shift, whole-body yaw
    tw=-12.0, lean=6.0, side=0.0, drop=0.05, hx=0.0, hy=0.0, yaw=0.0, head=0.6, nod=0.0,
    # left wing: forward swing (rx, negative is forward), hang (ry), elbow bend, finger curl (0 open)
    lfwd=-38.0, lhang=48.0, lbend=30.0, lcurl=-6.0,
    # feet: width added per side, left foot forward / right foot back, foot turn-out, foot lifts, knee pole spread
    wide=0.07, stag=0.09, fturn=12.0, lfl=0.0, rfl=0.0, lfz=0.0, rfz=0.0, kp=0.25,
    # face and tail
    jaw=0.0, tlift=8.0, twag=0.0,
)


def st(**kw):
    p = dict(BASE)
    p.update(kw)
    return p


def mix(a, b, k):
    return {n: a[n] + (b[n] - a[n]) * k for n in a}


def track(t, pts):
    """Keyframes of stances: [(time, stance)], eased between keys (per key pair: ease in-out)."""
    if t <= pts[0][0]:
        return dict(pts[0][1])
    for (t0, a), (t1, b) in zip(pts, pts[1:]):
        if t <= t1:
            return mix(a, b, ss(t0, t1, t))
    return dict(pts[-1][1])


def track_lin(t, pts, ease=None):
    """Like track() but with a custom easing per segment: pts = [(time, stance, ease_fn_or_None)]."""
    if t <= pts[0][0]:
        return dict(pts[0][1])
    for (t0, a, _e0), (t1, b, e1) in zip(pts, pts[1:]):
        if t <= t1:
            x = (t - t0) / (t1 - t0)
            return mix(a, b, (e1 or (lambda v: v * v * (3 - 2 * v)))(x))
    return dict(pts[-1][1])


def ease_whip(x):
    """Slow start, very fast middle, soft stop: the swing itself."""
    x = max(0.0, min(1.0, x))
    return x * x * x * (x * (6 * x - 15) + 10)


def ease_out(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def katana_of(p):
    """The katana frame (armature space, before the whole-body yaw) for a stance."""
    pos = CHEST + dirv(p["gy"]) * p["gr"] + Vector((0, 0, p["gh"]))
    b = dirv(p["by"], p["bp"])
    e = dirv(p["by"] + p["ey"], p["bp"] + p["ep"])
    K = kframe(pos, b, e)
    if p["roll"]:
        K = K @ Matrix.Rotation(p["roll"] * DEG, 4, "Z")
    return K


def pose_of(ctx, p, right=True, upper_only=False, katana=None):
    """A full pose from a stance. `katana` overrides the katana frame (a world matrix)."""
    pose = Pose()
    yawm = rot_z(p["yaw"])
    tw = p["tw"]
    # hips and spine: the twist is shared along the chain, the head turns back toward the target
    pose.hips = Vector((p["hx"], p["hy"], -p["drop"]))
    if not upper_only:
        pose.add("Hips", rx=p["lean"] * 0.30, ry=p["side"] * 0.3, rz=tw * 0.22 + p["yaw"])
    pose.add("Spine", rx=p["lean"] * 0.30, ry=p["side"] * 0.3, rz=tw * 0.26 + (p["yaw"] if upper_only else 0.0))
    pose.add("Spine1", rx=p["lean"] * 0.22, ry=p["side"] * 0.2, rz=tw * 0.28)
    pose.add("Spine2", rx=p["lean"] * 0.18, ry=p["side"] * 0.2, rz=tw * 0.24)
    pose.add("Neck", rx=-p["lean"] * 0.55 + p["nod"] * 0.5, rz=-tw * p["head"] * 0.55, ry=-p["side"] * 0.4)
    pose.add("Head", rx=-p["lean"] * 0.2 + p["nod"] * 0.5, rz=-tw * p["head"] * 0.45, ry=-p["side"] * 0.3)
    pose.add("Jaw", rx=p["jaw"])
    if not upper_only:
        pose.add("Tail", rx=p["tlift"], rz=p["twag"])
    # left wing (FK) and fingers
    pose.side("Left", "Arm", rx=p["lfwd"], ry=p["lhang"])
    pose.side("Left", "ForeArm", rz=-p["lbend"])
    pose.fingers("Left", p["lcurl"], p["lcurl"] * 1.1, p["lcurl"] * 0.5)
    # right hand on the katana
    if right:
        K = katana if katana is not None else yawm @ katana_of(p)
        pole = (yawm.to_3x3() @ dirv(p["py"], p["pp"]))
        pose.ik["RightHand"] = (K @ ctx.attach_inv, pole, "arm")
        gc = holds.GRIP_CURL
        pose.fingers("Right", gc["index"], gc["middle"], gc["thumb"])
        pose.katana = K
    # feet: stance width and stagger, both rotated with the whole-body yaw
    if not upper_only:
        for side, sgn, fwd, lift, fz in (("Left", 1, p["stag"], p["lfl"], p["lfz"]), ("Right", -1, -p["stag"], p["rfl"], p["rfz"])):
            a = ctx.ankle[side] + Vector((sgn * p["wide"], -fwd, lift))
            a = yawm.to_3x3() @ a
            m = foot_matrix(ctx.sk, side, a, fz, yaw=p["yaw"] + sgn * p["fturn"] * 0.5)
            pole = yawm.to_3x3() @ Vector((sgn * p["kp"], -1.0, 0.0))
            pose.ik[side + "Foot"] = (m, pole, "leg")
    return pose


def with_breath(p, t, period, amount=1.0):
    b = math.sin(TAU * t / period)
    q = dict(p)
    q["gh"] += 0.012 * b * amount
    q["bp"] += 2.5 * b * amount
    q["lean"] += 1.2 * b * amount
    q["drop"] += 0.006 * (1 + b) * 0.5 * amount
    q["lfwd"] += 3.0 * b * amount
    return q


# ----------------------------------------------------------------- ready stance and run

READY = st(gy=-64, gr=0.42, gh=0.84, by=-40, bp=34, py=-112, pp=-40)


def katana_idle(ctx, t):
    """Ready stance: low and wide, katana out at the right hip pointing up and forward, the free wing
    raised in front. Breathing, a blade bob, a quick tail wag once per loop."""
    T = 2.0
    p = with_breath(READY, t, T)
    w = ss(0.55, 0.62, t / T) * (1 - ss(0.78, 0.85, t / T))
    p["twag"] = 20 * w * math.sin(TAU * 6 * t / T)
    p["tw"] += 2.0 * math.sin(TAU * t / T + 0.5)
    return pose_of(ctx, p)


RUN_CARRY = st(gy=-88, gr=0.42, gh=0.80, by=-150, bp=16, ey=0, ep=90, py=-115, pp=-30,
               tw=-8, lean=18, lfwd=0, lhang=60, lbend=22, lcurl=-14)


def katana_run(ctx, t):
    """Upper body over Run_* and Sprint: the katana trails low behind the right hip (blade back, edge up),
    the left wing swings with the stride. Same length as Run_F so its phase can follow the run."""
    frames = 11
    ph = (t * FPS / frames) % 1.0
    c = math.cos(TAU * ph)
    p = dict(RUN_CARRY)
    p["lfwd"] = 44 * c                       # Run_F's left-arm swing (clips.GAITS run, arms 44)
    p["gh"] += 0.015 * math.cos(TAU * 2 * ph)
    p["bp"] += 4 * math.cos(TAU * 2 * ph - 0.5)
    p["gy"] += 4 * c
    return pose_of(ctx, p, upper_only=True)


# ----------------------------------------------------------------- the light combo
# Each slash starts from the pose the previous one leaves at its combo window, so chaining with a short
# crossfade (about 0.06 s) never pops; played alone, each one recovers to READY by its last frame.

S1_WIND = st(gy=-112, gr=0.36, gh=0.95, by=-165, bp=22, ey=90, ep=0, py=-120, pp=-25,
             tw=-40, lean=4, lfwd=-62, lhang=40, lbend=40, lcurl=0, stag=0.11, drop=0.07, twag=-14)
S1_HIT = st(gy=-10, gr=0.44, gh=0.90, by=2, bp=-4, ey=90, ep=0, py=-95, pp=-55,
            tw=8, lean=12, lfwd=-10, lhang=70, lbend=30, lcurl=-20, stag=0.11, drop=0.09, jaw=10)
S1_END = st(gy=40, gr=0.37, gh=0.86, by=88, bp=-14, ey=90, ep=0, py=-60, pp=-70,
            tw=36, lean=10, lfwd=30, lhang=62, lbend=24, lcurl=-20, stag=0.11, drop=0.09, twag=18)

SLASH_EVENTS = {
    "Slash_1": dict(activeStart=0.13, impact=0.16, activeEnd=0.20, comboOpen=0.18, comboClose=0.34, recover=0.27),
    "Slash_2": dict(activeStart=0.11, impact=0.15, activeEnd=0.20, comboOpen=0.19, comboClose=0.36, recover=0.29),
    "Slash_3": dict(activeStart=0.24, impact=0.30, activeEnd=0.33, comboOpen=None, comboClose=None, recover=0.40),
}


def _impact_mix(a, b, c, x):
    """Swing progress x in [0, 1] through a -> b (the impact) -> c, as a two-span arc."""
    if x < 0.55:
        return mix(a, b, x / 0.55)
    return mix(b, c, (x - 0.55) / 0.45)


def slash_1(ctx, t):
    """Right to left, a flat forehand cut at belly height. Wind up 0.0 to 0.10, swing 0.10 to 0.20
    (impact 0.16), follow through to 0.27, recover to READY by 0.40."""
    if t < 0.10:
        p = mix(READY, S1_WIND, ss(0.0, 0.10, t))
    elif t < 0.21:
        p = _impact_mix(S1_WIND, S1_HIT, S1_END, ease_whip((t - 0.10) / 0.11))
    else:
        settle = spring(t, 0.21, 1.0, 3.0, 9.0)
        p = dict(S1_END)
        p["gy"] += 4 * settle
        p["by"] += 6 * settle
        p = mix(p, READY, ss(0.27, 0.40, t))
    return pose_of(ctx, p)


S2_START = dict(S1_END)
S2_WIND = st(gy=52, gr=0.38, gh=0.92, by=105, bp=-2, ey=-90, ep=0, py=-55, pp=-70,
             tw=42, lean=8, lfwd=34, lhang=58, lbend=28, lcurl=-20, stag=0.10, drop=0.08, twag=20)
S2_HIT = st(gy=-14, gr=0.45, gh=0.98, by=-6, bp=8, ey=-90, ep=0, py=-100, pp=-40,
            tw=-6, lean=10, lfwd=-30, lhang=62, lbend=36, lcurl=-6, stag=0.10, drop=0.08, jaw=12)
S2_END = st(gy=-96, gr=0.40, gh=1.04, by=-118, bp=26, ey=-90, ep=0, py=-130, pp=-20,
            tw=-42, lean=4, lfwd=-58, lhang=50, lbend=34, lcurl=0, stag=0.10, drop=0.06, twag=-18)


def slash_2(ctx, t):
    """Left to right, a rising backhand cut. Starts in Slash_1's follow-through. Re-cock 0.0 to 0.09,
    swing 0.09 to 0.20 (impact 0.15), follow through to 0.29, recover to READY by 0.43."""
    if t < 0.09:
        p = mix(S2_START, S2_WIND, ss(0.0, 0.09, t))
    elif t < 0.20:
        p = _impact_mix(S2_WIND, S2_HIT, S2_END, ease_whip((t - 0.09) / 0.11))
    else:
        settle = spring(t, 0.20, 1.0, 3.0, 9.0)
        p = dict(S2_END)
        p["gy"] -= 4 * settle
        p["by"] -= 6 * settle
        p = mix(p, READY, ss(0.29, 0.43, t))
    return pose_of(ctx, p)


S3_START = dict(S2_END)
S3_UP = st(gy=-40, gr=0.30, gh=1.30, by=-60, bp=120, ey=0, ep=90, py=-90, pp=-10,
           tw=-18, lean=-14, lfwd=-120, lhang=20, lbend=50, lcurl=0, stag=0.06, wide=0.05, drop=-0.20,
           lfl=0.24, rfl=0.20, lfz=30, rfz=34, jaw=18, tlift=26, nod=-10)
S3_HIT = st(gy=-24, gr=0.46, gh=0.66, by=-14, bp=-52, ey=0, ep=-90, py=-110, pp=-30,
            tw=0, lean=30, lfwd=40, lhang=72, lbend=20, lcurl=-20, stag=0.15, wide=0.10, drop=0.20,
            jaw=34, tlift=30, nod=6, kp=0.4)


def slash_3(ctx, t):
    """The finisher: a hopping overhead chop that slams the blade into the ground in front. Starts in
    Slash_2's follow-through. Rise 0.0 to 0.22 (both feet leave the ground), chop 0.22 to 0.31 (impact
    0.30, the blade hits the ground about 1.1 m ahead), squash and hold to 0.40, recover by 0.52."""
    if t < 0.22:
        k = ss(0.0, 0.22, t)
        p = mix(S3_START, S3_UP, k)
        # the hop: up during the rise, the feet tuck
        e = ease_out(t / 0.22)
        for key in ("drop", "lfl", "rfl"):
            p[key] = lerp(S3_START[key], S3_UP[key], e)
    elif t < 0.31:
        x = (t - 0.22) / 0.09
        p = mix(S3_UP, S3_HIT, x ** 1.6)
    else:
        sq = spring(t, 0.31, 1.0, 2.5, 8.0)
        p = dict(S3_HIT)
        p["drop"] += 0.03 * sq
        p["gh"] -= 0.02 * sq
        p = mix(p, READY, ss(0.40, 0.52, t))
    return pose_of(ctx, p)


# ----------------------------------------------------------------- heavy attack

HEAVY_COIL = st(gy=-128, gr=0.34, gh=0.72, by=-172, bp=-18, ey=90, ep=0, py=-130, pp=-30,
                tw=-58, lean=20, side=-6, lfwd=-80, lhang=28, lbend=20, lcurl=0, stag=0.16, wide=0.12,
                drop=0.17, fturn=20, kp=0.45, jaw=0, tlift=20, nod=4)


def heavy_charge(ctx, t):
    """Hold: coiled low with the blade hidden behind the right hip, the free wing pointing at the target,
    trembling with power. Loops (1.0 s); first enter it from READY with a 0.15 s crossfade."""
    T = 1.0
    p = dict(HEAVY_COIL)
    tremble = math.sin(TAU * 8 * t / T)
    breath = math.sin(TAU * t / T)
    p["gh"] += 0.006 * tremble
    p["by"] += 1.5 * tremble
    p["tw"] += 1.0 * tremble - 2.0 * breath
    p["drop"] += 0.01 * breath
    p["twag"] = 6 * math.sin(TAU * 4 * t / T)
    p["jaw"] = 4 + 3 * breath
    return pose_of(ctx, p)


SPIN_OUT = st(gy=-20, gr=0.46, gh=0.84, by=-6, bp=-6, ey=90, ep=0, py=-90, pp=-50,
              tw=-10, lean=14, side=8, lfwd=0, lhang=8, lbend=8, lcurl=0, stag=0.12, wide=0.12,
              drop=0.12, fturn=16, kp=0.4, jaw=28, tlift=20)
SPIN_END = st(gy=40, gr=0.40, gh=0.82, by=96, bp=-16, ey=90, ep=0, py=-60, pp=-70,
              tw=40, lean=16, lfwd=36, lhang=58, lbend=24, lcurl=-20, stag=0.12, wide=0.11, drop=0.12,
              kp=0.4, jaw=10, twag=24)
HEAVY_EVENTS = dict(activeStart=0.04, impact=0.09, activeEnd=0.44, recover=0.50)


def heavy_release(ctx, t):
    """A full 360 degree spin cut at belly height, the blade straight out (the reach of the whole move).
    Unwind from the coil 0.0 to 0.10, spin 0.10 to 0.40 (the whole body turns once, to the left, the
    blade sweeping every direction; impact 0.09 when it first passes the front, again at 0.42), follow through to 0.48,
    recover by 0.60. Starts in Heavy_Charge's pose."""
    if t < 0.10:
        p = mix(HEAVY_COIL, SPIN_OUT, ss(0.0, 0.10, t))
        p["yaw"] = lerp(0.0, 35.0, ss(0.0, 0.10, t) ** 2)
    elif t < 0.40:
        x = (t - 0.10) / 0.30
        p = dict(SPIN_OUT)
        p["yaw"] = 35.0 + 325.0 * x               # spins left (counter-clockwise from above)
        p["jaw"] = 28
        p["lfwd"] = -10 * math.sin(math.pi * x)
        p["drop"] = SPIN_OUT["drop"] - 0.03 * math.sin(math.pi * x)
        p["lfl"] = 0.05 * math.sin(math.pi * min(1.0, x * 2))
        p["rfl"] = 0.05 * math.sin(math.pi * max(0.0, x * 2 - 1))
    else:
        k = ss(0.40, 0.47, t)
        p = mix(SPIN_OUT, SPIN_END, k)
        p["yaw"] = 360.0
        p = mix(p, dict(READY, yaw=360.0), ss(0.48, 0.60, t))
    return pose_of(ctx, p)


# ----------------------------------------------------------------- dash

DASH_CROUCH = st(gy=-60, gr=0.36, gh=0.78, by=-150, bp=-10, ey=0, ep=90, py=-120, pp=-30,
                 tw=-20, lean=22, lfwd=-30, lhang=40, lbend=30, drop=0.14, stag=0.10, kp=0.4, tlift=14)
DASH_FLY = st(gy=-88, gr=0.34, gh=0.86, by=-168, bp=8, ey=0, ep=90, py=-120, pp=-25,
              tw=-24, lean=40, lfwd=-70, lhang=55, lbend=10, lcurl=0, drop=0.02, stag=0.22, wide=0.05,
              lfl=0.16, rfl=0.22, lfz=-10, rfz=50, kp=0.5, jaw=16, tlift=32, nod=-10)
DASH_DISTANCE = 3.0          # meters the sim moves the duck over the clip (no root motion in the clip)
DASH_MOVE = (0.03, 0.20)     # the move runs between these times; see dash_progress()


def dash_progress(t):
    """Fraction of DASH_DISTANCE covered at time t: a burst that starts fast and eases to a stop."""
    a, b = DASH_MOVE
    x = max(0.0, min(1.0, (t - a) / (b - a)))
    return 1 - (1 - x) ** 2.2


def dash(ctx, t):
    """A low forward lunge, both feet off the ground, the blade trailing low behind ready for a cut.
    Crouch 0.0 to 0.04, fly 0.04 to 0.17, land into READY by 0.25 (the last frame is READY)."""
    if t < 0.04:
        p = mix(READY, DASH_CROUCH, ss(0.0, 0.04, t))
    elif t < 0.17:
        p = mix(DASH_CROUCH, DASH_FLY, ss(0.04, 0.10, t))
    else:
        land = dict(DASH_CROUCH)
        land.update(gy=READY["gy"], gr=READY["gr"], gh=READY["gh"], by=READY["by"], bp=READY["bp"],
                    ey=READY["ey"], ep=READY["ep"], py=READY["py"], pp=READY["pp"])
        k = ss(0.17, 0.21, t)
        p = mix(DASH_FLY, land, k)
        p = mix(p, READY, ss(0.21, 0.25, t))
    return pose_of(ctx, p)


# ----------------------------------------------------------------- quack shockwave

QUACK_INHALE = st(gy=-100, gr=0.44, gh=1.02, by=-125, bp=-20, ey=0, ep=-90, py=-110, pp=-20,
                  tw=-4, lean=-18, lfwd=-6, lhang=-12, lbend=12, lcurl=0, drop=0.01, stag=0.06,
                  lfl=0.20, lfz=16, kp=0.5, jaw=6, tlift=40, nod=-16)
QUACK_BLAST = st(gy=-100, gr=0.46, gh=0.80, by=-128, bp=-30, ey=0, ep=-90, py=-110, pp=-40,
                 tw=0, lean=24, lfwd=10, lhang=40, lbend=8, lcurl=0, drop=0.12, stag=0.10, wide=0.10,
                 kp=0.5, jaw=44, tlift=36, nod=10)
QUACK_EVENTS = dict(impact=0.24, recover=0.38)


def quack_shockwave(ctx, t):
    """The duck puffs up (leans back, wings flung up and out, left foot raised), then stomps and lets out
    a huge quack, bill wide open, wings thrown down: the shockwave leaves the feet at the impact (0.24 s).
    Hold the quack to 0.36, recover to READY by 0.50."""
    if t < 0.18:
        p = mix(READY, QUACK_INHALE, ss(0.0, 0.18, t))
    elif t < 0.24:
        p = mix(QUACK_INHALE, QUACK_BLAST, ((t - 0.18) / 0.06) ** 1.5)
    else:
        p = dict(QUACK_BLAST)
        sq = spring(t, 0.24, 1.0, 3.0, 7.0)
        p["drop"] += 0.03 * sq
        p["jaw"] += 4 * math.sin(TAU * 9 * (t - 0.24)) * (1 - ss(0.30, 0.38, t))
        p = mix(p, READY, ss(0.36, 0.50, t))
    return pose_of(ctx, p)


# ----------------------------------------------------------------- ultimate

ULT_POSE = st(gy=-96, gr=0.36, gh=1.20, by=-60, bp=82, ey=0, ep=-90, py=-95, pp=-45,
              tw=-10, lean=-16, side=-8, lfwd=-20, lhang=-30, lbend=10, lcurl=0, drop=0.02, stag=0.05, wide=0.10,
              jaw=40, tlift=40, nod=-22)
STORM = st(gy=-34, gr=0.44, gh=0.92, by=-36, bp=-4, ey=90, ep=0, py=-100, pp=-45,
           tw=-6, lean=10, side=10, lfwd=-10, lhang=10, lbend=6, lcurl=0, drop=0.08, stag=0.05, wide=0.06,
           kp=0.3, jaw=20, tlift=24)
ULT_EVENTS = dict(flash=0.24)


def ultimate(ctx, t):
    """Blade storm activation: crouch, then the katana shoots up to the sky, bill wide open in a battle
    quack (flash at 0.24 s), then it drops into the spin stance (the last frame is Ultimate_Spin's first)."""
    crouch = dict(READY, drop=0.16, lean=20, gh=0.80, bp=10, jaw=0)
    if t < 0.08:
        p = mix(READY, crouch, ss(0.0, 0.08, t))
    elif t < 0.26:
        p = mix(crouch, ULT_POSE, ease_out((t - 0.08) / 0.12))
        if t > 0.20:
            p["gh"] += 0.02 * spring(t, 0.20, 1.0, 4.0, 10.0)
    else:
        p = mix(ULT_POSE, STORM, ss(0.30, 0.40, t))
    return pose_of(ctx, p)


ULT_SPIN_SECONDS = 0.4


def ultimate_spin(ctx, t):
    """Blade storm loop: one full turn to the left per 0.4 s, blade straight out at belly height, small
    hops on alternate feet. Loops exactly (the body ends where it started, one turn on)."""
    x = t / ULT_SPIN_SECONDS
    p = dict(STORM)
    p["yaw"] = 360.0 * x
    hop = abs(math.sin(TAU * x))
    p["drop"] = STORM["drop"] - 0.03 * hop
    p["lfl"] = 0.06 * max(0.0, math.sin(TAU * x))
    p["rfl"] = 0.06 * max(0.0, -math.sin(TAU * x))
    p["bp"] += 4 * math.sin(TAU * 2 * x)
    p["twag"] = 18 * math.sin(TAU * 2 * x)
    return pose_of(ctx, p)


# ----------------------------------------------------------------- draw and sheathe (upper body)


def relaxed_upper(ctx):
    """The duck's own Idle (t = 0) upper body: the pose Draw starts from and Sheathe ends in."""
    return dclips.idle(ctx.base, 0.0)


def _seat_world(ctx, M):
    return M[ctx.saya_bone] @ ctx.seat_local


def _upper_with_hand(ctx, pose, K_fn, pole):
    """Replace the right arm of an upper-body pose: IK to the katana frame given by K_fn(M), solved after
    the spine (two passes: solve without the arm, then place the hand)."""
    M, _ = solve(ctx.sk, pose)
    K = K_fn(M)
    pose.ik["RightHand"] = (K @ ctx.attach_inv, pole, "arm")
    gc = holds.GRIP_CURL
    for k in (1, 2, 3):
        pose.local.pop(f"RightHandIndex{k}", None)
        pose.local.pop(f"RightHandMiddle{k}", None)
        pose.local.pop(f"RightHandThumb{k}", None)
    pose.fingers("Right", gc["index"], gc["middle"], gc["thumb"])
    pose.katana = K
    return pose


def _upper_blend(ctx, a, b, k):
    """Blend two poses' upper-body rotations (Spine and below) and their hips offsets."""
    out = Pose()
    for name in set(a.rot) | set(b.rot):
        qa = a.rot.get(name, Quaternion())
        qb = b.rot.get(name, Quaternion())
        if qa.dot(qb) < 0:
            qb = -qb
        out.rot[name] = qa.slerp(qb, k)
    for name in set(a.local) | set(b.local):
        qa = a.local.get(name, Quaternion())
        qb = b.local.get(name, Quaternion())
        out.local[name] = qa.slerp(qb, k)
    out.hips = a.hips.lerp(b.hips, k)
    for side in ("Left", "Right"):
        for key in (side + "Foot",):
            src = b.ik.get(key) or a.ik.get(key)
            if src:
                out.ik[key] = src
    return out


DRAW_EVENTS = dict(grab=round(4 / FPS, 4), ready=round(13 / FPS, 4))   # on frames: the hand-over is exact
SHEATHE_EVENTS = dict(release=0.30)
PULL = 0.24          # how far the katana slides out along the scabbard before it swings over


def _reach_pose(ctx, k):
    """Upper body reaching over the right shoulder: twist right, shrug, the free wing out for balance."""
    p = Pose()
    p.add("Spine", rz=-14 * k, ry=-6 * k, rx=4 * k)
    p.add("Spine1", rz=-14 * k, ry=-6 * k)
    p.add("Spine2", rz=-10 * k)
    p.add("RightShoulder", ry=-14 * k, rx=6 * k)
    p.add("Neck", rz=16 * k, rx=-4 * k)
    p.add("Head", rz=12 * k)
    p.side("Left", "Arm", rx=-30 * k, ry=40)
    p.side("Left", "ForeArm", rz=-30)
    p.fingers("Left", -8, -10, -4)
    return p


def draw(ctx, t):
    """Upper body. The right hand reaches over the shoulder to the handle (grab 0.14 s: move the katana
    from the scabbard's KatanaSeat to the hand, they coincide), slides it out along the scabbard, whips it
    over the shoulder and down into the ready stance (READY's upper body from 0.45 s)."""
    relaxed = relaxed_upper(ctx)
    reach = _reach_pose(ctx, 1.0)
    ready = pose_of(ctx, READY, upper_only=True)
    ready_K = ready.katana
    if t <= DRAW_EVENTS["grab"]:
        k = ss(0.0, DRAW_EVENTS["grab"], t)
        base = _upper_blend(ctx, relaxed, reach, k)
        if t <= 0.0:
            return relaxed
        # the hand travels from where it hangs to the handle (katana not yet in hand: aim the grip at the seat)
        M0, _ = solve(ctx.sk, relaxed)
        hang = M0["RightHand"] @ ctx.attach
        return _upper_with_hand(ctx, base, lambda M: blend_m(hang, _seat_world(ctx, M), k), Vector((-1, 0.6, -0.4)))
    if t <= 0.24:
        k = ss(DRAW_EVENTS["grab"], 0.24, t)
        base = _reach_pose(ctx, 1.0)
        return _upper_with_hand(ctx, base, lambda M: Matrix.Translation(
            (_seat_world(ctx, M).to_3x3() @ Vector((0, 0, -PULL * k)))) @ _seat_world(ctx, M), Vector((-1, 0.6, -0.2)))
    # over the shoulder and down into the ready guard
    k = ss(0.24, DRAW_EVENTS["ready"], t)
    base = _upper_blend(ctx, reach, ready, k)

    def K_fn(M):
        out = Matrix.Translation(_seat_world(ctx, M).to_3x3() @ Vector((0, 0, -PULL))) @ _seat_world(ctx, M)
        # pass through a high point beside the head, blade up, so the swing reads as a flourish
        high = kframe((-0.42, -0.10, 1.16), dirv(-30, 70), dirv(-30, -20))
        if k < 0.45:
            return blend_m(out, high, ss(0.0, 0.45, k))
        return blend_m(high, ready_K, ss(0.45, 1.0, k))
    pole = Vector((-1.0, 0.5, -0.4)).lerp(Vector(dirv(READY["py"], READY["pp"])), k)
    return _upper_with_hand(ctx, base, K_fn, pole)


def sheathe(ctx, t):
    """Upper body. From the ready guard the blade swings up beside the head, the tip finds the scabbard
    behind the shoulder and the katana slides home (release 0.30 s: move it back to KatanaSeat), then the
    arm drops into the duck's relaxed Idle by 0.50 s."""
    relaxed = relaxed_upper(ctx)
    reach = _reach_pose(ctx, 1.0)
    ready = pose_of(ctx, READY, upper_only=True)
    ready_K = ready.katana
    rel = SHEATHE_EVENTS["release"]
    if t < rel:
        k = ss(0.0, rel, t)
        base = _upper_blend(ctx, ready, reach, ss(0.0, 0.18, t))

        def K_fn(M):
            seat = _seat_world(ctx, M)
            out = Matrix.Translation(seat.to_3x3() @ Vector((0, 0, -PULL))) @ seat
            high = kframe((-0.42, -0.10, 1.16), dirv(-30, 70), dirv(-30, -20))
            if t < 0.14:
                return blend_m(ready_K, high, ss(0.0, 0.14, t))
            if t < 0.22:
                return blend_m(high, out, ss(0.14, 0.22, t))
            return blend_m(out, seat, ss(0.22, rel, t))
        pole = Vector(dirv(READY["py"], READY["pp"])).lerp(Vector((-1.0, 0.5, -0.3)), k)
        return _upper_with_hand(ctx, base, K_fn, pole)
    # empty hand back down to the relaxed hang
    k = ss(rel, 0.50, t)
    base = _upper_blend(ctx, reach, relaxed, k)
    if k >= 1.0:
        return relaxed
    M0, _ = solve(ctx.sk, relaxed)
    hang = M0["RightHand"] @ ctx.attach
    return _upper_with_hand(ctx, base, lambda M: blend_m(_seat_world(ctx, M), hang, k), Vector((-1, 0.6, -0.4)))


# ----------------------------------------------------------------- registry and contract data


def registry():
    """name -> (fn(ctx, t), frames, loop, layer)."""
    return {
        "Katana_Idle": (katana_idle, 60, True, FULL),
        "Katana_Run": (katana_run, 11, True, UPPER),
        "Slash_1": (slash_1, 12, False, FULL),
        "Slash_2": (slash_2, 13, False, FULL),
        "Slash_3": (slash_3, 16, False, FULL),
        "Heavy_Charge": (heavy_charge, 30, True, FULL),
        "Heavy_Release": (heavy_release, 18, False, FULL),
        "Dash": (dash, 8, False, FULL),
        "Quack_Shockwave": (quack_shockwave, 15, False, FULL),
        "Ultimate": (ultimate, 12, False, FULL),
        "Ultimate_Spin": (ultimate_spin, 12, True, FULL),
        "Draw": (draw, 14, False, UPPER),
        "Sheathe": (sheathe, 15, False, UPPER),
    }


EVENTS = {
    **{k: {n: v for n, v in e.items() if v is not None} for k, e in SLASH_EVENTS.items()},
    "Heavy_Release": HEAVY_EVENTS,
    "Quack_Shockwave": QUACK_EVENTS,
    "Ultimate": ULT_EVENTS,
    "Draw": DRAW_EVENTS,
    "Sheathe": SHEATHE_EVENTS,
    "Dash": {"moveStart": DASH_MOVE[0], "moveEnd": DASH_MOVE[1]},
}

# Which clip each one is meant to follow (crossfade from) and where it leaves the duck.
FLOW = {
    "Katana_Idle": "loop; the base of every katana move",
    "Katana_Run": "loop over Run_* or Sprint (upper layer); sync its time to the run's phase",
    "Slash_1": "from Katana_Idle or Katana_Run; recovers to Katana_Idle",
    "Slash_2": "from Slash_1 inside its combo window; recovers to Katana_Idle",
    "Slash_3": "from Slash_2 inside its combo window; recovers to Katana_Idle",
    "Heavy_Charge": "loop while the heavy button is held (enter from Katana_Idle with a 0.15 s crossfade)",
    "Heavy_Release": "from Heavy_Charge on release; recovers to Katana_Idle",
    "Dash": "from anything with the katana out; ends in Katana_Idle",
    "Quack_Shockwave": "from anything with the katana out; recovers to Katana_Idle",
    "Ultimate": "activation; ends in Ultimate_Spin's first pose",
    "Ultimate_Spin": "loop for the blade storm's duration; leave to Katana_Idle with a 0.1 s crossfade",
    "Draw": "from the unarmed upper body (Idle); ends in Katana_Idle's upper body",
    "Sheathe": "from Katana_Idle's upper body; ends in the unarmed Idle upper body",
}
