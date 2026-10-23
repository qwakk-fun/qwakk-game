/**
 * Runtime options from the URL, so testers and scripts can tune a session
 * without a rebuild. Example: /game/?lat=120&jit=20&webgl=1&autopilot=1 (dev tools options need a dev or test build)
 */
import { NET } from '@qwakk/shared';
import { defaultGameServer } from './net/endpoint.ts';

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

/**
 * Dev tools (fake network, test hook, autopilot, spectator, `?server=`) are
 * decided at BUILD time: on in `npm run dev` and in test builds
 * (`npm run build:test`, VITE_DEVTOOLS=1), compiled out of public builds.
 * Being a constant, `if (DEVTOOLS)` branches and their dynamic imports are
 * removed from the public bundle entirely.
 */
export const DEVTOOLS: boolean = import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1';
const devtools = DEVTOOLS;

const defaultServer = defaultGameServer();

export const config = {
  /** Colyseus endpoint (see defaultGameServer). `?server=` is a dev tool. */
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
  lerpSmoothMs: devtools ? num('lerpsmooth', NET.remoteSmoothMs) : NET.remoteSmoothMs,
  /**
   * Hands-free play for tests and phone frame-time checks (dev tools only):
   * `autopilot=1` runs in circles, `autopilot=fight` hunts and shoots the nearest visible duck,
   * `autopilot=br` jumps, lands and loots in a battle royale.
   */
  autopilot: (devtools ? (params.get('autopilot') ?? '') : '') as '' | '1' | 'fight' | 'br' | 'raid',
  /** Autopilot drop target `aptarget=x,z` (dev tools only): the battle royale autopilot glides there. */
  apTarget: ((): { x: number; z: number } | null => {
    const v = devtools ? params.get('aptarget') : null;
    const [x, z] = (v ?? '').split(',').map(Number);
    return v && Number.isFinite(x) && Number.isFinite(z) ? { x: x as number, z: z as number } : null;
  })(),
  /** Game mode for a direct start without the menu (dev tools): `?mode=br` or `?mode=dm`. */
  mode: (params.get('mode') === 'br' ? 'br' : params.get('mode') === 'raid' ? 'raid' : 'dm') as 'br' | 'dm' | 'raid',
  /** Graphics quality: `?quality=low` (shorter draw distances). The menu setting wins when it starts the game. */
  quality: (params.get('quality') === 'low' ? 'low' : 'high') as 'low' | 'high',
  /** Watch the match without playing (dev tools only, the server must allow spectators). */
  spectate: devtools && flag('spectate'),
  /** Show the debug HUD on start (toggle with H). Dev tools only by default. */
  hud: params.has('hud') ? params.get('hud') !== '0' : devtools,
  /** Render scale cap. Phones default lower to protect frame time. */
  pixelRatio: num('pr', Math.min(window.devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 1.5 : 2)),
  shadows: params.get('shadows') !== '0',
  /** `?duck=placeholder` ignores public/models/duck.glb and uses the primitive duck. */
  placeholderDuck: params.get('duck') === 'placeholder',
};
