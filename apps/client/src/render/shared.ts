/**
 * The one renderer of the page, made on first use and shared by the matches
 * (play.ts) and Duck Plaza (hub/hubHost.ts); each of them gives it a fresh
 * scene and disposes its own things when it ends.
 */
import { config } from '../config.ts';
import { createRenderer, type RenderContext } from './renderer.ts';

let ctxPromise: Promise<RenderContext> | null = null;

export function sharedRenderer(): Promise<RenderContext> {
  ctxPromise ??= createRenderer(document.getElementById('game') as HTMLCanvasElement, config);
  return ctxPromise;
}
