/**
 * Runtime options from the URL, so testers and scripts can tune a session
 * without a rebuild. Example: /game/?lat=120&jit=20&webgl=1&autopilot=1
 */
const params = new URLSearchParams(location.search);

function num(name: string, fallback: number): number {
  const v = params.get(name);
  if (v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function flag(name: string): boolean {
  const v = params.get(name);
  return v !== null && v !== '0' && v !== 'false';
}

/** Dev tools (fake network, test hook) are on in `npm run dev`, or with `?devtools=1` on a build. */
const devtools = import.meta.env.DEV || flag('devtools');

const defaultServer = import.meta.env.VITE_GAME_SERVER ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`;

export const config = {
  /** Colyseus endpoint. Defaults to the page host on port 2567 so LAN phones work. `?server=` is a dev tool. */
  server: (devtools ? params.get('server') : null) ?? defaultServer,
  name: params.get('name') ?? '',
  /** Force the WebGL2 backend (default: WebGPU when available, WebGL2 fallback). */
  forceWebGL: flag('webgl'),
  devtools,
  /** Simulated network, dev tools only: round-trip latency (ms), jitter (+/- ms) and loss (0..1). */
  latencyMs: devtools ? num('lat', 0) : 0,
  jitterMs: devtools ? num('jit', 0) : 0,
  loss: devtools ? num('loss', 0) : 0,
  /**
   * Output spring on remote-player interpolation (ms). Keeps drawn velocity
   * continuous when browser frame timing or the clock estimate wobbles, for
   * about this much extra display lag. Display only: lag compensation rewinds
   * the unsmoothed positions. 0 turns it off.
   */
  lerpSmoothMs: num('lerpsmooth', 30),
  /** Bot-like movement for headless tests and phone frame-time checks. */
  autopilot: flag('autopilot'),
  /** Show the debug HUD on start (toggle with H). */
  hud: params.get('hud') !== '0',
  /** Render scale cap. Phones default lower to protect frame time. */
  pixelRatio: num('pr', Math.min(window.devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 1.5 : 2)),
  shadows: params.get('shadows') !== '0',
  /** `?duck=placeholder` ignores public/models/duck.glb and uses the primitive duck. */
  placeholderDuck: params.get('duck') === 'placeholder',
};
