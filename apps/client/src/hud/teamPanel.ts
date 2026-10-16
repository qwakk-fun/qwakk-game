/**
 * Your team on the HUD (team battle royale and deathmatch party allies): one
 * row per teammate with its name, health (or bleed meter while knocked) and
 * state: knocked, being revived, out. The data is the server's per-team
 * entries (`state.mates`), which only your own team's members get. Plain
 * DOM, rebuilt only when something changed.
 */
export interface MateRow {
  name: string;
  hp: number;
  alive: boolean;
  down: boolean;
  /** Revive progress 0..1 while someone revives it. */
  revive: number;
}

export class TeamPanel {
  readonly root: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'team-panel';
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  update(rows: MateRow[]): void {
    const key = JSON.stringify(rows);
    if (key === this.last) return;
    this.last = key;
    this.root.hidden = rows.length === 0;
    this.root.replaceChildren(
      ...rows.map((r) => {
        const row = document.createElement('div');
        row.className = `team-row${!r.alive ? ' out' : r.down ? ' down' : ''}`;
        const name = document.createElement('span');
        name.className = 'team-name';
        name.textContent = r.name;
        const state = document.createElement('span');
        state.className = 'team-state';
        state.textContent = !r.alive ? 'out' : r.down ? (r.revive > 0 ? `reviving ${Math.round(r.revive * 100)}%` : 'knocked') : `${Math.ceil(r.hp)}`;
        const bar = document.createElement('div');
        bar.className = 'team-bar';
        const fill = document.createElement('div');
        fill.className = 'team-fill';
        fill.style.width = `${r.alive ? Math.max(0, Math.min(100, r.down && r.revive > 0 ? r.revive * 100 : r.hp)) : 0}%`;
        bar.appendChild(fill);
        row.append(name, state, bar);
        return row;
      }),
    );
  }

  dispose(): void {
    this.root.remove();
  }
}
