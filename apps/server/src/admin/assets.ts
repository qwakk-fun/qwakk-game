/**
 * The built admin UI (apps/admin, `npm run build:admin`), served only to a
 * logged-in admin. It lives outside the public client directory, so the
 * static client handler never sees it, and is read into memory from a fixed
 * table (no path from the request ever touches the disk). Never cached by
 * shared caches.
 */
import { readFileSync } from 'node:fs';
import { scanClientDir } from '../staticClient.ts';

export interface AdminAsset {
  body: Buffer;
  type: string;
}

export class AdminAssets {
  private readonly dir: string;
  private files: Map<string, AdminAsset> | null = null;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Every file of the build by URL path ("/index.html", "/assets/x.js"); empty when not built. */
  private table(): Map<string, AdminAsset> {
    if (this.files && this.files.size > 0) return this.files;
    const out = new Map<string, AdminAsset>();
    try {
      for (const [path, e] of scanClientDir(this.dir)) out.set(path, { body: readFileSync(e.file), type: e.type });
    } catch {
      // Not built: the shell says so.
    }
    this.files = out;
    return out;
  }

  /** The app's HTML shell, or null when the UI is not built. */
  shell(): AdminAsset | null {
    return this.table().get('/index.html') ?? null;
  }

  /** A file under /admin/assets/ by its path below /admin ("/assets/index-1a2b.js"). */
  asset(path: string): AdminAsset | null {
    if (!path.startsWith('/assets/') || path.split('/').some((seg) => seg.startsWith('.'))) return null;
    return this.table().get(path) ?? null;
  }
}
