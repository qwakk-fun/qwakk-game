/**
 * My Duck, a tab of the plaza's sheet (Esc): the signed-in duck's Hunt
 * Season progression on one page, kept small. Its level and XP bar, its Tüy,
 * the gear it wears, which katana moves its level unlocked, and the skill
 * tree (spend a point, reset the tree). Every change is a checked server
 * request (duckStore.ts); the numbers come from the shared tables.
 */
import {
  branchSpent,
  canSpend,
  gearById,
  levelProgress,
  respecCost,
  SKILL_IDS,
  TREE,
  TREE_BRANCHES,
  treePoints,
  treeSpent,
  UNLOCK_LEVEL,
  type TreeNode,
} from '@qwakk/shared/duck';
import { openDialog } from '../account/dialog.ts';
import { COPY } from '../copy.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import type { DuckStore } from './duckStore.ts';
import { itemName, itemStats } from './gearText.ts';

export class MyDuckPanel {
  readonly el: HTMLElement;
  private readonly store: DuckStore;
  private note = '';
  private noteBad = false;

  constructor(store: DuckStore) {
    this.store = store;
    this.el = h('div', { class: 'qp-mine' });
    store.on(() => this.render());
    this.render();
  }

  /** The tab opened: fresh numbers from the server. */
  show(): void {
    this.note = '';
    void this.store.load();
  }

  private say(text: string, bad = false): void {
    this.note = text;
    this.noteBad = bad;
    this.render();
  }

  private render(): void {
    const D = COPY.duck;
    const v = this.store.view;
    if (!v) {
      const retry = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-btn-ghost' }, D.retry);
      retry.addEventListener('click', () => void this.store.load());
      this.el.replaceChildren(h('section', { class: 'qm-card qp-empty' }, h('p', { class: 'qm-sub' }, this.store.failed ? D.offline : D.loading), this.store.failed ? retry : null));
      return;
    }
    const p = levelProgress(v.xp);
    const level = Math.max(v.level, p.level);
    const head = h(
      'section',
      { class: 'qm-card qp-head' },
      h('span', { class: 'qp-lv' }, String(level)),
      h(
        'div',
        { class: 'qp-head-main' },
        h('b', {}, D.level(level)),
        h('span', { class: 'qm-xp' }, h('span', { class: 'qm-xp-bar', role: 'progressbar', 'aria-label': COPY.raid.xpLabel(level), 'aria-valuemin': 0, 'aria-valuemax': p.need || 1, 'aria-valuenow': p.need ? p.into : 1 }, h('span', { class: 'qm-xp-fill', style: `width: ${Math.round(p.share * 100)}%` })), h('span', { class: 'qm-xp-text' }, p.need ? COPY.raid.xp(p.into, p.need) : COPY.raid.maxLevel)),
      ),
      h('span', { class: 'qp-balance', title: D.tuyNote }, h('span', { class: 'qp-tuy-icon', 'aria-hidden': 'true' }), D.balance(v.feathers)),
    );
    const k = gearById(v.equipped.katana);
    const a = gearById(v.equipped.armor);
    const gear = h(
      'section',
      { class: 'qm-card qp-gear' },
      h('h3', {}, D.gear),
      h('div', { class: 'qp-gear-row', 'data-slot': 'katana' }, h('small', {}, D.katana), h('b', {}, itemName(v.equipped.katana)), h('span', {}, k ? itemStats(k) : '')),
      h('div', { class: 'qp-gear-row', 'data-slot': 'armor' }, h('small', {}, D.armor), h('b', {}, a ? itemName(a.id) : D.noArmor), h('span', {}, a ? itemStats(a) : '')),
      h('p', { class: 'qm-fine' }, D.gearHint),
    );
    const moves = h(
      'section',
      { class: 'qm-card qp-moves' },
      h('h3', {}, D.moves),
      h(
        'ul',
        { class: 'qp-move-list' },
        h('li', { class: 'is-on' }, icon('check'), D.moveNames.light),
        ...SKILL_IDS.map((id) => {
          const on = level >= UNLOCK_LEVEL[id];
          return h('li', { class: on ? 'is-on' : 'is-locked', 'data-move': id }, icon(on ? 'check' : 'lock'), D.moveNames[id] ?? id, on ? null : h('span', { class: 'qp-at' }, D.moveAt(UNLOCK_LEVEL[id])));
        }),
      ),
    );
    this.el.replaceChildren(head, gear, moves, this.tree(level), h('p', { class: 'qm-fine qp-tuy-note' }, D.tuyNote));
  }

  private tree(level: number): HTMLElement {
    const D = COPY.duck;
    const v = this.store.view!;
    const alloc = v.tree;
    const left = Math.max(0, treePoints(level) - treeSpent(alloc));
    const cost = respecCost(v.respecs);
    const reset = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-btn-quiet qp-respec', disabled: treeSpent(alloc) === 0 || this.store.busy }, D.respec, h('span', { class: 'qp-cost' }, cost === 0 ? D.respecFree : D.respecCost(cost)));
    reset.addEventListener('click', () => this.askRespec());
    const status = h('p', { class: `qp-status${this.noteBad ? ' is-bad' : ''}`, role: 'status' }, this.note);
    return h(
      'section',
      { class: 'qm-card qp-tree' },
      h('div', { class: 'qp-tree-head' }, h('h3', {}, D.tree), h('span', { class: `qp-points${left > 0 ? ' has-points' : ''}` }, left > 0 ? D.points(left) : D.noPoints), reset),
      h('div', { class: 'qp-branches' }, ...TREE_BRANCHES.map((b) => h('div', { class: 'qp-branch', 'data-branch': b }, h('h4', {}, D.branches[b] ?? b, h('span', {}, String(branchSpent(alloc, b)))), ...TREE.filter((n) => n.branch === b).map((n) => this.node(n, level))))),
      status,
    );
  }

  private node(n: TreeNode, level: number): HTMLElement {
    const D = COPY.duck;
    const v = this.store.view!;
    const rank = v.tree[n.id] ?? 0;
    const why = canSpend(v.tree, n.id, level);
    const [name, line] = D.nodes[n.id] ?? [n.id, ''];
    let need = '';
    if (why === 'needs_level') need = D.needsLevel(n.level);
    else if (why === 'needs_node' && n.needs) need = D.needsNode(D.nodes[n.needs.node]?.[0] ?? n.needs.node, n.needs.rank);
    else if (why === 'needs_branch' && n.branchPoints) need = D.needsBranch(n.branchPoints, D.branches[n.branch] ?? n.branch);
    const pips = h('span', { class: 'qp-pips', 'aria-label': D.rank(rank, n.max) }, ...Array.from({ length: n.max }, (_, i) => h('i', { class: i < rank ? 'on' : '' })));
    const b = h(
      'button',
      { type: 'button', class: `qp-node${rank >= n.max ? ' is-max' : ''}${why === null ? ' is-open' : ''}${rank > 0 ? ' has-rank' : ''}${n.branchPoints ? ' is-cap' : ''}`, 'data-node': n.id, 'aria-label': D.spend(name), disabled: why !== null || this.store.busy },
      h('span', { class: 'qp-node-top' }, h('b', {}, name), pips),
      h('span', { class: 'qp-node-line' }, line),
      need ? h('span', { class: 'qp-node-need' }, icon('lock'), need) : null,
    );
    b.addEventListener('click', () => void this.spend(n.id));
    return b;
  }

  private async spend(id: string): Promise<void> {
    const err = await this.store.spend(id);
    if (err) return this.say(COPY.duck.errors[err] ?? COPY.duck.errors.generic!, true);
    this.note = '';
  }

  private askRespec(): void {
    const D = COPY.duck;
    const yes = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-btn-yellow' }, D.respecYes);
    const no = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-btn-ghost' }, D.respecNo);
    const d = openDialog({ title: D.respec, body: [D.respecAsk], content: h('div', { class: 'qm-account-actions' }, yes, no) });
    no.addEventListener('click', () => d.close());
    yes.addEventListener('click', () => {
      d.close();
      void this.store.respec().then((err) => {
        if (err) this.say(D.errors[err] ?? D.errors.generic!, true);
      });
    });
  }
}
