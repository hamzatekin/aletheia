import { descendantIds, isLive, isSelfOrDescendant, nextSibling, previousSibling } from '@/model';
import { ChangeSet } from './changes';
import { orderFor, parentNodeIds, unique } from './position';
import { Rejection, type Command, type CommandContext, type Effect, type Position } from './types';

type Of<T extends Command['type']> = Extract<Command, { type: T }>;

function moveTo(
  ctx: CommandContext,
  id: string,
  parentId: string | null,
  at: Position,
  extra?: (cs: ChangeSet) => void,
): Effect | Rejection {
  const { tree } = ctx;
  const node = tree.get(id);
  if (!isLive(node)) return new Rejection('node is missing or deleted');
  if (parentId !== null) {
    if (!isLive(tree.get(parentId))) return new Rejection('target parent is missing or deleted');
    if (isSelfOrDescendant(tree, id, parentId)) return new Rejection('cannot move a node into itself or its descendant');
  }
  const order = orderFor(tree, parentId, at, id);
  if (order === null) return new Rejection('anchor sibling not found');

  const cs = new ChangeSet(tree, ctx.now);
  cs.update(id, { parentId, order });
  extra?.(cs);

  return {
    changes: cs.list(),
    affectedNodeIds: unique([id, ...descendantIds(tree, id), ...parentNodeIds(node.parentId, parentId)]),
    focus: { id, offset: 0 },
  };
}

export function moveNode(ctx: CommandContext, cmd: Of<'moveNode'>): Effect | Rejection {
  return moveTo(ctx, cmd.id, cmd.parentId, cmd.at ?? 'last');
}

/** Become the last child of the previous sibling (which is expanded so the node stays visible). */
export function indent(ctx: CommandContext, cmd: Of<'indent'>): Effect | Rejection {
  const node = ctx.tree.get(cmd.id);
  if (!isLive(node)) return new Rejection('node is missing or deleted');
  const prev = previousSibling(ctx.tree, cmd.id);
  if (prev === null) return new Rejection('cannot indent the first child');
  return moveTo(ctx, cmd.id, prev, 'last', (cs) => {
    if (ctx.tree.get(prev)!.collapsed) cs.update(prev, { collapsed: false });
  });
}

/** Become the sibling right after the current parent. Following siblings stay put. */
export function outdent(ctx: CommandContext, cmd: Of<'outdent'>): Effect | Rejection {
  const node = ctx.tree.get(cmd.id);
  if (!isLive(node)) return new Rejection('node is missing or deleted');
  if (node.parentId === null) return new Rejection('cannot outdent a top-level node');
  const parent = ctx.tree.get(node.parentId)!;
  return moveTo(ctx, cmd.id, parent.parentId, { after: parent.id });
}

export function toggleCollapse(ctx: CommandContext, cmd: Of<'toggleCollapse'>): Effect | Rejection {
  const node = ctx.tree.get(cmd.id);
  if (!isLive(node)) return new Rejection('node is missing or deleted');
  const collapsed = cmd.collapsed ?? !node.collapsed;
  if (collapsed === node.collapsed) return { changes: [], affectedNodeIds: [] };
  const cs = new ChangeSet(ctx.tree, ctx.now);
  cs.update(cmd.id, { collapsed });
  return { changes: cs.list(), affectedNodeIds: [cmd.id] };
}

/** Sibling-order helpers used by Alt+Shift+Up/Down. */
export function moveUpCommand(ctx: CommandContext, id: string): Command | null {
  const node = ctx.tree.get(id);
  const prev = previousSibling(ctx.tree, id);
  if (!node || prev === null) return null;
  return { type: 'moveNode', id, parentId: node.parentId, at: { before: prev } };
}

export function moveDownCommand(ctx: CommandContext, id: string): Command | null {
  const node = ctx.tree.get(id);
  const next = nextSibling(ctx.tree, id);
  if (!node || next === null) return null;
  return { type: 'moveNode', id, parentId: node.parentId, at: { after: next } };
}
