import type { Instruction, ItemMode } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';
import type { Command } from '@/commands';
import { isSelfOrDescendant, nextSibling, type TreeReader } from '@/model';
import type { DropIndicator } from '@/store/ui-store';

export const DRAG_TYPE = 'aletheia/node';

export interface DragData extends Record<string | symbol, unknown> {
  type: typeof DRAG_TYPE;
  id: string;
}

export function isDragData(data: Record<string | symbol, unknown>): data is DragData {
  return data.type === DRAG_TYPE && typeof data.id === 'string';
}

/** Hitbox mode for a row: expanded rows accept children below, last siblings allow outdenting. */
export function itemMode(tree: TreeReader, id: string, depth: number): ItemMode {
  const node = tree.get(id);
  if (!node) return 'standard';
  if (!node.collapsed && tree.children(id).length > 0) return 'expanded';
  if (depth > 0 && nextSibling(tree, id) === null) return 'last-in-group';
  return 'standard';
}

/**
 * The shallowest level a drop below `id` can reparent to: walk up while the
 * node is the last of its siblings. Dropping after an ancestor that still has
 * later children would land somewhere else than the indicator shows.
 */
export function minReparentLevel(tree: TreeReader, id: string, depth: number): number {
  let level = depth;
  let cur = id;
  while (level > 0 && nextSibling(tree, cur) === null) {
    level--;
    cur = tree.get(cur)!.parentId!;
  }
  return level;
}

/** Ancestor of `id` (at `depth`) that sits at `level`; `level === depth` is `id` itself. */
function ancestorAtLevel(tree: TreeReader, id: string, depth: number, level: number): string | null {
  let cur: string | null = id;
  for (let d = depth; d > level && cur !== null; d--) cur = tree.get(cur)?.parentId ?? null;
  return cur;
}

export function resolveInstruction(
  tree: TreeReader,
  targetId: string,
  depth: number,
  instruction: Instruction,
): { command: (sourceId: string) => Command; indicator: DropIndicator } | null {
  const target = tree.get(targetId);
  if (!target) return null;
  switch (instruction.type) {
    case 'reorder-above':
      return {
        command: (id) => ({ type: 'moveNode', id, parentId: target.parentId, at: { before: targetId } }),
        indicator: { targetId, edge: 'above', level: depth },
      };
    case 'reorder-below':
      return {
        command: (id) => ({ type: 'moveNode', id, parentId: target.parentId, at: { after: targetId } }),
        indicator: { targetId, edge: 'below', level: depth },
      };
    case 'make-child':
      return {
        command: (id) => ({ type: 'moveNode', id, parentId: targetId, at: 'first' }),
        indicator: { targetId, edge: 'below', level: depth + 1 },
      };
    case 'reparent': {
      const level = Math.max(instruction.desiredLevel, minReparentLevel(tree, targetId, depth));
      const anchor = ancestorAtLevel(tree, targetId, depth, level);
      if (anchor === null) return null;
      const anchorNode = tree.get(anchor)!;
      return {
        command: (id) => ({ type: 'moveNode', id, parentId: anchorNode.parentId, at: { after: anchor } }),
        indicator: { targetId, edge: 'below', level },
      };
    }
    case 'instruction-blocked':
      return null;
  }
}

/** A node can be dropped on any row that is not itself or one of its descendants. */
export function canDropOn(tree: TreeReader, sourceId: string, targetId: string): boolean {
  return !isSelfOrDescendant(tree, sourceId, targetId);
}
