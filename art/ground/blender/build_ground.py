"""Build the stylized ground textures for the game terrain.

Each layer (grass, forest floor, dirt, sand, rock, cobble, plowed field, wheat,
green crop) is a 4 m tile of real geometry (blades, leaves, pebbles, stones,
furrows, stalks) built in `layers.py`, wrapped around the tile edges so it
repeats without a seam, and rendered straight down with Cycles: once for the
albedo (soft light plus ambient occlusion baked in) and once for the height.

Outputs (apps/client/public/textures/ground/):
  ground_albedo.webp   512 x (512 * layers), the layers stacked top to bottom
  ground_height.webp   the same layout, height in gray (0 = ground, 1 = the layer's top)
  ground_noise.webp    128 x 128 tiling noise in R, G, B (blend warp, anti-tiling, macro tone)
  ground.json          layer order, mean linear color per layer, tile size
Review sheet: art/ground/renders/ground_sheet.png (each layer tiled 2 x 2).

Run: sh qwakk-game/art/ground/build.sh [--quick] [--only NAME]
"""

import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import pnoise as pn  # noqa: E402
import tile  # noqa: E402
from layers import LAYERS  # noqa: E402

ART = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(ART))
OUT = os.path.join(REPO, "apps", "client", "public", "textures", "ground")
RENDERS = os.path.join(ART, "renders")
WORK = os.path.join(tempfile.gettempdir(), "qwakk-ground")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
QUICK = "--quick" in argv
ONLY = [argv[i + 1] for i, a in enumerate(argv) if a == "--only" and i + 1 < len(argv)]
SAMPLES = 8 if QUICK else 48
ALBEDO_QUALITY = 90
HEIGHT_QUALITY = 60


def load_pixels(path):
    """PNG to a top-down float array (H, W, 4), raw file values."""
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1]


def save_image(path, rgb, quality):
    """Top-down (H, W, 3) floats in file values to PNG or WebP (quality 100 = lossless WebP)."""
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = rgb[::-1]
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = "WEBP" if path.endswith(".webp") else "PNG"
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)


def build_layer(name, fn, seed):
    t0 = time.time()
    tile.reset_scene()
    rng = np.random.default_rng(seed)
    acc = tile.Acc()
    look = fn(acc, rng)
    obj = acc.to_object(name)
    tris = len(obj.data.polygons)
    a_path = os.path.join(WORK, f"{name}_albedo.png")
    h_path = os.path.join(WORK, f"{name}_height.png")
    tile.render_tile(obj, a_path, h_path, look, SAMPLES)
    albedo = load_pixels(a_path)[..., :3]
    height = load_pixels(h_path)[..., 0]
    print(f"ground layer {name}: {tris} triangles, {time.time() - t0:.1f} s")
    return albedo, height


def noise_tile(size=128):
    y, x = np.mgrid[0:size, 0:size] / size
    chans = [pn.equalize(pn.fbm(x, y, 4, 1000 + 17 * i, octaves=4, gain=0.55)) for i in range(3)]
    return np.stack(chans, axis=-1)


def sheet(albedos, cell=384):
    """Each layer tiled 2 x 2 (shows the seams, if any), three per row."""
    cols = 3
    rows = (len(albedos) + cols - 1) // cols
    out = np.full((rows * cell, cols * cell, 3), 0.1, dtype=np.float32)
    for i, a in enumerate(albedos):
        half = cell // 2
        step = a.shape[0] // half
        small = a[::step, ::step][:half, :half]
        tiled = np.tile(small, (2, 2, 1))
        r, c = divmod(i, cols)
        out[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = tiled
    return out


def main():
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(RENDERS, exist_ok=True)
    albedos, heights, meta = [], [], []
    for name, fn, seed, shift in LAYERS:
        cached_a = os.path.join(WORK, f"{name}_albedo.png")
        cached_h = os.path.join(WORK, f"{name}_height.png")
        if ONLY and not any(o in name for o in ONLY) and os.path.exists(cached_a) and os.path.exists(cached_h):
            albedo, height = load_pixels(cached_a)[..., :3], load_pixels(cached_h)[..., 0]
        else:
            albedo, height = build_layer(name, fn, seed)
        albedos.append(albedo)
        heights.append(height)
        mean = tile.srgb_to_linear(albedo.astype(np.float64)).reshape(-1, 3).mean(axis=0)
        meta.append({"name": name, "mean": [round(float(v), 5) for v in mean], "shift": shift})
    save_image(os.path.join(OUT, "ground_albedo.webp"), np.concatenate(albedos, axis=0), ALBEDO_QUALITY)
    hs = np.concatenate(heights, axis=0)
    save_image(os.path.join(OUT, "ground_height.webp"), np.repeat(hs[..., None], 3, axis=2), HEIGHT_QUALITY)
    save_image(os.path.join(OUT, "ground_noise.webp"), noise_tile(), 100)
    info = {
        "version": 1,
        "tileMeters": tile.TILE,
        "size": tile.SIZE,
        "albedo": "ground_albedo.webp",
        "height": "ground_height.webp",
        "noise": "ground_noise.webp",
        "layers": meta,
    }
    with open(os.path.join(OUT, "ground.json"), "w") as f:
        json.dump(info, f, indent=2)
        f.write("\n")
    save_image(os.path.join(RENDERS, "ground_sheet.png"), sheet(albedos), 100)
    for fname in ("ground_albedo.webp", "ground_height.webp", "ground_noise.webp", "ground.json"):
        print(f"  {fname}: {os.path.getsize(os.path.join(OUT, fname)) / 1024:.1f} KB")


main()
