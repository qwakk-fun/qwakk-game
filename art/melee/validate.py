"""Check the published melee files against the asset contract in art/melee/README.md.

Plain Python (no Blender):  python3 qwakk-game/art/melee/validate.py
Exits non-zero on any problem.
"""

import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
MODELS = os.path.join(REPO, "apps", "client", "public", "models")
OUT = os.path.join(MODELS, "melee")

CLIPS = {"Katana_Idle": 2.0, "Katana_Run": 0.367, "Slash_1": 0.4, "Slash_2": 0.433, "Slash_3": 0.533,
         "Heavy_Charge": 1.0, "Heavy_Release": 0.6, "Dash": 0.267, "Quack_Shockwave": 0.5, "Ultimate": 0.4,
         "Ultimate_Spin": 0.4, "Draw": 0.467, "Sheathe": 0.5}
UPPER = ("Katana_Run", "Draw", "Sheathe")
LOOPS = ("Katana_Idle", "Katana_Run", "Heavy_Charge", "Ultimate_Spin")
KATANA_NODES = ("Katana", "Blade", "Grip", "TrailStart", "TrailEnd", "Tip", "Scabbard", "KatanaSeat")
FX_NODES = ("SlashArc", "Shockwave", "EliteRing", "Feather")
BUDGET = {"katana": 2500, "scabbard": 1200, "fx_each": 900}


def read(path):
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + n])
    off = 20 + n
    blen = struct.unpack("<I", data[off:off + 4])[0]
    return doc, data[off + 8:off + 8 + blen]


def floats(doc, blob, acc):
    a = doc["accessors"][acc]
    view = doc["bufferViews"][a["bufferView"]]
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    return struct.unpack_from("<%df" % (a["count"] * width), blob, start)


def tris(doc, node):
    return sum(doc["accessors"][p["indices"]]["count"] // 3 for p in doc["meshes"][node["mesh"]]["primitives"])


def subtree(doc, root):
    nodes = doc["nodes"]
    idx = next(i for i, n in enumerate(nodes) if n.get("name") == root)
    out, stack = set(), [idx]
    while stack:
        i = stack.pop()
        out.add(nodes[i]["name"])
        stack.extend(nodes[i].get("children", []))
    return out


def main():
    problems, report = [], {}

    # ---- katana.glb
    doc, _ = read(os.path.join(OUT, "katana.glb"))
    nodes = {n.get("name"): n for n in doc["nodes"]}
    for n in KATANA_NODES:
        if n not in nodes:
            problems.append(f"katana.glb: missing node {n}")
    if not problems:
        kat = nodes["Katana"]
        kids = {doc["nodes"][i]["name"] for i in kat.get("children", [])}
        for n in ("Blade", "Grip", "TrailStart", "TrailEnd", "Tip"):
            if n not in kids:
                problems.append(f"katana.glb: {n} is not a child of Katana")
        if "KatanaSeat" not in {doc["nodes"][i]["name"] for i in nodes["Scabbard"].get("children", [])}:
            problems.append("katana.glb: KatanaSeat is not a child of Scabbard")
        for n in ("Katana", "Scabbard"):
            if any(k in nodes[n] for k in ("translation", "rotation", "scale", "matrix")):
                problems.append(f"katana.glb: {n} has a transform; it must sit at the origin")
        if any(k in nodes["Grip"] for k in ("translation", "rotation", "scale")):
            problems.append("katana.glb: Grip must be at the Katana origin")
        k_tris = tris(doc, kat) + tris(doc, nodes["Blade"])
        s_tris = tris(doc, nodes["Scabbard"])
        report["katana"] = {"triangles": k_tris, "scabbard": s_tris, "bytes": os.path.getsize(os.path.join(OUT, "katana.glb"))}
        if k_tris > BUDGET["katana"]:
            problems.append(f"katana {k_tris} triangles over {BUDGET['katana']}")
        if s_tris > BUDGET["scabbard"]:
            problems.append(f"scabbard {s_tris} triangles over {BUDGET['scabbard']}")
        tip = nodes["Tip"].get("translation", [0, 0, 0])
        if tip[1] < 0.8:
            problems.append(f"katana.glb: Tip {tip} is not up the blade (+Y)")

    # ---- duck_melee_anims.glb: the classic duck's joints, every clip, track rules
    duck, _ = read(os.path.join(MODELS, "duck.glb"))
    joints = [duck["nodes"][i]["name"] for i in duck["skins"][0]["joints"]]
    doc, blob = read(os.path.join(OUT, "duck_melee_anims.glb"))
    names = [n.get("name") for n in doc["nodes"]]
    upper = subtree(doc, "Spine")
    clips = {}
    for a in doc.get("animations", []):
        dur = max(doc["accessors"][s["input"]]["max"][0] for s in a["samplers"])
        clips[a["name"]] = round(dur, 3)
        for ch in a["channels"]:
            node, path = names[ch["target"]["node"]], ch["target"]["path"]
            if node not in joints:
                problems.append(f"{a['name']}: animates {node}, not a duck.glb joint")
            if path == "scale" or (path == "translation" and (node != "Hips" or a["name"] in UPPER)):
                problems.append(f"{a['name']}: {path} track on {node}")
            if a["name"] in UPPER and node not in upper:
                problems.append(f"{a['name']}: upper clip animates {node}")
            if a["name"] in LOOPS and path == "rotation":
                out = floats(doc, blob, a["samplers"][ch["sampler"]]["output"])
                first, last = out[:4], out[-4:]
                d = min(max(abs(x - y) for x, y in zip(first, last)), max(abs(x + y) for x, y in zip(first, last)))
                if d > 2e-3:
                    problems.append(f"{a['name']}: loop does not close on {node} ({d:.4f})")
    for c, secs in CLIPS.items():
        if c not in clips:
            problems.append(f"missing clip {c}")
        elif abs(clips[c] - secs) > 0.02:
            problems.append(f"clip {c} is {clips[c]} s, expected {secs}")
    extra = sorted(set(clips) - set(CLIPS))
    if extra:
        problems.append(f"unexpected clips {extra}")
    report["clips"] = clips
    report["anims_bytes"] = os.path.getsize(os.path.join(OUT, "duck_melee_anims.glb"))

    # ---- melee_fx.glb
    doc, _ = read(os.path.join(OUT, "melee_fx.glb"))
    nodes = {n.get("name"): n for n in doc["nodes"]}
    report["fx"] = {}
    for n in FX_NODES:
        if n not in nodes or "mesh" not in nodes[n]:
            problems.append(f"melee_fx.glb: missing mesh {n}")
            continue
        t = tris(doc, nodes[n])
        report["fx"][n] = t
        if t > BUDGET["fx_each"]:
            problems.append(f"melee_fx.glb: {n} {t} triangles over {BUDGET['fx_each']}")
        if n != "Feather":
            attrs = doc["meshes"][nodes[n]["mesh"]]["primitives"][0]["attributes"]
            if "COLOR_0" not in attrs or "TEXCOORD_0" not in attrs:
                problems.append(f"melee_fx.glb: {n} needs COLOR_0 and TEXCOORD_0")

    # ---- melee.json
    with open(os.path.join(OUT, "melee.json")) as f:
        man = json.load(f)
    if set(man.get("clips", {})) != set(CLIPS):
        problems.append("melee.json: clip list differs from duck_melee_anims.glb")
    for c, info in man.get("clips", {}).items():
        ev = info.get("events", {})
        for k, v in ev.items():
            if not 0 <= v <= info["seconds"] + 1e-6:
                problems.append(f"melee.json: {c} event {k} {v} outside the clip")
        order = [ev[k] for k in ("activeStart", "impact", "activeEnd") if k in ev]
        if order != sorted(order):
            problems.append(f"melee.json: {c} active window out of order")
        if "comboOpen" in ev and not ev["activeEnd"] - 0.03 <= ev["comboOpen"] <= ev["comboClose"] <= info["seconds"]:
            problems.append(f"melee.json: {c} combo window out of order")
    for key in ("katana", "scabbard"):
        a = man.get("attach", {}).get(key, {})
        if len(a.get("position", [])) != 3 or len(a.get("quaternion", [])) != 4 or not a.get("node"):
            problems.append(f"melee.json: attach.{key} incomplete")
    for clip in ("Slash_1", "Slash_2", "Slash_3", "Heavy_Release", "Ultimate_Spin", "Quack_Shockwave"):
        if "suggestedHit" not in man.get("arcs", {}).get(clip, {}):
            problems.append(f"melee.json: no suggested hit for {clip}")
    if len(man.get("dash", {}).get("progress", [])) != 9:
        problems.append("melee.json: dash progress should have 9 frames")
    for name in ("melee.json",):
        with open(os.path.join(OUT, name), encoding="utf-8") as f:
            if chr(0x2014) in f.read():
                problems.append(f"{name} contains an em dash")

    print(json.dumps(report, indent=1))
    for p in problems:
        print("PROBLEM:", p)
    print("VALIDATION", "FAILED" if problems else "OK")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
