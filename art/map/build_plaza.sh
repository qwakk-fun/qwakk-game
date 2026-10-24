#!/bin/sh
# Rebuild the Duck Plaza (the social hub, map id duck-plaza): its own props (blender/props_plaza.py ->
# apps/client/public/models/props/plaza_*.glb, plaza_manifest.json, export/duck-plaza/plaza_colliders.json),
# then the plaza layout (layout/gen_plaza.py -> export/duck-plaza/map_v1.json and the two .bin files).
# Never writes the shared colliders.json, manifest.json or renders/ root (renders go to renders/duck-plaza/).
# Usage: sh qwakk-game/art/map/build_plaza.sh [--no-render] [--quick]
# Then: npm run map:sync
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
PYTHON="${PYTHON:-python3}"
"$BLENDER" -b --factory-startup -P "$HERE/blender/build_plaza_props.py" -- "$@"
if [ ! -d "$HERE/tools/node_modules" ]; then
  (cd "$HERE/tools" && npm ci --no-audit --no-fund)
fi
PROPS="$HERE/../../apps/client/public/models/props"
node "$HERE/tools/compress.mjs" "$HERE/export/duck-plaza/glb_src" "$PROPS" "$PROPS/plaza_manifest.json"
cp "$PROPS/plaza_manifest.json" "$HERE/export/duck-plaza/plaza_manifest.json"
if [ -f "$HERE/layout/gen_plaza.py" ]; then
  "$PYTHON" "$HERE/layout/gen_plaza.py"
fi
