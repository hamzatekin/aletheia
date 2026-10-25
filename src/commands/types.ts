import type { NodeChange, TreeReader } from '@/model';

/** Where to place a node among its siblings. */
export type Position = 'first' | 'last' | { after: string } | { before: string };

export type Command =
  | { type: 'createNode'; id: string; parentId: string | null; at?: Position; content?: string; note?: string }
  | { type: 'updateContent'; id: string; content: string }
  | { type: 'updateNote'; id: string; note: string }
  /** Split `id` at the caret: it keeps `left`, `newId` receives `right`. */
  | { type: 'splitNode'; id: string; newId: string; left: string; right: string }
  /** Append `sourceId`'s content to `targetId`, move its children, soft-delete it. */
  | { type: 'mergeNodes'; sourceId: string; targetId: string }
  | { type: 'moveNode'; id: string; parentId: string | null; at?: Position }
  | { type: 'indent'; id: string }
  | { type: 'outdent'; id: string }
  | { type: 'toggleCollapse'; id: string; collapsed?: boolean }
  /** Star (list under Starred in the sidebar) or unstar a node; omitted `starred` flips it. */
  | { type: 'toggleStar'; id: string; starred?: boolean }
  /** Mark a node done or not done; omitted `completed` flips it. */
  | { type: 'toggleComplete'; id: string; completed?: boolean }
  /** Make a node a heading (1 to 3) or a normal row (null). */
  | { type: 'setHeading'; id: string; heading: number | null }
  /** Give a node a color label (one of `COLORS`) or none (null). */
  | { type: 'setColor'; id: string; color: string | null }
  | { type: 'deleteSubtree'; id: string }
  /** Delete `id` but keep its children: they take its place under its parent. */
  | { type: 'deleteNode'; id: string }
  /** Bring back a deleted node with what was deleted along with it (Recently deleted). */
  | { type: 'restoreNode'; id: string };

/** The command of one type, e.g. `CommandOf<'indent'>`. */
export type CommandOf<T extends Command['type']> = Extract<Command, { type: T }>;

export interface CommandContext {
  tree: TreeReader;
  now: number;
}

/** Caret hint for the view layer: `offset` is into the node's Markdown content. */
export interface FocusHint {
  id: string;
  offset: number;
}

export interface Effect {
  changes: NodeChange[];
  focus?: FocusHint;
}

export class Rejection {
  constructor(readonly reason: string) {}
}

export function isRejection(x: Effect | Rejection): x is Rejection {
  return x instanceof Rejection;
}
