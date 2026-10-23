/**
 * The "Last round" card on the Play tab after a match: the headline (a win,
 * round over, left, disconnected) and the numbers (place, kills, points).
 * Points come from the game's own summary when it sent one (the same formula
 * as the server), else from the season totals before and after the match.
 */
import { fetchMe, type MeData } from './api.ts';
import { COPY } from './copy.ts';
import { h } from './dom.ts';
import { loadIdentity } from './identity.ts';
import { icon } from './icons.ts';
import { matchPoints } from './score.ts';
import type { ExitReason, GameMode, MatchSummary } from './types.ts';

const R = COPY.result;

export class ResultCard {
  readonly el: HTMLElement;
  /** Bumped on every show/hide, so a late totals check from an older round stops. */
  private seq = 0;

  constructor() {
    this.el = h('div', { class: 'qm-result', hidden: true, 'aria-live': 'polite' });
  }

  hide(): void {
    this.seq++;
    this.el.hidden = true;
  }

  /** `before`: your season totals from before the match (null when unknown). */
  async show(reason: ExitReason, summary: MatchSummary | undefined, lastMode: GameMode, before: MeData | null): Promise<void> {
    const seq = ++this.seq;
    const lines: string[] = [];
    let headline: string = reason === 'disconnected' ? R.disconnected : reason === 'left' ? R.left : reason === 'removed' ? R.removed : reason === 'closed' ? R.closed : R.ended;
    let won = false;
    let hasPoints = false;
    const fill = (s: MatchSummary): void => {
      lines.length = 0;
      const mode = s.mode ?? lastMode;
      if (mode === 'raid') {
        won = (s.waves ?? 0) >= 15;
        headline = won ? R.raidWon : R.raidEnded;
        if (s.waves !== undefined) lines.push(R.raidHeld(s.waves));
        if (s.kills !== undefined) lines.push(R.kills(s.kills));
        if (s.xp) lines.push(R.raidXp(s.xp));
        hasPoints = true;
        return;
      }
      if (s.placement === 1 && mode === 'br') {
        headline = R.win;
        won = true;
      }
      if (s.placement) lines.push(R.placed(s.placement, s.players));
      if (s.kills !== undefined) lines.push(R.kills(s.kills));
      // Same formula as the server, from the game's own numbers, so it never
      // races the server's write. Without them, the before/after diff below.
      const points = s.points ?? (s.placement && s.players && s.kills !== undefined ? matchPoints(mode, s.placement, s.players, s.kills) : undefined);
      hasPoints = !!points;
      if (points) lines.push(R.points(points));
    };
    const render = (): void => {
      this.el.classList.toggle('is-win', won);
      this.el.replaceChildren(
        h('span', { class: 'qm-result-icon', 'aria-hidden': 'true' }, icon('trophy')),
        h('div', { class: 'qm-result-text' }, h('p', { class: 'qm-result-head' }, R.heading), h('p', { class: 'qm-result-main' }, headline)),
      );
      if (lines.length) this.el.append(h('ul', { class: 'qm-result-stats' }, ...lines.map((l) => h('li', {}, l))));
      this.el.hidden = false;
    };
    if (summary) fill(summary);
    render();
    if ((reason === 'left' && !summary) || reason === 'removed' || hasPoints) return;
    // Points (and the rest, when the game sent no summary): compare season
    // totals before and after; the server writes the match a moment later.
    const id = loadIdentity();
    if (!before?.leaderboard || !id.token) return;
    for (const wait of [1200, 2500, 5000]) {
      await new Promise((r) => setTimeout(r, wait));
      if (seq !== this.seq) return;
      const after = await fetchMe(id.token, 'all').catch(() => null);
      if (seq !== this.seq) return;
      const a = after?.standing;
      const b = before.standing;
      if (!a || a.matches <= (b?.matches ?? 0)) continue;
      const diff = { mode: lastMode, kills: a.kills - (b?.kills ?? 0), points: a.score - (b?.score ?? 0), placement: a.wins > (b?.wins ?? 0) ? 1 : undefined };
      fill(summary ? { ...summary, points: diff.points } : diff);
      render();
      return;
    }
  }
}
