/**
 * Image build step: write `.br` and `.gz` copies next to the compressible
 * client files, for the game server's static handler (apps/server/src/staticClient.ts).
 * A copy is kept only when it saves at least 5 percent. Node's own zlib, no packages.
 *
 *   node deploy/server/precompress.ts apps/client/dist
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node deploy/server/precompress.ts <dir>');
  process.exit(1);
}
const EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.glb', '.gltf', '.bin', '.wasm', '.txt']);
let before = 0;
let after = 0;
let files = 0;

function walk(d: string): void {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const full = join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && EXT.has(extname(e.name).toLowerCase()) && statSync(full).size > 1024) {
      const raw = readFileSync(full);
      const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
      const gz = gzipSync(raw, { level: 9 });
      if (br.length < raw.length * 0.95) writeFileSync(`${full}.br`, br);
      if (gz.length < raw.length * 0.95) writeFileSync(`${full}.gz`, gz);
      before += raw.length;
      after += Math.min(raw.length, br.length);
      files++;
    }
  }
}

walk(dir);
console.log(`[precompress] ${files} files, ${(before / 1e6).toFixed(1)} MB raw, ${(after / 1e6).toFixed(1)} MB with brotli`);
