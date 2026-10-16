/**
 * Serves the built client (apps/client/dist) from the game server, so one
 * container answers the page, the matchmaking, the WebSocket and /api on one
 * origin (play.qwakk.fun). On only when QWAKK_CLIENT_DIR is set (the server
 * image sets it); `npm run dev` keeps Vite on 5173.
 *
 * What it serves, and nothing else:
 *   - files that exist under the client directory, found by a plain lookup
 *     table built at start (no path is ever joined from the request, so
 *     `..`, encoded slashes, dotfiles and symlinks cannot reach anything else:
 *     server source, packages/, .git, .env, node_modules, the navmesh cache
 *     and the migrations are simply not in the table);
 *   - index.html for `/` (the client has no path routes, only query
 *     parameters, so there is no catch-all: anything else unknown is a 404);
 *   - `/game` and `/game/...` redirect to the same path at the root, for links
 *     made for the qwakk.fun/game hosting;
 *   - never the reserved server routes (/api, /health, /matchmake,
 *     /__healthcheck): those fall through to their own handlers.
 *
 * Caching: `assets/` (Vite output with content hashes) is immutable for a
 * year; everything else (index.html, models with fixed names) revalidates
 * with an ETag, so a deploy shows up at once. Precompressed `.br` / `.gz`
 * copies next to a file (made at image build) are sent when the browser
 * accepts them.
 */
import { createReadStream, readdirSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, relative, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Paths owned by the server itself; the client handler never answers them. */
const RESERVED = ['/api', '/health', '/matchmake', '/__healthcheck'];

interface Entry {
  file: string;
  size: number;
  etag: string;
  type: string;
  br: { file: string; size: number } | null;
  gz: { file: string; size: number } | null;
}

/** Every regular file under `dir`, keyed by its URL path ("/assets/x.js"). Dotfiles, symlinks and precompressed copies are left out. */
export function scanClientDir(dir: string): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && !e.name.endsWith('.gz') && !e.name.endsWith('.br') && !e.name.endsWith('.map')) {
        const st = statSync(full);
        const twin = (suffix: string) => {
          try {
            const s = statSync(full + suffix);
            return s.isFile() ? { file: full + suffix, size: s.size } : null;
          } catch {
            return null;
          }
        };
        const urlPath = `/${relative(dir, full).split(sep).join('/')}`;
        out.set(urlPath, {
          file: full,
          size: st.size,
          etag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`,
          type: TYPES[extname(e.name).toLowerCase()] ?? 'application/octet-stream',
          br: twin('.br'),
          gz: twin('.gz'),
        });
      }
    }
  };
  walk(dir);
  return out;
}

/** Paths and queries a `/game/...` redirect may carry: printable ASCII only, no `//` or backslash in the path. */
const SAFE_REDIRECT_PATH = /^\/(?!\/)[A-Za-z0-9._~\/-]*$/;
const SAFE_REDIRECT_QUERY = /^(\?[\x21-\x7e]*)?$/;

function isReserved(path: string): boolean {
  return RESERVED.some((r) => path === r || path.startsWith(`${r}/`));
}

type Next = (err?: unknown) => void;

/** A Node/Express handler for the client files; calls next() for anything it does not serve. */
export function createClientHandler(dir: string): (req: IncomingMessage, res: ServerResponse, next?: Next) => void {
  const files = scanClientDir(dir);
  const index = files.get('/index.html');
  if (!index) throw new Error(`QWAKK_CLIENT_DIR=${dir} has no index.html (build the client first)`);
  console.log(`[web] serving the client from ${dir} (${files.size} files)`);

  return function clientHandler(req, res, next) {
    const pass = (): void => {
      if (next) next();
      else {
        res.statusCode = 404;
        res.end();
      }
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return pass();
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
    } catch {
      return pass();
    }
    if (isReserved(path)) return pass();
    if (path === '/game' || path.startsWith('/game/')) {
      // One leading slash only: `//host` or `/\\host` would send the browser to another site.
      // Browsers also drop tabs and newlines from a Location before parsing it (`/\t/host` is
      // `//host`), so only plain path characters survive; anything else goes to the start page.
      const stripped = `/${path.slice('/game'.length).replace(/^[\\/]+/, '')}`;
      const rest = SAFE_REDIRECT_PATH.test(stripped) ? stripped : '/';
      const raw = req.url ?? '';
      const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
      const query = SAFE_REDIRECT_QUERY.test(q) ? q : '';
      res.statusCode = 301;
      res.setHeader('Location', `${rest}${query}`);
      res.end();
      return;
    }
    // Dot segments (/.env, /.git/config, /../x) are never a client file.
    const dotted = path.split('/').some((seg) => seg.startsWith('.'));
    const entry = dotted ? undefined : files.get(path === '/' ? '/index.html' : path);
    if (!entry) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end('not found\n');
      return;
    }
    send(req, res, entry, path.startsWith('/assets/'));
  };
}

function send(req: IncomingMessage, res: ServerResponse, e: Entry, immutable: boolean): void {
  res.setHeader('Content-Type', e.type);
  res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('ETag', e.etag);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (e.br || e.gz) res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === e.etag) {
    res.statusCode = 304;
    res.end();
    return;
  }
  const accept = String(req.headers['accept-encoding'] ?? '');
  const pick = e.br && /\bbr\b/.test(accept) ? { ...e.br, enc: 'br' } : e.gz && /\bgzip\b/.test(accept) ? { ...e.gz, enc: 'gzip' } : null;
  if (pick) res.setHeader('Content-Encoding', pick.enc);
  res.setHeader('Content-Length', String(pick ? pick.size : e.size));
  res.statusCode = 200;
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(pick ? pick.file : e.file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
