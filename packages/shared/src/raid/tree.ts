/**
 * Hunt Season progression, part 3: the skill tree. One point per level from
 * level 2, and one more at every tenth level; three small branches of five
 * nodes (Blade, Agility, Quack), each step a few percent, prerequisites
 * inside a branch, a capstone late (level 15 and 7 points in its branch).
 * The tree holds 30 ranks: a duck fills it around level 29, so most of the
 * way it has to choose.
 *
 * Every effect is a server-only number (damage, reach of the server's sweep,
 * crit chance, health, damage taken, a dodge roll, the storm meter, heals):
 * nothing in the tree changes what the client simulates (no cooldown, no
 * timing, no movement), so prediction stays exact without per-duck sim
 * values. The server checks every spend (`canSpend`) and the kit it builds
 * re-checks the whole allocation (`cleanTree`).
 */

export const TREE_BRANCHES = ['blade', 'agility', 'quack'] as const;
export type TreeBranch = (typeof TREE_BRANCHES)[number];

export interface TreeNode {
  id: string;
  branch: TreeBranch;
  /** Most ranks. */
  max: number;
  /** Level needed for the first rank. */
  level: number;
  /** Another node of the branch at a rank first. */
  needs?: { node: string; rank: number };
  /** Points already spent in the branch first (capstones). */
  branchPoints?: number;
  /** The effect per rank (its meaning by node, see `treeEffects`). */
  per: number;
}

export const TREE: readonly TreeNode[] = [
  // Blade: the katana's cuts.
  { id: 'edge', branch: 'blade', max: 3, level: 2, per: 0.03 },
  { id: 'reach', branch: 'blade', max: 2, level: 2, needs: { node: 'edge', rank: 1 }, per: 0.04 },
  { id: 'finisher', branch: 'blade', max: 2, level: 2, needs: { node: 'edge', rank: 2 }, per: 0.1 },
  { id: 'lucky', branch: 'blade', max: 2, level: 2, needs: { node: 'reach', rank: 1 }, per: 0.02 },
  { id: 'iaido', branch: 'blade', max: 1, level: 15, branchPoints: 7, per: 0.25 },
  // Agility: staying on your feet (server-only: health, damage taken, the dash's cut, a dodge roll).
  { id: 'feathers', branch: 'agility', max: 3, level: 2, per: 5 },
  { id: 'tough', branch: 'agility', max: 2, level: 2, needs: { node: 'feathers', rank: 1 }, per: 0.03 },
  { id: 'strike', branch: 'agility', max: 2, level: 2, needs: { node: 'feathers', rank: 1 }, per: 0.25 },
  { id: 'sidestep', branch: 'agility', max: 2, level: 2, needs: { node: 'tough', rank: 1 }, per: 0.03 },
  { id: 'laststand', branch: 'agility', max: 1, level: 15, branchPoints: 7, per: 1 },
  // Quack: the shockwave and the Blade Storm.
  { id: 'loud', branch: 'quack', max: 3, level: 4, per: 0.08 },
  { id: 'stun', branch: 'quack', max: 2, level: 4, needs: { node: 'loud', rank: 1 }, per: 0.3 },
  { id: 'heart', branch: 'quack', max: 2, level: 8, needs: { node: 'loud', rank: 1 }, per: 0.1 },
  { id: 'eye', branch: 'quack', max: 2, level: 8, needs: { node: 'heart', rank: 1 }, per: 0.15 },
  { id: 'rally', branch: 'quack', max: 1, level: 15, branchPoints: 7, per: 10 },
];

const BY_ID = new Map(TREE.map((n) => [n.id, n]));

export function treeNode(id: unknown): TreeNode | null {
  return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

/** A tree allocation: node id to rank (missing: 0). */
export type TreeAlloc = Record<string, number>;

/** Points a level gives: one per level from level 2, plus one at every tenth level. */
export function treePoints(level: number): number {
  const L = Math.max(1, Math.floor(level));
  return L - 1 + Math.floor(L / 10);
}

export function treeSpent(alloc: TreeAlloc): number {
  let n = 0;
  for (const node of TREE) n += Math.max(0, Math.floor(alloc[node.id] ?? 0));
  return n;
}

export function branchSpent(alloc: TreeAlloc, branch: TreeBranch): number {
  let n = 0;
  for (const node of TREE) if (node.branch === branch) n += Math.max(0, Math.floor(alloc[node.id] ?? 0));
  return n;
}

/** Most ranks in the whole tree. */
export const TREE_RANKS = TREE.reduce((n, t) => n + t.max, 0);

export type SpendError = 'unknown' | 'maxed' | 'no_points' | 'needs_level' | 'needs_node' | 'needs_branch';

/** Why one more rank in `id` is not allowed now (null: it is). */
export function canSpend(alloc: TreeAlloc, id: string, level: number): SpendError | null {
  const node = treeNode(id);
  if (!node) return 'unknown';
  const rank = Math.floor(alloc[id] ?? 0);
  if (rank >= node.max) return 'maxed';
  if (treeSpent(alloc) >= treePoints(level)) return 'no_points';
  if (Math.floor(level) < node.level) return 'needs_level';
  if (node.needs && Math.floor(alloc[node.needs.node] ?? 0) < node.needs.rank) return 'needs_node';
  if (node.branchPoints && branchSpent(alloc, node.branch) < node.branchPoints) return 'needs_branch';
  return null;
}

/**
 * The allocation the rules allow, rebuilt node by node in tree order from
 * what is stored (unknown nodes, ranks past a node's max or past the points
 * dropped). The server builds a duck's kit from this, never from raw rows.
 */
export function cleanTree(alloc: TreeAlloc, level: number): TreeAlloc {
  const out: TreeAlloc = {};
  let progress = true;
  while (progress) {
    progress = false;
    for (const node of TREE) {
      const want = Math.max(0, Math.min(node.max, Math.floor(Number(alloc[node.id] ?? 0) || 0)));
      while ((out[node.id] ?? 0) < want && canSpend(out, node.id, level) === null) {
        out[node.id] = (out[node.id] ?? 0) + 1;
        progress = true;
      }
    }
  }
  return out;
}

/** Tüy a respec costs: the first one is free, every later one this much. */
export const RESPEC_COST = 300;

export function respecCost(respecsDone: number): number {
  return respecsDone <= 0 ? 0 : RESPEC_COST;
}
