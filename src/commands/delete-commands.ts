import { descendantIds, isLive, type Node } from '@/model';
import { ChangeSet } from './changes';
import { orderFor, parentNodeIds, unique } from './position';
import { Rejection, type Command, type CommandContext, type Effect } from './types';

type Of<T extends Command['type']> = Extract<Command, { type: T }>;

/** Soft-delete `id` and every live descendant with the same timestamp. */
export function deleteSubtree(ctx: CommandContext, cmd: Of<'deleteSubtree'>): Effect | Rejection {
  const { tree } = ctx;
  const node = tree.get(cmd.id);
  if (!isLive(node)) return new Rejection('node is missing or deleted');
  const cs = new ChangeSet(tree, ctx.now);
  const ids = [cmd.id, ...descendantIds(tree, cmd.id)];
  for (const id of ids) cs.update(id, { deletedAt: ctx.now });
  const focus = focusAfterDelete(ctx, node);
  return {
    changes: cs.list(),
    affectedNodeIds: unique([...ids, ...parentNodeIds(node.parentId)]),
    ...(focus ? { focus } : {}),
  };
}

/** Previous sibling, else the parent, with the caret at the end. */
function focusAfterDelete(ctx: CommandContext, node: Node): Effect['focus'] | null {
  const sibs = ctx.tree.children(node.parentId);
  const i = sibs.indexOf(node.id);
  const target = i > 0 ? sibs[i - 1]! : node.parentId;
  if (target === null) return null;
  return { id: target, offset: ctx.tree.get(target)!.content.length };
}

/**
 * Restore a soft-deleted node together with the descendants that were deleted
 * in the same operation (same `deletedAt`). Descendants deleted earlier stay
 * deleted. If the parent is gone, the node is re-attached at the top level.
 */
export function restore(ctx: CommandContext, cmd: Of<'restore'>): Effect | Rejection {
  const { tree } = ctx;
  const node = tree.get(cmd.id);
  if (!node) return new Rejection('node not found');
  if (node.deletedAt === null) return new Rejection('node is not deleted');

  const cs = new ChangeSet(tree, ctx.now);
  const stamp = node.deletedAt;

  const parentLive = node.parentId === null || isLive(tree.get(node.parentId));
  if (parentLive) {
    const sibs = tree.children(node.parentId);
    const collides = sibs.some((s) => tree.get(s)!.order === node.order);
    cs.update(node.id, collides ? { deletedAt: null, order: orderFor(tree, node.parentId, 'last')! } : { deletedAt: null });
  } else {
    cs.update(node.id, { deletedAt: null, parentId: null, order: orderFor(tree, null, 'last')! });
  }
  const restored = [node.id];

  // Descendants deleted in the same operation: scan the deleted nodes with the
  // same stamp and keep those whose chain of same-stamp ancestors reaches `node`.
  const sameStamp = new Map<string, Node>();
  for (const n of tree.all()) if (n.deletedAt === stamp && n.id !== node.id) sameStamp.set(n.id, n);
  const kidsOf = new Map<string, Node[]>();
  for (const n of sameStamp.values()) {
    if (n.parentId === null) continue;
    (kidsOf.get(n.parentId) ?? kidsOf.set(n.parentId, []).get(n.parentId)!).push(n);
  }
  const stack = [node.id];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    for (const kid of kidsOf.get(pid) ?? []) {
      cs.update(kid.id, { deletedAt: null });
      restored.push(kid.id);
      stack.push(kid.id);
    }
  }

  const after = cs.current(node.id)!;
  return {
    changes: cs.list(),
    affectedNodeIds: unique([...restored, ...parentNodeIds(after.parentId)]),
    focus: { id: node.id, offset: 0 },
  };
}

