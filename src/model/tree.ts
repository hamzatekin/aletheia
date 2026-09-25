import type { Node } from './node';

/**
 * Read-only view of the tree that commands compute against.
 * `children` returns live (non-deleted) children in sibling order.
 */
export interface TreeReader {
  get(id: string): Node | undefined;
  children(parentId: string | null): readonly string[];
  /** Every node, live or soft-deleted. Used by rare whole-tree scans (restore, export). */
  all(): Iterable<Node>;
}

/** Ancestors from the nearest parent up to the top level (excludes `id`). */
export function ancestorIds(tree: TreeReader, id: string): string[] {
  const out: string[] = [];
  let cur = tree.get(id);
  const seen = new Set<string>([id]);
  while (cur && cur.parentId !== null) {
    if (seen.has(cur.parentId)) break; // defensive: corrupt cycle
    seen.add(cur.parentId);
    out.push(cur.parentId);
    cur = tree.get(cur.parentId);
  }
  return out;
}

/** All live descendants of `id` in depth-first document order (excludes `id`). */
export function descendantIds(tree: TreeReader, id: string): string[] {
  const out: string[] = [];
  const stack = [...tree.children(id)].reverse();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    out.push(cur);
    const kids = tree.children(cur);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  return out;
}

/** True when `maybeDescendant` is `ancestor` itself or lies anywhere beneath it. */
export function isSelfOrDescendant(tree: TreeReader, ancestor: string, maybeDescendant: string): boolean {
  if (ancestor === maybeDescendant) return true;
  return ancestorIds(tree, maybeDescendant).includes(ancestor);
}

export function siblingsOf(tree: TreeReader, id: string): readonly string[] {
  const node = tree.get(id);
  return node ? tree.children(node.parentId) : [];
}

export function previousSibling(tree: TreeReader, id: string): string | null {
  const sibs = siblingsOf(tree, id);
  const i = sibs.indexOf(id);
  return i > 0 ? sibs[i - 1]! : null;
}

export function nextSibling(tree: TreeReader, id: string): string | null {
  const sibs = siblingsOf(tree, id);
  const i = sibs.indexOf(id);
  return i >= 0 && i < sibs.length - 1 ? sibs[i + 1]! : null;
}

/**
 * Flatten the visible tree under `rootId` (children of the root, recursively,
 * skipping collapsed subtrees). `null` = the whole top level.
 */
export interface VisibleRow {
  id: string;
  depth: number;
}

export function visibleRows(tree: TreeReader, rootId: string | null): VisibleRow[] {
  const out: VisibleRow[] = [];
  const stack: VisibleRow[] = [];
  const top = tree.children(rootId);
  for (let i = top.length - 1; i >= 0; i--) stack.push({ id: top[i]!, depth: 0 });
  while (stack.length > 0) {
    const row = stack.pop()!;
    out.push(row);
    const node = tree.get(row.id);
    if (!node || node.collapsed) continue;
    const kids = tree.children(row.id);
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i]!, depth: row.depth + 1 });
  }
  return out;
}

/** Previous row in the visible flattening, or null at the top. */
export function previousVisible(tree: TreeReader, rootId: string | null, id: string): string | null {
  const rows = visibleRows(tree, rootId);
  const i = rows.findIndex((r) => r.id === id);
  return i > 0 ? rows[i - 1]!.id : null;
}

export function nextVisible(tree: TreeReader, rootId: string | null, id: string): string | null {
  const rows = visibleRows(tree, rootId);
  const i = rows.findIndex((r) => r.id === id);
  return i >= 0 && i < rows.length - 1 ? rows[i + 1]!.id : null;
}
