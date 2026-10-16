/**
 * The version and BETA badge in the top right corner, on the menu and in the
 * game. The version is the root package.json's (a named JSON import, so only
 * the string lands in the bundle).
 */
import { version } from '../../../../package.json';

export const GAME_VERSION: string = version;

export function mountBuildBadge(): void {
  if (document.getElementById('build-badge')) return;
  const badge = document.createElement('div');
  badge.id = 'build-badge';
  const v = document.createElement('span');
  v.textContent = `v${GAME_VERSION}`;
  const beta = document.createElement('span');
  beta.className = 'beta';
  beta.textContent = 'BETA';
  badge.append(v, beta);
  document.body.append(badge);
}
