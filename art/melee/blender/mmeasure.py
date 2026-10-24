"""Measure the katana's sweep in every attack clip (hit arcs for the sim) and write melee.json.

All numbers in melee.json are in the duck's model space, glTF axes: Y up, the duck faces +Z, meters,
feet at y = 0, the duck's right is -X. Angles are degrees from the duck's forward, positive to the
duck's RIGHT (clockwise seen from above), the way a player reads a swing.
"""

import math

from mathutils import Matrix, Vector

import katana
import mclips
import mp
from posing import solve, to_basis

SUB = 4     # sample the clip functions at 4x the frame rate (the poses are functions of continuous time)


def blade_points(ctx, fn, t, upper=False):
    """(tip, blade base on the edge) in armature space (Blender) at time t, from the solved right hand.
    `upper`: as an upper-body clip plays alone (only Spine and below are baked; the Hips stay at rest)."""
    pose = fn(ctx, t)
    M, _ = solve(ctx.sk, pose)
    if upper:
        sk = ctx.sk
        basis = to_basis(sk, M)
        R = {}
        for name in sk.order:
            p = sk.parent[name]
            b = Matrix.Identity(4) if name == "Hips" else basis[name]
            R[name] = (R[p] @ sk.rel[name] @ b) if p else (sk.rest[name] @ b)
        M = R
    K = M["RightHand"] @ ctx.attach
    spots = katana_spots()
    return K @ spots["Tip"], K @ spots["TrailStart"], K @ spots["TrailEnd"]


def katana_spots():
    return katana.spots()


def yaw_right(p):
    """Degrees from forward (-Y in Blender), positive to the duck's right (-X)."""
    return math.degrees(math.atan2(-p.x, -p.y))


def to_gltf(p):
    return [round(p.x, 3), round(p.z, 3), round(-p.y, 3)]


def sweep(ctx, name, t0, t1):
    """The blade's sweep between t0 and t1: unwrapped tip yaw path, reach and heights."""
    fn = mclips.registry()[name][0]
    n = max(2, int(round((t1 - t0) * mclips.FPS * SUB)) + 1)
    yaws, reach, inner, ys = [], 0.0, 9.0, []
    prev = None
    unwrap = 0.0
    for i in range(n):
        t = t0 + (t1 - t0) * i / (n - 1)
        tip, base, _end = blade_points(ctx, fn, t)
        y = yaw_right(tip)
        if prev is not None:
            d = y - prev
            if d > 180:
                unwrap -= 360
            elif d < -180:
                unwrap += 360
        prev = y
        yaws.append(y + unwrap)
        reach = max(reach, Vector((tip.x, tip.y)).length)
        inner = min(inner, Vector((base.x, base.y)).length)
        ys += [tip.z, base.z]
    return {
        "fromDeg": round(yaws[0], 1), "toDeg": round(yaws[-1], 1),
        "sweptDeg": round(max(yaws) - min(yaws), 1),
        "reach": round(reach, 3), "inner": round(inner, 3),
        "yMin": round(min(ys), 3), "yMax": round(max(ys), 3),
    }


def arcs(ctx):
    """Per attack clip: the measured sweep over its active window and a suggested hit shape."""
    out = {}
    ev = mclips.EVENTS
    for name in ("Slash_1", "Slash_2", "Heavy_Release"):
        e = ev[name]
        s = sweep(ctx, name, e["activeStart"], e["activeEnd"])
        lo, hi = sorted((s["fromDeg"], s["toDeg"]))
        if s["sweptDeg"] >= 330:
            hit = {"shape": "circle", "radius": round(s["reach"] + 0.25, 2),
                   "note": "full turn: everything within the radius is hit once"}
        else:
            pad = 15.0
            hit = {"shape": "arc", "radius": round(s["reach"] + 0.25, 2),
                   "centerDeg": round((lo + hi) / 2, 1), "halfAngleDeg": round((hi - lo) / 2 + pad, 1),
                   "note": "a pie slice around the duck (radius = blade tip reach + 0.25 m of forgiveness)"}
        out[name] = {"measured": s, "suggestedHit": hit}
    # Slash_3: an overhead chop that hits the ground ahead: a circle around the impact point
    e = ev["Slash_3"]
    s = sweep(ctx, "Slash_3", e["activeStart"], e["activeEnd"])
    tip, base, _ = blade_points(ctx, mclips.registry()["Slash_3"][0], e["impact"])
    mid = (tip + base) * 0.5
    out["Slash_3"] = {"measured": s, "impactTip": to_gltf(tip), "suggestedHit": {
        "shape": "circle", "center": [round(mid.x, 2), round(-mid.y, 2)], "radius": 1.1,
        "note": "a circle on the ground centered between the blade's base and tip at the impact, [x, z] in model space"}}
    # the blade storm: a full circle each turn
    s = sweep(ctx, "Ultimate_Spin", 0.0, mclips.ULT_SPIN_SECONDS)
    out["Ultimate_Spin"] = {"measured": s, "suggestedHit": {
        "shape": "circle", "radius": round(s["reach"] + 0.35, 2),
        "note": "one full turn per 0.4 s; tick damage a few times per turn"}}
    out["Quack_Shockwave"] = {"suggestedHit": {
        "shape": "ring", "radiusFrom": 0.5, "radiusTo": 4.5, "seconds": 0.35,
        "note": "not a blade hit: the shockwave leaves the feet at the impact event and grows; scale melee_fx Shockwave to match"}}
    return out


def tip_path(ctx, name, samples=8):
    """A few blade tip positions (model space) across the clip, for debugging trails."""
    fn, frames, _loop, _layer = mclips.registry()[name]
    T = frames / mclips.FPS
    return [to_gltf(blade_points(ctx, fn, T * i / (samples - 1))[0]) for i in range(samples)]
