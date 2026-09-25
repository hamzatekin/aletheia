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
  | { type: 'deleteSubtree'; id: string }
  | { type: 'restore'; id: string };

export type CommandType = Command['type'];

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
  /**
   * Nodes whose derived data may be stale. Move-like commands include all
   * descendants; child add/remove/reorder includes the parent.
   */
  affectedNodeIds: string[];
  focus?: FocusHint;
}

export class Rejection {
  readonly rejected = true as const;
  constructor(readonly reason: string) {}
}

export function isRejection(x: Effect | Rejection): x is Rejection {
  return x instanceof Rejection;
}
