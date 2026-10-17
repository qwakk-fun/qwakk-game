/**
 * Page entry. Public builds show the menu (ui/menu), which loads the game
 * module (play.ts) on demand. Dev and test builds can skip it: `?mode=br`,
 * `?mode=dm` or a dev tool (`?autopilot=`, `?spectate=1`) starts the game
 * directly, as the browser tests expect.
 */
import { bootMenu, directStart } from './ui/menu/index.ts';
import { mountBuildBadge } from './ui/buildBadge.ts';
import { locale } from './i18n/locale.ts';
import { COPY } from './ui/menu/copy.ts';

document.documentElement.lang = locale;
document.title = locale === 'tr' ? 'Qwakk Adası' : 'Qwakk Island';
const overlayTitle = document.querySelector('#overlay .title');
if (overlayTitle) overlayTitle.textContent = document.title;
const status = document.getElementById('status');
if (status) status.textContent = COPY.loadingGame;
const reconnect = document.getElementById('reconnect');
if (reconnect) reconnect.textContent = locale === 'tr' ? 'Tekrar bağlan' : 'Reconnect';
const hints = document.querySelector('#overlay .keys');
if (hints) hints.replaceChildren(...COPY.howto.keys.map(([key, label]) => {
  const line = document.createElement('span');
  const bold = document.createElement('b');
  bold.textContent = key;
  line.append(bold, ` ${label}`);
  return line;
}));

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
  // Both are dynamic imports: the menu chunk stays free of Three.js and paints first.
  bootMenu(
    () => import('./play.ts'),
    () => import('./menuHero/index.ts'),
  );
}
