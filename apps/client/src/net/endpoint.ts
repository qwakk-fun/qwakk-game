/**
 * Where the client finds the game server. No imports, so the menu can use it
 * without pulling in the game bundle.
 *
 * VITE_GAME_SERVER when set at build time (the split hosting: client at
 * qwakk.fun/game, server at play.qwakk.fun); else the page's own origin in
 * public builds (one container serves the client and the server at
 * play.qwakk.fun), so one build works on any domain; else, in dev and test
 * builds, the page host on port 2567 (Vite on 5173 next to the server, LAN
 * phones included; VITE_SERVER_PORT at build time picks another port, for
 * running the browser tests while a dev server holds 2567).
 */
export function defaultGameServer(): string {
  const fromBuild = import.meta.env.VITE_GAME_SERVER as string | undefined;
  if (fromBuild) return fromBuild.replace(/\/+$/, '');
  const ws = location.protocol === 'https:' ? 'wss' : 'ws';
  if (import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1') return `${ws}://${location.hostname}:${(import.meta.env.VITE_SERVER_PORT as string | undefined) || '2567'}`;
  return `${ws}://${location.host}`;
}

/** The meta API (/api/*): VITE_API_BASE when set at build time, else the game server's origin over HTTP(S). */
export function defaultApiBase(): string {
  const fromBuild = import.meta.env.VITE_API_BASE as string | undefined;
  if (fromBuild) return fromBuild.replace(/\/+$/, '');
  return defaultGameServer().replace(/^ws(s?):/, 'http$1:');
}
