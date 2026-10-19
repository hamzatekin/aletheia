import { descendantIds, isLive, orderBetween, type Node } from '@/model';
import { ChangeSet } from './changes';
import { parentNodeIds, unique } from './position';
import { Rejection, type CommandContext, type CommandOf, type Effect } from './types';

/** Soft-delete `id` and every live descendant with the same timestamp. */
export function deleteSubtree(ctx: CommandContext, cmd: CommandOf<'deleteSubtree'>): Effect | Rejection {
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

/**
 * Soft-delete `id` alone: its children move up to its parent and take its
 * slot, keeping their order.
 */
export function deleteNode(ctx: CommandContext, cmd: CommandOf<'deleteNode'>): Effect | Rejection {
  const { tree } = ctx;
  const node = tree.get(cmd.id);
  if (!isLive(node)) return new Rejection('node is missing or deleted');
  const cs = new ChangeSet(tree, ctx.now);
  const affected = [node.id, ...parentNodeIds(node.parentId)];

  const sibs = tree.children(node.parentId);
  const i = sibs.indexOf(node.id);
  let lower = i > 0 ? tree.get(sibs[i - 1]!)!.order : null;
  const upper = i < sibs.length - 1 ? tree.get(sibs[i + 1]!)!.order : null;
  for (const kid of tree.children(node.id)) {
    lower = orderBetween(lower, upper);
    cs.update(kid, { parentId: node.parentId, order: lower });
    affected.push(kid, ...descendantIds(tree, kid));
  }
  cs.update(node.id, { deletedAt: ctx.now });

  const focus = focusAfterDelete(ctx, node);
  return { changes: cs.list(), affectedNodeIds: unique(affected), ...(focus ? { focus } : {}) };
}

/** Previous sibling, else the parent, with the caret at the end. */
function focusAfterDelete(ctx: CommandContext, node: Node): Effect['focus'] | null {
  const sibs = ctx.tree.children(node.parentId);
  const i = sibs.indexOf(node.id);
  const target = i > 0 ? sibs[i - 1]! : node.parentId;
  if (target === null) return null;
  return { id: target, offset: ctx.tree.get(target)!.content.length };
}
