/**
 * Page entry. Public builds show the menu (ui/menu), which loads the game
 * module (play.ts) on demand. Dev and test builds can skip it: `?mode=br`,
 * `?mode=dm` or a dev tool (`?autopilot=`, `?spectate=1`) starts the game
 * directly, as the browser tests expect.
 */
import { bootMenu, directStart } from './ui/menu/index.ts';
import { mountBuildBadge } from './ui/buildBadge.ts';

mountBuildBadge();

// Same build-time switch as config.DEVTOOLS, spelled out here: importing
// config.ts would pull @qwakk/shared (Rapier) into this first chunk and the
// menu would wait for the whole game bundle before it paints.
const direct = directStart(import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1');
if (direct) {
  void import('./play.ts').then(async (play) => {
    try {
      await play.startGame(direct);
    } catch (err) {
      play.showStartError(err);
    }
  });
} else {
  bootMenu(() => import('./play.ts'));
}
