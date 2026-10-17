/**
 * Admin panel entry for the server (index.ts): loads the stored admin state
 * (settings, bans, blocked words) into the game, now or once the database is
 * up, and builds the /admin handler. The panel itself is on only when
 * ADMIN_PASSWORD_HASH and ADMIN_TOTP_SECRET are set (config.ts); the stored
 * settings apply either way.
 */
import { matchMaker } from '@colyseus/core';
import { meta } from '../meta/index.ts';
import { loadAdminConfig } from './config.ts';
import { overview } from './dashboard.ts';
import { createAdminHandler, type AdminHandler } from './http.ts';
import { AdminStore } from './store.ts';

export interface AdminStart {
  handler: AdminHandler;
  store: AdminStore;
  enabled: boolean;
}

const RETRY_MS = 15_000;

/** Load the stored state; while the database is not up yet, retry in the background until it is. */
async function loadStored(store: AdminStore): Promise<void> {
  const tryLoad = async (): Promise<boolean> => {
    try {
      return await store.load();
    } catch (err) {
      console.error('[admin] loading the stored state failed:', err instanceof Error ? err.message : err);
      return false;
    }
  };
  if (await tryLoad()) return;
  if (!meta().config.databaseUrl) return;
  const timer = setInterval(() => {
    void tryLoad().then((done) => done && clearInterval(timer));
  }, RETRY_MS);
  timer.unref();
}

export async function startAdmin(env: NodeJS.ProcessEnv = process.env): Promise<AdminStart> {
  const m = meta();
  const store = new AdminStore(() => (m.dbState === 'up' ? m.sql : null));
  await loadStored(store);
  const { config, why } = loadAdminConfig(env);
  if (!config) console.log(`[admin] panel off: ${why}`);
  else console.log(`[admin] panel on at /admin (UI from ${config.uiDir})`);
  const handler = createAdminHandler(
    config
      ? {
          config,
          store,
          trustProxyHops: m.config.trustProxyHops,
          clearLeaderboardCache: () => m.clearCache(),
          overview: () =>
            overview({
              connections: async () => (await matchMaker.query({})).map((r) => ({ name: r.name, clients: r.clients })),
              dbState: () => m.dbState,
              persistent: () => store.persistent,
            }),
        }
      : null,
  );
  return { handler, store, enabled: config !== null };
}
