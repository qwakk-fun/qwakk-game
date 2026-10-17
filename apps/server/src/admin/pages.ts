/**
 * The admin login page: self-contained HTML with inline styles and no
 * script at all (a plain form POST), so nothing of the admin app reaches a
 * visitor who is not logged in. The CSP allows exactly this style block (its
 * hash) and nothing else.
 */
import { createHash } from 'node:crypto';

const STYLE = `
:root{color-scheme:dark;--bg:#151619;--card:#1e2024;--line:#33363d;--text:#f3f1ea;--muted:#a3a39b;--yellow:#ffd43b;--orange:#ff8a3d;--red:#ff6b5b}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{min-height:100vh;display:grid;place-items:center;padding:24px 16px}
form{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px;display:grid;gap:16px}
h1{margin:0;font-size:22px;display:flex;align-items:center;gap:10px}
h1 span{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--yellow);color:var(--bg);font-weight:800}
p{margin:0;color:var(--muted);font-size:14px}
label{display:grid;gap:6px;font-size:14px;color:var(--muted)}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:16px}
input:focus{outline:2px solid var(--yellow);outline-offset:1px;border-color:transparent}
input[name=code]{letter-spacing:.3em;font-variant-numeric:tabular-nums}
button{padding:13px;border:0;border-radius:10px;background:var(--yellow);color:var(--bg);font-weight:700;font-size:16px;cursor:pointer}
button:hover{background:#ffe066}
.err{color:var(--red);background:rgba(255,107,91,.1);border:1px solid rgba(255,107,91,.35);border-radius:10px;padding:10px 12px;font-size:14px}
`;

export const LOGIN_STYLE_HASH = `sha256-${createHash('sha256').update(STYLE).digest('base64')}`;

/** CSP for the login page: no scripts, this style only, the form posts to us. */
export const LOGIN_CSP = `default-src 'none'; style-src '${LOGIN_STYLE_HASH}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

const MESSAGES: Record<string, string> = {
  bad: 'Wrong password or code. Try again.',
  locked: 'Too many tries. Wait a while, then try again.',
  expired: 'Your session ended. Log in again.',
};

export function loginPage(error: string | null): string {
  const msg = error ? MESSAGES[error] : undefined;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="same-origin">
<title>Qwakk admin</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<form method="post" action="/admin/login" autocomplete="on">
<h1><span>Q</span>Qwakk admin</h1>
<p>Password and the 6 digit code from your authenticator app.</p>
${msg ? `<div class="err" role="alert">${msg}</div>` : ''}
<label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="1024" autofocus></label>
<label>Code<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
<button type="submit">Log in</button>
</form>
</main>
</body>
</html>`;
}

/** Shown to a logged-in admin when the admin UI was not built. */
export function notBuiltPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Qwakk admin</title><style>${STYLE}</style></head><body><main><form method="post" action="/admin/logout"><h1><span>Q</span>Qwakk admin</h1><p>The admin UI is not built on this server. Run npm run build:admin, or set QWAKK_ADMIN_DIR.</p><button type="submit">Log out</button></form></main></body></html>`;
}
