import { descendantIds, isLive, isSelfOrDescendant, orderBetween } from '@/model';
import { ChangeSet } from './changes';
import { orderFor, parentNodeIds, unique } from './position';
import { Rejection, type Command, type CommandContext, type Effect } from './types';

type Of<T extends Command['type']> = Extract<Command, { type: T }>;

export function createNode(ctx: CommandContext, cmd: Of<'createNode'>): Effect | Rejection {
  const { tree } = ctx;
  if (tree.get(cmd.id)) return new Rejection('node already exists');
  if (cmd.parentId !== null && !isLive(tree.get(cmd.parentId))) return new Rejection('parent is missing or deleted');
  const order = orderFor(tree, cmd.parentId, cmd.at ?? 'last');
  if (order === null) return new Rejection('anchor sibling not found');

  const cs = new ChangeSet(tree, ctx.now);
  cs.create({
    id: cmd.id,
    parentId: cmd.parentId,
    order,
    content: cmd.content ?? '',
    note: cmd.note ?? '',
    collapsed: false,
  });
  return {
    changes: cs.list(),
    affectedNodeIds: [cmd.id, ...parentNodeIds(cmd.parentId)],
    focus: { id: cmd.id, offset: 0 },
  };
}

export function updateContent(ctx: CommandContext, cmd: Of<'updateContent'>): Effect | Rejection {
  const node = ctx.tree.get(cmd.id);
  if (!isLive(node)) return new Rejection('node is missing or deleted');
  if (node.content === cmd.content) return { changes: [], affectedNodeIds: [] };
  const cs = new ChangeSet(ctx.tree, ctx.now);
  cs.update(cmd.id, { content: cmd.content });
  return { changes: cs.list(), affectedNodeIds: [cmd.id] };
}

export function updateNote(ctx: CommandContext, cmd: Of<'updateNote'>): Effect | Rejection {
  const node = ctx.tree.get(cmd.id);
  if (!isLive(node)) return new Rejection('node is missing or deleted');
  if (node.note === cmd.note) return { changes: [], affectedNodeIds: [] };
  const cs = new ChangeSet(ctx.tree, ctx.now);
  cs.update(cmd.id, { note: cmd.note });
  return { changes: cs.list(), affectedNodeIds: [cmd.id] };
}

/**
 * Split at the caret.
 * - Caret at the start of a non-empty node: a new empty node is inserted
 *   *above*; the original keeps its content and focus stays on it.
 * - Node is expanded with children: the new node becomes its first child.
 * - Otherwise: the new node becomes the next sibling.
 */
export function splitNode(ctx: CommandContext, cmd: Of<'splitNode'>): Effect | Rejection {
  const { tree } = ctx;
  const node = tree.get(cmd.id);
  if (!isLive(node)) return new Rejection('node is missing or deleted');
  if (tree.get(cmd.newId)) return new Rejection('newId already exists');

  const cs = new ChangeSet(tree, ctx.now);
  const insertAbove = cmd.left === '' && cmd.right !== '';
  const hasVisibleChildren = !node.collapsed && tree.children(node.id).length > 0;

  let parentId: string | null;
  let order: string | null;
  let content: string;
  let focus: Effect['focus'];

  if (insertAbove) {
    parentId = node.parentId;
    order = orderFor(tree, parentId, { before: node.id });
    content = '';
    focus = { id: node.id, offset: 0 };
  } else if (hasVisibleChildren) {
    parentId = node.id;
    order = orderFor(tree, parentId, 'first');
    content = cmd.right;
    focus = { id: cmd.newId, offset: 0 };
  } else {
    parentId = node.parentId;
    order = orderFor(tree, parentId, { after: node.id });
    content = cmd.right;
    focus = { id: cmd.newId, offset: 0 };
  }
  if (order === null) return new Rejection('could not place split node');

  if (!insertAbove && node.content !== cmd.left) cs.update(node.id, { content: cmd.left });
  cs.create({ id: cmd.newId, parentId, order, content, note: '', collapsed: false });

  return {
    changes: cs.list(),
    affectedNodeIds: unique([node.id, cmd.newId, ...parentNodeIds(parentId)]),
    focus,
  };
}

/**
 * Merge `source` into `target`: target.content += source.content, source's
 * children move under target, source is soft-deleted. When target is the
 * source's parent the children take the source's slot; otherwise they are
 * appended after target's existing children.
 */
export function mergeNodes(ctx: CommandContext, cmd: Of<'mergeNodes'>): Effect | Rejection {
  const { tree } = ctx;
  const source = tree.get(cmd.sourceId);
  const target = tree.get(cmd.targetId);
  if (!isLive(source) || !isLive(target)) return new Rejection('node is missing or deleted');
  if (source.id === target.id) return new Rejection('cannot merge a node into itself');
  if (isSelfOrDescendant(tree, source.id, target.id)) return new Rejection('cannot merge a node into its own descendant');

  const cs = new ChangeSet(tree, ctx.now);
  const caret = target.content.length;
  cs.update(target.id, { content: target.content + source.content });

  const kids = tree.children(source.id);
  const affected = new Set<string>([source.id, target.id, ...parentNodeIds(source.parentId)]);

  if (kids.length > 0) {
    let lower: string | null;
    let upper: string | null;
    if (target.id === source.parentId) {
      const sibs = tree.children(target.id);
      const i = sibs.indexOf(source.id);
      lower = i > 0 ? tree.get(sibs[i - 1]!)!.order : null;
      upper = i < sibs.length - 1 ? tree.get(sibs[i + 1]!)!.order : null;
    } else {
      const tkids = tree.children(target.id);
      lower = tkids.length > 0 ? tree.get(tkids[tkids.length - 1]!)!.order : null;
      upper = null;
    }
    for (const kid of kids) {
      lower = orderBetween(lower, upper);
      cs.update(kid, { parentId: target.id, order: lower });
      affected.add(kid);
      for (const d of descendantIds(tree, kid)) affected.add(d);
    }
  }
  cs.update(source.id, { deletedAt: ctx.now });

  return { changes: cs.list(), affectedNodeIds: [...affected], focus: { id: target.id, offset: caret } };
}
