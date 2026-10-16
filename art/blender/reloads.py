"""Magazine-change reloads and the aim-down-sights holds (upper-body clips).

The reloads move a real magazine: the gun's `Mag` node (see weapons.py) leaves the gun, rides in the
left fist, is dropped, a fresh one is taken from the hip pouch and seated. The left fist is placed so the
magazine sits exactly at its seat at the hand-over moments, so the engine can re-parent the node
without a pop. `MAG_EVENTS` is the timeline the engine follows (published in weapons/attach.json).

Clip lengths equal the server's reload times (packages/shared/src/weapons.ts: rifle 2.3 s, pistol 1.6 s).
"""

import math

from mathutils import Matrix, Vector

import clips
import holds
import weapons
from posing import DEG

RELOAD_SECONDS = {"rifle": 2.3, "pistol": 1.6}

# Seconds into the reload clip:
#   out    the magazine leaves the gun (rifle: into the left fist; pistol: it drops free)
#   drop   the old magazine leaves the fist and falls (pistol: same moment as `out`)
#   fresh  a new magazine appears in the left fist, at the pouch
#   in     the new magazine is seated in the gun
MAG_EVENTS = {
    "rifle": {"out": 0.37, "drop": 0.80, "fresh": 1.08, "in": 1.63},
    "pistol": {"out": 0.10, "drop": 0.10, "fresh": 0.43, "in": 0.89},
}


def mag_state(kind, t):
    """Where the magazine is at `t`: 'gun', 'hand' or 'none' (dropped, a fresh one not taken yet)."""
    e = MAG_EVENTS[kind]
    if t < e["out"] or t >= e["in"]:
        return "gun"
    if t < e["drop"]:
        return "hand"
    if t < e["fresh"]:
        return "none"
    return "hand"


def lerp_frame(a, b, u):
    q = a.to_quaternion().slerp(b.to_quaternion(), u)
    m = q.to_matrix().to_4x4()
    m.translation = a.to_translation().lerp(b.to_translation(), u)
    return m


def frame_keys(t, pts):
    """Eased interpolation through (time, 4x4) keys: positions lerp, rotations slerp."""
    if t <= pts[0][0]:
        return pts[0][1]
    for (t0, m0), (t1, m1) in zip(pts, pts[1:]):
        if t <= t1:
            return lerp_frame(m0, m1, clips.ss(t0, t1, t))
    return pts[-1][1]


def slide(m, x=0.0, y=0.0, z=0.0):
    return m @ Matrix.Translation((x, y, z))


def pouch_mag(kind):
    """The fresh magazine at the hip pouch: upright, front turned a little outward."""
    return Matrix.Translation(holds.POUCH) @ Matrix.Rotation(25 * DEG, 4, "Z") @ Matrix.Rotation(-10 * DEG, 4, "X")


# Where the gun goes during a reload: out to the right and a little up, so the magazine change happens
# beside the body where the over-the-shoulder camera sees it (instead of behind the round belly).
RELOAD_SPOT = {
    "rifle": dict(pos=(-0.36, -0.20, 0.80), twist=-62, lean=22),
    "pistol": dict(pos=(-0.33, -0.22, 0.86), twist=-50, lean=18),
}


def spot_at(kind, k):
    """The hold blended from the aim spot (k = 0) to the reload spot (k = 1)."""
    a, b = clips.AIM[kind], RELOAD_SPOT[kind]
    pos = tuple(clips.lerp(x, y, k) for x, y in zip(a["pos"], b["pos"]))
    return dict(pos=pos, rot=a["rot"], twist=clips.lerp(a["twist"], b["twist"], k), lean=clips.lerp(a["lean"], b["lean"], k))


def left_fingers(pose, holding):
    """Left fist curl: tight on a magazine, looser in between."""
    k = holding
    pose.fingers("Left", -14 - 30 * k, -16 - 30 * k, -8 - 12 * k)


def reload_rifle(ctx, t):
    tilt = clips.keys(t, [(0, 0), (0.28, 1), (1.85, 1), (2.15, 0)])
    bump = clips.spring(t, 1.60, 0.010, 4.0, 10.0)
    off = Matrix.Translation((0.0, 0.0, bump)) \
        @ Matrix.Rotation(22 * tilt * DEG, 4, "Y") @ Matrix.Rotation(8 * tilt * DEG, 4, "X")

    def left(gun):
        seat = gun @ weapons.mag_local("rifle")
        fist = lambda m: holds.fist_on_mag(m, "rifle")   # noqa: E731
        support = holds.support_frame(gun, "rifle")
        grab = fist(seat)
        pull = fist(slide(seat, z=-0.08))
        toss = fist(slide(seat, -0.05, 0.02, -0.22) @ Matrix.Rotation(-30 * DEG, 4, "Y"))
        pouch = fist(pouch_mag("rifle"))
        below = fist(slide(seat, z=-0.11))
        seated = fist(slide(seat, z=-0.004))
        pts = [(0.0, support), (0.28, grab), (0.46, grab), (0.62, pull), (0.80, toss), (1.02, pouch), (1.14, pouch),
               (1.40, below), (1.56, seated), (1.70, seated), (1.92, support), (2.3, support)]
        return frame_keys(t, pts)

    def extra(pose):
        hold = clips.keys(t, [(0.20, 0), (0.30, 1), (0.78, 1), (0.84, 0.3), (1.02, 0.4), (1.10, 1), (1.68, 1), (1.80, 0.6)])
        left_fingers(pose, hold)
        look = clips.keys(t, [(0, 0), (0.3, 1), (1.75, 1), (2.1, 0)])
        pose.add("Neck", rx=12 * look, rz=-8 * look)
        pose.add("Head", rx=8 * look)

    pose = clips.weapon_pose(ctx, "rifle", gun_offset=off, left_override=left, extra=extra, spot=spot_at("rifle", tilt))
    pose.mag = mag_state("rifle", t)
    return pose


def reload_pistol(ctx, t):
    tilt = clips.keys(t, [(0, 0), (0.12, 1), (1.25, 1), (1.45, 0)])
    bump = clips.spring(t, 0.86, 0.010, 4.0, 10.0)
    off = Matrix.Translation((0.0, 0.0, bump)) \
        @ Matrix.Rotation(22 * tilt * DEG, 4, "Y") @ Matrix.Rotation(-10 * tilt * DEG, 4, "X")

    def left(gun):
        seat = gun @ weapons.mag_local("pistol")
        fist = lambda m: holds.fist_on_mag(m, "pistol")   # noqa: E731
        support = holds.support_frame(gun, "pistol")
        pouch = fist(pouch_mag("pistol"))
        below = fist(slide(seat, z=-0.10))
        seated = fist(slide(seat, z=-0.025))
        rack = [Matrix.Translation(gun @ Vector(p)) @ support.to_quaternion().to_matrix().to_4x4()
                for p in ((0.03, 0.0, 0.10), (0.03, 0.07, 0.10), (0.04, 0.07, 0.14))]
        pts = [(0.0, support), (0.10, support), (0.36, pouch), (0.50, pouch), (0.70, below), (0.84, seated),
               (0.94, seated), (1.04, rack[0]), (1.14, rack[1]), (1.22, rack[2]), (1.42, support), (1.6, support)]
        return frame_keys(t, pts)

    def extra(pose):
        hold = clips.keys(t, [(0.30, 0.3), (0.40, 1), (0.92, 1), (1.0, 0.6), (1.10, 1), (1.22, 0.5)])
        left_fingers(pose, hold)
        look = clips.keys(t, [(0, 0), (0.15, 1), (1.2, 1), (1.45, 0)])
        pose.add("Neck", rx=10 * look)

    pose = clips.weapon_pose(ctx, "pistol", gun_offset=off, left_override=left, extra=extra, spot=spot_at("pistol", tilt))
    pose.mag = mag_state("pistol", t)
    return pose


# ----------------------------------------------------------------- aim down sights

# Raised, centered holds: the gun comes up toward the eye line and the head leans into the sight.
ADS = {
    "rifle": dict(pos=(-0.15, -0.36, 1.03), rot=(4, 0, 6), twist=-26, lean=7),
    "pistol": dict(pos=(-0.05, -0.45, 1.08), rot=(4, 0, 2), twist=-8, lean=6),
}


def ads_loop(kind):
    def fn(ctx, t):
        breathe = 0.6 * math.sin(clips.TAU * t / 2.0)

        def extra(pose):
            pose.add("Neck", rx=7, rz=-6 if kind == "rifle" else -2)
            pose.add("Head", rx=5, ry=-4 if kind == "rifle" else 0)
        return clips.weapon_pose(ctx, kind, breathe=breathe, extra=extra, spot=ADS[kind])
    return fn


def register(reg):
    frames = {k: round(v * clips.FPS) for k, v in RELOAD_SECONDS.items()}
    reg["Rifle_Reload"] = (reload_rifle, frames["rifle"], False, clips.UPPER)
    reg["Pistol_Reload"] = (reload_pistol, frames["pistol"], False, clips.UPPER)
    reg["Rifle_ADS"] = (ads_loop("rifle"), 60, True, clips.UPPER)
    reg["Pistol_ADS"] = (ads_loop("pistol"), 60, True, clips.UPPER)
