import type { Node } from './node';
import type { TreeReader } from './tree';

/** A deletion that can be undone from Recently deleted: the node it started from, and how many went with it. */
export interface DeletedItem {
  node: Node;
  /** Nodes deleted along with it, under it. */
  inside: number;
}

/**
 * The node a deleted node went with: the highest ancestor deleted at the same
 * moment, through ancestors that all went at that moment (itself if none).
 */
export function deletionRoot(tree: TreeReader, node: Node): Node {
  let root = node;
  const seen = new Set<string>([node.id]);
  // Stryker disable next-line ConditionalExpression: with no parent, get(null) finds nothing and the loop stops just the same
  while (root.parentId !== null && !seen.has(root.parentId)) {
    const parent = tree.get(root.parentId);
    if (!parent || parent.deletedAt !== node.deletedAt) break;
    seen.add(parent.id);
    root = parent;
  }
  return root;
}

/**
 * What was deleted, newest first, one entry per deletion (by the node it
 * started from). Blank rows deleted on their own are left out: they are the
 * empty lines Backspace removes while typing.
 */
export function deletedItems(tree: TreeReader, limit = 50): DeletedItem[] {
  const roots = new Map<string, DeletedItem>();
  for (const n of tree.all()) {
    if (n.deletedAt === null) continue;
    const root = deletionRoot(tree, n);
    const item = roots.get(root.id) ?? { node: root, inside: 0 };
    if (root !== n) item.inside++;
    roots.set(root.id, item);
  }
  return [...roots.values()]
    .filter((d) => d.inside > 0 || d.node.content.trim() !== '' || d.node.note.trim() !== '')
    .sort((a, b) => b.node.deletedAt! - a.node.deletedAt! || (a.node.id < b.node.id ? -1 : 1))
    .slice(0, limit);
}
