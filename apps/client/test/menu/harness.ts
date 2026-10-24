/** Menu with a fake game (records startGame calls, then ends the round with a summary), a fake plaza and the real 3D ducks. */
import { bootMenu, type ExitReason, type MatchSummary, type StartOptions } from '../../src/ui/menu/index.ts';

const w = window as unknown as { __menuTest: { starts: StartOptions[]; loads: number } };
w.__menuTest = { starts: [], loads: 0 };
let exit: ((r: ExitReason, s?: MatchSummary) => void) | null = null;

bootMenu(async () => {
  w.__menuTest.loads++;
  await new Promise((r) => setTimeout(r, 200));
  return {
    async startGame(opts) {
      w.__menuTest.starts.push(opts);
      await new Promise((r) => setTimeout(r, 400));
      setTimeout(() => exit?.('ended', { mode: opts.mode, placement: 1, players: 32, kills: 6, points: 160 }), 700);
    },
    onGameExit(cb) {
      exit = cb;
    },
    // A fake plaza: nothing to draw, the menu sheet (Esc) is the way to play here.
    async enterHub(opts) {
      setTimeout(() => opts.hooks.pause(), 50);
      return { leave() {}, setTeam() {}, setPaused() {}, resume() {}, applySettings() {}, toast() {}, touch: false, roomId: 'fake' };
    },
  };
}, () => import('../../src/menuHero/index.ts'));
