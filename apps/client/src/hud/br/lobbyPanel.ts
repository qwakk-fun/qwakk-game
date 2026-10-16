/**
 * Battle royale waiting room panel, shown while the room waits for players or
 * counts down: the room's name and short id, how many ducks are in, and who
 * (name#tag, you marked). The big status line (waiting for N more, or the
 * countdown) is the HUD banner. Plain DOM; rebuilt only when something changed.
 */
export interface LobbyView {
  label: string;
  /** Short room id (lobby list), so friends can find the same room. */
  shortId: string;
  cap: number;
  /** Humans in the room, in join order. */
  players: { name: string; tag: string; me: boolean }[];
}

export class LobbyPanel {
  readonly root: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'br-lobby';
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  /** null hides the panel (the match started). */
  update(v: LobbyView | null): void {
    const key = v ? JSON.stringify(v) : '';
    if (key === this.last) return;
    this.last = key;
    this.root.hidden = !v;
    if (!v) return;
    const head = document.createElement('div');
    head.className = 'br-lobby-head';
    const title = document.createElement('div');
    title.className = 'br-lobby-title';
    title.textContent = v.label || 'Battle royale room';
    const id = document.createElement('span');
    id.className = 'br-lobby-id';
    id.textContent = `#${v.shortId}`;
    title.appendChild(id);
    const count = document.createElement('div');
    count.className = 'br-lobby-count';
    count.textContent = `${v.players.length}/${v.cap} ducks`;
    head.append(title, count);
    const list = document.createElement('ol');
    list.className = 'br-lobby-list';
    for (const p of v.players) {
      const li = document.createElement('li');
      if (p.me) li.className = 'me';
      const name = document.createElement('span');
      name.textContent = p.name;
      li.appendChild(name);
      if (p.tag) {
        const tag = document.createElement('span');
        tag.className = 'br-lobby-tag';
        tag.textContent = `#${p.tag}`;
        li.appendChild(tag);
      }
      if (p.me) {
        const you = document.createElement('span');
        you.className = 'br-lobby-you';
        you.textContent = 'you';
        li.appendChild(you);
      }
      list.appendChild(li);
    }
    const foot = document.createElement('div');
    foot.className = 'br-lobby-foot';
    foot.textContent = 'Esc, then Leave the match, to pick another room.';
    this.root.replaceChildren(head, list, foot);
  }

  dispose(): void {
    this.root.remove();
  }
}
