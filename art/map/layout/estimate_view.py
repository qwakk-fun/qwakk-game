"""Estimate the triangles drawn for map_v1 from a camera standing in the village square.

Uses the LOD switch distances in manifest.json and the instance list in map_v1.json. Reports the full 360 degree
total within the view distance (what is loaded around the player) and the worst camera direction with a
100 degree horizontal field of view (what one frame draws), for desktop distances and for phone distances (x 0.6).

  python3 art/map/layout/estimate_view.py [x z] [view_distance]
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MAP_ART = os.path.dirname(HERE)
GAME = os.path.dirname(os.path.dirname(MAP_ART))
EXPORT = os.path.join(MAP_ART, "export")
MANIFEST = os.path.join(GAME, "apps", "client", "public", "models", "props", "manifest.json")


def load_heights(doc):
    t = doc["terrain"]
    n = t["cells"] + 1
    with open(os.path.join(EXPORT, t["heights"]), "rb") as f:
        raw = f.read()
    return [v / 100.0 for v in struct.unpack("<%dh" % (n * n), raw[16:16 + 2 * n * n])], n, t["cellSize"], t["origin"]


def estimate(cx=40.0, cz=-190.0, view=300.0, fov_deg=100.0, scale=1.0):
    with open(os.path.join(EXPORT, "map_v1.json")) as f:
        doc = json.load(f)
    with open(MANIFEST) as f:
        man = json.load(f)["props"]
    hs, n, cs, (ox, oz) = load_heights(doc)
    cy = hs[int(round((cz - oz) / cs)) * n + int(round((cx - ox) / cs))] + 1.6
    items = []
    for p in doc["props"]:
        if p["prop"] == "transport_plane":
            continue
        d = math.sqrt((p["x"] - cx) ** 2 + (p["y"] - cy) ** 2 + (p["z"] - cz) ** 2)
        if d > view:
            continue
        tris = 0
        for lod in man[p["prop"]]["lods"]:
            if d <= lod["until"] * scale:
                tris = lod["triangles"]
                break
        if tris:
            items.append((math.atan2(p["x"] - cx, p["z"] - cz), tris, d))
    terrain = []
    for r in range(n - 1):
        for c in range(n - 1):
            x, z = ox + (c + 0.5) * cs, oz + (r + 0.5) * cs
            if math.hypot(x - cx, z - cz) <= view:
                terrain.append(math.atan2(x - cx, z - cz))
    total = sum(t for _, t, _ in items) + 2 * len(terrain)
    best, best_yaw = 0, 0
    half = math.radians(fov_deg) / 2
    for k in range(36):
        yaw = math.radians(k * 10)

        def inside(a):
            return abs((a - yaw + math.pi) % (2 * math.pi) - math.pi) <= half

        s = sum(t for a, t, d in items if inside(a) or d < 8) + 2 * sum(1 for a in terrain if inside(a))
        if s > best:
            best, best_yaw = s, k * 10
    return {"camera": [cx, round(cy, 2), cz], "view": view, "instances": len(items), "all_around": total, "worst_frame": best,
            "worst_yaw_deg": best_yaw, "terrain_tris_all_around": 2 * len(terrain)}


if __name__ == "__main__":
    args = [float(a) for a in sys.argv[1:]]
    x, z = (args[0], args[1]) if len(args) >= 2 else (40.0, -190.0)
    view = args[2] if len(args) >= 3 else 300.0
    for label, scale in (("desktop", 1.0), ("phone x0.6", 0.6)):
        r = estimate(x, z, view, scale=scale)
        print(f"VIEW {label:11s} {r}")
