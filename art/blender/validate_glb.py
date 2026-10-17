"""Check the published GLBs against the asset contract the engine codes against.

Plain Python (no Blender needed):  python3 qwakk-game/art/blender/validate_glb.py
Exits non-zero on any problem.
"""

import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "apps", "client", "public", "models")

REQUIRED_CLIPS = [
    "Idle", "Walk_F", "Walk_B", "Walk_L", "Walk_R", "Run_F", "Run_B", "Run_L", "Run_R", "Sprint",
    "Crouch_Idle", "Crouch_Walk", "Jump_Start", "Fall_Loop", "Land", "Death_A", "Death_B", "Hit_React",
    "Rifle_Aim", "Pistol_Aim", "Rifle_Reload", "Pistol_Reload",
]
OPTIONAL_CLIPS = ["Rifle_Fire", "Pistol_Fire", "Quack", "Equip", "Rifle_ADS", "Pistol_ADS"]
RELOAD_SECONDS = {"rifle": 2.3, "pistol": 1.6}   # packages/shared/src/weapons.ts reloadTicks / 30
MIXAMO_CORE = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "LeftArm", "LeftForeArm",
               "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg",
               "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase", "Jaw"]
EMPTIES = ["Muzzle", "Grip", "Support", "Eject"]


def read(path):
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack("<I", data[12:16])[0]
    return json.loads(data[20:20 + n])


def read_bin(path):
    """(json, binary chunk) of a GLB."""
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + n])
    off = 20 + n
    blen = struct.unpack("<I", data[off:off + 4])[0]
    return doc, data[off + 8:off + 8 + blen]


def floats(doc, blob, accessor):
    a = doc["accessors"][accessor]
    view = doc["bufferViews"][a["bufferView"]]
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    return struct.unpack_from("<%df" % (a["count"] * width), blob, start)


def skeleton(path):
    """Joint names in skin order, their inverse bind matrices, and the mesh's bounding box."""
    doc, blob = read_bin(path)
    skin = doc["skins"][0]
    names = [doc["nodes"][i]["name"] for i in skin["joints"]]
    ibm = floats(doc, blob, skin["inverseBindMatrices"])
    lo, hi = [1e9] * 3, [-1e9] * 3
    for m in doc["meshes"]:
        for p in m["primitives"]:
            a = doc["accessors"][p["attributes"]["POSITION"]]
            lo = [min(x, y) for x, y in zip(lo, a["min"])]
            hi = [max(x, y) for x, y in zip(hi, a["max"])]
    tris = sum(doc["accessors"][p["indices"]]["count"] // 3 for m in doc["meshes"] for p in m["primitives"])
    return names, ibm, lo, hi, tris


def main():
    problems = []
    report = {}
    duck = read(os.path.join(MODELS, "duck.glb"))
    joints = [duck["nodes"][i]["name"] for i in duck["skins"][0]["joints"]]
    report["duck_joints"] = len(joints)
    report["duck_triangles"] = sum(duck["accessors"][p["indices"]]["count"] // 3
                                   for m in duck["meshes"] for p in m["primitives"])
    if not 6000 <= report["duck_triangles"] <= 10000:
        problems.append("duck.glb triangles outside 6k to 10k")
    missing = [b for b in MIXAMO_CORE if b not in joints]
    if missing:
        problems.append(f"duck.glb missing bones {missing}")

    # Every other character (duck_<id>.glb): the classic's skeleton exactly (same joints, same bind
    # pose, so the same clips, weapon attach and hitboxes), and no part far outside the classic's box.
    c_names, c_ibm, c_lo, c_hi, _ = skeleton(os.path.join(MODELS, "duck.glb"))
    report["characters"] = {}
    for fname in sorted(os.listdir(MODELS)):
        if not (fname.startswith("duck_") and fname.endswith(".glb")) or fname == "duck_anims.glb":
            continue
        names, ibm, lo, hi, tris = skeleton(os.path.join(MODELS, fname))
        report["characters"][fname] = {"triangles": tris, "min": [round(v, 3) for v in lo], "max": [round(v, 3) for v in hi]}
        if names != c_names:
            problems.append(f"{fname} joints differ from duck.glb")
        elif max(abs(a - b) for a, b in zip(ibm, c_ibm)) > 1e-5:
            problems.append(f"{fname} bind pose differs from duck.glb")
        if not 6000 <= tris <= 10000:
            problems.append(f"{fname} triangles {tris} outside 6k to 10k")
        # glTF axes: y up. Accessories stay close: at most 3 cm past the classic sideways and below,
        # and never above the classic's tuft tip.
        for k in (0, 2):
            if lo[k] < c_lo[k] - 0.03 or hi[k] > c_hi[k] + 0.03:
                problems.append(f"{fname} reaches past the classic duck's box on axis {k}")
        if hi[1] > c_hi[1] + 1e-3 or lo[1] < c_lo[1] - 0.01:
            problems.append(f"{fname} is taller or lower than the classic duck")

    anims = read(os.path.join(MODELS, "duck_anims.glb"))
    names = [n.get("name") for n in anims["nodes"]]
    clips = {}
    for a in anims.get("animations", []):
        dur = max(anims["accessors"][s["input"]]["max"][0] for s in a["samplers"])
        targets = {names[c["target"]["node"]] for c in a["channels"]}
        stray = sorted(t for t in targets if t not in joints)
        if stray:
            problems.append(f"{a['name']} animates nodes not in duck.glb: {stray}")
        clips[a["name"]] = {"seconds": round(dur, 3), "channels": len(a["channels"])}
    for c in REQUIRED_CLIPS:
        if c not in clips:
            problems.append(f"missing clip {c}")
    extra = [c for c in clips if c not in REQUIRED_CLIPS + OPTIONAL_CLIPS]
    if extra:
        problems.append(f"unexpected clips {extra}")
    report["clips"] = clips

    for kind in ("rifle", "pistol"):
        g = read(os.path.join(MODELS, "weapons", kind + ".glb"))
        nodes = g["nodes"]
        # The weapon node: the mesh node with children (the magazine is a child mesh node, `Mag`).
        root = [n for n in nodes if "mesh" in n and n.get("children")]
        if len(root) != 1:
            problems.append(f"{kind}.glb should have one weapon mesh node with children")
            continue
        r = root[0]
        mag = [nodes[i] for i in r.get("children", []) if nodes[i].get("name") == "Mag"]
        if not mag or "mesh" not in mag[0]:
            problems.append(f"{kind}.glb missing the Mag mesh node")
        if any(k in r for k in ("translation", "rotation", "scale", "matrix")):
            problems.append(f"{kind}.glb weapon node has a transform; it must sit at the origin")
        children = [nodes[i]["name"] for i in r.get("children", [])]
        for e in EMPTIES:
            if e not in children:
                problems.append(f"{kind}.glb missing empty {e}")
        tris = sum(g["accessors"][p["indices"]]["count"] // 3 for n in [r] + mag for p in g["meshes"][n["mesh"]]["primitives"])
        report[kind] = {"triangles": tris, "empties": {nodes[i]["name"]: nodes[i].get("translation", [0, 0, 0])
                                                       for i in r.get("children", [])}}
        if not 1500 <= tris <= 4000 and kind == "rifle":
            problems.append(f"rifle triangles {tris} outside 1.5k to 4k")
    with open(os.path.join(MODELS, "weapons", "attach.json")) as f:
        attach = json.load(f)
    for kind in ("rifle", "pistol"):
        if kind not in attach or set(attach[kind]) != {"position", "quaternion"}:
            problems.append(f"attach.json missing {kind}")
    report["attach"] = {k: attach[k] for k in ("rifle", "pistol") if k in attach}
    reload = attach.get("reload", {})
    for kind, secs in RELOAD_SECONDS.items():
        r = reload.get(kind)
        if not r:
            problems.append(f"attach.json missing reload.{kind}")
            continue
        if abs(r["seconds"] - secs) > 1e-6:
            problems.append(f"reload.{kind}.seconds {r['seconds']} != server reload {secs}")
        if not 0 <= r["out"] <= r["drop"] <= r["fresh"] <= r["in"] <= r["seconds"]:
            problems.append(f"reload.{kind} events out of order")
        if set(r.get("magInHand", {})) != {"position", "quaternion"}:
            problems.append(f"reload.{kind}.magInHand missing")
        clip = clips.get(("Rifle" if kind == "rifle" else "Pistol") + "_Reload")
        if clip and abs(clip["seconds"] - secs) > 0.02:
            problems.append(f"{kind} reload clip {clip['seconds']} s != server reload {secs} s")
    print(json.dumps(report, indent=1))
    for p in problems:
        print("PROBLEM:", p)
    print("VALIDATION", "FAILED" if problems else "OK")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
