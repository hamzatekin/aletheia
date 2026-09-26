import { isLive, type Node } from './node';
import { orderBetween } from './order';
import type { TreeReader } from './tree';

/**
 * Fix what merging edits from two devices can break in a tree that each
 * device kept valid on its own. Returns the nodes to rewrite (empty when the
 * tree is fine). Pure.
 *
 * - A live node under a deleted parent (one device deleted the parent while
 *   the other added or edited a child): the deleted ancestors come back, so
 *   the child stays visible where it was written.
 * - A live node whose parent does not exist: moved to the end of the top level.
 * - A cycle (each device moved one node under the other): the cycle member
 *   with the smallest id moves to the end of the top level. Every device picks
 *   the same one.
 */
export function repairTree(tree: TreeReader, now: number): Node[] {
  const fixed = new Map<string, Node>();
  const get = (id: string): Node | undefined => fixed.get(id) ?? tree.get(id);
  let lastRoot = lastTopLevelOrder(tree);
  const toTop = (node: Node): void => {
    const order = orderBetween(lastRoot, null);
    lastRoot = order;
    fixed.set(node.id, { ...node, parentId: null, order, updatedAt: now });
  };

  for (const start of tree.all()) {
    const node = get(start.id)!;
    if (!isLive(node)) continue;
    // Walk up to the top level, noting where the chain breaks.
    const path: string[] = [node.id];
    const seen = new Set(path);
    let cur = node;
    while (cur.parentId !== null) {
      const parent = get(cur.parentId);
      if (!parent) {
        toTop(cur);
        break;
      }
      if (seen.has(parent.id)) {
        const cycle = path.slice(path.indexOf(parent.id));
        const pick = cycle.reduce((a, b) => (a < b ? a : b));
        toTop(get(pick)!);
        break;
      }
      if (parent.deletedAt !== null) fixed.set(parent.id, { ...parent, deletedAt: null, updatedAt: now });
      path.push(parent.id);
      seen.add(parent.id);
      cur = get(parent.id)!;
    }
  }
  return [...fixed.values()];
}

function lastTopLevelOrder(tree: TreeReader): string | null {
  const top = tree.children(null);
  const last = top.length > 0 ? tree.get(top[top.length - 1]!) : undefined;
  return last?.order ?? null;
}
