/**
 * The game's legal pages on its own origin: /terms, /privacy and /cookies
 * (the storage notice), rendered at build time from docs/legal/*.md into
 * plain branded HTML files with no script (`terms.html`, ... next to
 * index.html; the server maps /terms to terms.html, staticClient.ts). Dev
 * and `vite preview` serve the same pages under the base (/game/terms).
 *
 * Facts the account system owns are filled in here (the version, session
 * length, storage keys); every other `[[PLACEHOLDER]]` stays visible and
 * marked until the owner fills it in docs/legal/.
 */
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { LEGAL_UPDATED, LEGAL_VERSION } from '../../../packages/shared/src/accounts.ts';
import { renderMarkdown } from './markdown.ts';

export const LEGAL_PAGES = ['terms', 'privacy', 'cookies'] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

const DOCS = new URL('../../../docs/legal/', import.meta.url);

/** What the code decides, written into the drafts' placeholders. */
const FACTS: [RegExp, string][] = [
  [/\[\[NOTICE_KEY\]\] \(proposed `qwakk\.storage-notice`\)/g, '`qwakk.storage-notice`'],
  [/\[\[LEGAL_VERSION\]\]/g, LEGAL_VERSION],
  [/\[\[LEGAL_UPDATED\]\]/g, LEGAL_UPDATED],
  [/\[\[SESSION_LIFETIME\]\]/g, '30 days, renewed while you play'],
  [/\[\[ACCOUNT_SESSION_KEY\]\]/g, '`qwakk.account`'],
  [/\[\[NOTICE_KEY\]\]/g, '`qwakk.storage-notice`'],
  [/\[\[COOKIES_NOTICE_URL\]\]/g, 'play.qwakk.fun/cookies'],
  // Verified against the code: only an HMAC of each code is stored, and used, locked or expired codes are deleted.
  [/ ?\[\[VERIFY_CODE_STORAGE\]\]/g, ''],
  // Turnstile guards the code request too when it is configured.
  [/\[\[or request a sign-in code\]\]/g, 'or request a sign-in code'],
];

export function fillFacts(md: string): string {
  return FACTS.reduce((s, [re, v]) => s.replace(re, v), md);
}

const TITLES: Record<LegalPage, string> = { terms: 'Terms of Use', privacy: 'Privacy Policy', cookies: 'Storage notice' };

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = `
:root{color-scheme:dark;--y:#ffd43b;--o:#ff8a3d;--d:#151619;--card:#1d1f24;--line:#2a2d34;--ink:#f4f1e8;--muted:#a8a59c}
*{box-sizing:border-box}
body{margin:0;background:var(--d);color:var(--ink);font:16px/1.65 Geist,"Geist Variable",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
a{color:var(--y)}a:hover{color:var(--o)}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;max-width:860px;margin:0 auto;padding:20px 16px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-weight:800;font-size:20px;letter-spacing:-.02em}
.brand img{width:32px;height:32px}
nav{display:flex;gap:14px;flex-wrap:wrap;font-size:14px}
nav a{color:var(--muted);text-decoration:none}nav a[aria-current=page]{color:var(--y)}
main{max-width:860px;margin:0 auto 48px;padding:8px 16px 32px}
article{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px clamp(16px,4vw,40px)}
h1{font-size:clamp(26px,4vw,36px);line-height:1.15;letter-spacing:-.02em;margin:0 0 8px}
h2{font-size:21px;margin:32px 0 8px;color:var(--y)}h3{font-size:17px;margin:24px 0 6px}h4{font-size:15px;margin:20px 0 6px}
p,li{color:var(--ink)}ul,ol{padding-left:22px}
code{font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;background:#121316;border:1px solid var(--line);border-radius:6px;padding:1px 5px}
pre{overflow:auto;background:#121316;border:1px solid var(--line);border-radius:10px;padding:12px}pre code{border:0;padding:0}
.table{overflow-x:auto;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:14px;min-width:520px}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:8px 10px}
th{color:var(--muted);font-weight:600}
blockquote{margin:12px 0;padding:4px 16px;border-left:3px solid var(--y);color:var(--muted)}
.ph{background:rgba(255,138,61,.16);color:var(--o);border-radius:4px;padding:0 3px}
.draft{display:inline-block;margin:0 0 16px;font-size:13px;color:var(--d);background:var(--y);border-radius:999px;padding:2px 10px;font-weight:700}
footer{max-width:860px;margin:0 auto;padding:0 16px 32px;color:var(--muted);font-size:13px}
`;

/** One legal page as a complete HTML document. `base` is the app's base URL ("/" or "/game/"). */
export function legalPageHtml(page: LegalPage, md: string, base: string): string {
  const body = renderMarkdown(fillFacts(md));
  const nav = LEGAL_PAGES.map((p) => `<a href="${base}${p}"${p === page ? ' aria-current="page"' : ''}>${TITLES[p]}</a>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(TITLES[page])} · Qwakk Island</title>
<meta name="description" content="${esc(TITLES[page])} of the Qwakk browser game.">
<meta name="robots" content="noindex">
<link rel="icon" href="${base}ui/brand-mark.svg" type="image/svg+xml">
<style>${STYLE}</style></head>
<body>
<header><a class="brand" href="${base}"><img src="${base}ui/brand-mark.svg" alt="" width="32" height="32"><span>Qwakk</span></a><nav aria-label="Legal">${nav}<a href="${base}">Back to the game</a></nav></header>
<main><article><span class="draft">Draft, version ${esc(LEGAL_VERSION)}</span>
${body}
</article></main>
<footer>Questions: <a href="mailto:hello@qwakk.fun">hello@qwakk.fun</a></footer>
</body></html>
`;
}

export function readLegal(page: LegalPage): string {
  return readFileSync(new URL(`${page}.md`, DOCS), 'utf8');
}

/** Emit the pages into the build, and serve them in dev and preview at `<base><page>`. */
export function legalPagesPlugin(): Plugin {
  let base = '/';
  const serve = (url: string | undefined): string | null => {
    const path = (url ?? '').split('?')[0]!;
    const page = LEGAL_PAGES.find((p) => path === `${base}${p}` || path === `${base}${p}.html`);
    return page ? legalPageHtml(page, readLegal(page), base) : null;
  };
  const middleware = (req: { url?: string }, res: { setHeader(k: string, v: string): void; end(s: string): void }, next: () => void): void => {
    const html = serve(req.url);
    if (!html) return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  };
  return {
    name: 'qwakk-legal-pages',
    configResolved(config) {
      base = config.base.endsWith('/') ? config.base : `${config.base}/`;
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    generateBundle() {
      for (const page of LEGAL_PAGES) this.emitFile({ type: 'asset', fileName: `${page}.html`, source: legalPageHtml(page, readLegal(page), base) });
    },
  };
}
