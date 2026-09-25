import { createNode, mergeNodes, splitNode, updateContent, updateNote } from './content-commands';
import { deleteSubtree, restore } from './delete-commands';
import { indent, moveNode, outdent, toggleCollapse } from './structure-commands';
import type { Command, CommandContext, Effect, Rejection } from './types';

/** Pure: compute what a command would change against the given tree. */
export function computeEffect(ctx: CommandContext, cmd: Command): Effect | Rejection {
  switch (cmd.type) {
    case 'createNode':
      return createNode(ctx, cmd);
    case 'updateContent':
      return updateContent(ctx, cmd);
    case 'updateNote':
      return updateNote(ctx, cmd);
    case 'splitNode':
      return splitNode(ctx, cmd);
    case 'mergeNodes':
      return mergeNodes(ctx, cmd);
    case 'moveNode':
      return moveNode(ctx, cmd);
    case 'indent':
      return indent(ctx, cmd);
    case 'outdent':
      return outdent(ctx, cmd);
    case 'toggleCollapse':
      return toggleCollapse(ctx, cmd);
    case 'deleteSubtree':
      return deleteSubtree(ctx, cmd);
    case 'restore':
      return restore(ctx, cmd);
  }
}
