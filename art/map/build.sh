#!/bin/sh
# Rebuild the Qwakk WWII map art: prop kit (GLBs with LODs, compression, colliders.json, manifest.json, renders),
# the map placement data (export/map_v1.json + heights) and the top-down map render,
# and the Canard Quarter deathmatch arena (export/canard-quarter/, renders/canard-quarter/).
# Usage: sh qwakk-game/art/map/build.sh [--no-render] [--quick] [--only NAME] [--shots sheet,closeups,colliders,street,plane] [--no-map]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
PYTHON="${PYTHON:-python3}"
NO_MAP=0
NO_RENDER=0
for a in "$@"; do
  [ "$a" = "--no-map" ] && NO_MAP=1
  [ "$a" = "--no-render" ] && NO_RENDER=1
done
"$BLENDER" -b --factory-startup -P "$HERE/blender/build_props.py" -- "$@"
# compress the GLBs for the client (meshopt + quantization) and verify them with three's MeshoptDecoder
if [ ! -d "$HERE/tools/node_modules" ]; then
  (cd "$HERE/tools" && npm ci --no-audit --no-fund)
fi
PROPS="$HERE/../../apps/client/public/models/props"
node "$HERE/tools/compress.mjs" "$HERE/export/glb_src" "$PROPS" "$PROPS/manifest.json"
cp "$PROPS/manifest.json" "$HERE/export/manifest.json"
if [ "$NO_MAP" = 0 ]; then
  "$PYTHON" "$HERE/layout/gen_map.py"
  # the deathmatch arena (export/canard-quarter/), same kit
  "$PYTHON" "$HERE/layout/gen_quarter.py"
  if [ "$NO_RENDER" = 0 ]; then
    "$BLENDER" -b --factory-startup -P "$HERE/blender/render_map.py" -- "$@"
    "$BLENDER" -b --factory-startup -P "$HERE/blender/render_arena.py" -- --map canard-quarter "$@"
  fi
fi
