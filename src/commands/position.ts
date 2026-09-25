import { orderBetween, type TreeReader } from '@/model';
import type { Position } from './types';

/**
 * Compute a sibling order key for placing a node under `parentId` at `at`.
 * `excludeId` is the node being placed (ignored when it is already a sibling).
 */
export function orderFor(
  tree: TreeReader,
  parentId: string | null,
  at: Position,
  excludeId?: string,
): string | null {
  const sibs = tree.children(parentId).filter((s) => s !== excludeId);
  const keyOf = (id: string | undefined): string | null => (id === undefined ? null : tree.get(id)!.order);

  if (at === 'first') return orderBetween(null, keyOf(sibs[0]));
  if (at === 'last') return orderBetween(keyOf(sibs[sibs.length - 1]), null);
  if ('after' in at) {
    const i = sibs.indexOf(at.after);
    if (i < 0) return null;
    return orderBetween(keyOf(sibs[i]), keyOf(sibs[i + 1]));
  }
  const i = sibs.indexOf(at.before);
  if (i < 0) return null;
  return orderBetween(keyOf(sibs[i - 1]), keyOf(sibs[i]));
}

/** Parent ids that are real nodes (top level has no parent node). */
export function parentNodeIds(...ids: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const id of ids) if (id !== null && id !== undefined && !out.includes(id)) out.push(id);
  return out;
}

export function unique(ids: Iterable<string>): string[] {
  return [...new Set(ids)];
}
