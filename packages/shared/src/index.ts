/**
 * @qwakk/shared: the pure simulation used by both the client and the server.
 * No DOM, no network, no timers. Deterministic from (seed, state, inputs).
 */
export * from './constants.ts';
export * from './math.ts';
export * from './rng.ts';
export * from './input.ts';
export * from './map.ts';
export * from './physics.ts';
export * from './sim.ts';
export * from './selftest.ts';
