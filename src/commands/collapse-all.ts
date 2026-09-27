import { descendantIds, visibleRows, type TreeReader } from '@/model';
import type { Command } from './types';

/** Live nodes under `underId` (the whole document for null), optionally with `underId` itself. */
function subtree(tree: TreeReader, underId: string | null, includeSelf: boolean): string[] {
  if (underId === null) return [...tree.all()].filter((n) => n.deletedAt === null).map((n) => n.id);
  return includeSelf ? [underId, ...descendantIds(tree, underId)] : descendantIds(tree, underId);
}

/** Commands that collapse or expand every parent under `underId`, skipping ones already in that state. */
export function setAllCollapsedCommands(tree: TreeReader, underId: string | null, collapsed: boolean, includeSelf = false): Command[] {
  return subtree(tree, underId, includeSelf)
    .filter((id) => tree.children(id).length > 0 && (tree.get(id)?.collapsed ?? false) !== collapsed)
    .map((id) => ({ type: 'toggleCollapse', id, collapsed }));
}

/** True when some visible parent under `rootId` is open, so "collapse all" is the useful direction. */
export function hasOpenParent(tree: TreeReader, rootId: string | null): boolean {
  return visibleRows(tree, rootId).some((r) => !tree.get(r.id)?.collapsed && tree.children(r.id).length > 0);
}
