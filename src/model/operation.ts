import type { Node } from './node';

/**
 * One node's before/after snapshot inside an operation.
 * `before === null` means the node was created; `after === null` means it was
 * physically removed (only happens when undoing a creation).
 */
export interface NodeChange {
  id: string;
  before: Node | null;
  after: Node | null;
}

export interface Operation {
  id: string;
  /** Command type, or 'undo' / 'redo'. */
  type: string;
  /** The command input as submitted (JSON-serialisable). */
  input: unknown;
  changes: NodeChange[];
  /** Nodes whose derived data (search index, embeddings, ...) may be stale. */
  affectedNodeIds: string[];
  timestamp: number;
  /** For undo/redo: the id of the operation being reverted / reapplied. */
  targetOpId?: string;
}

export interface DirtyNode {
  nodeId: string;
  markedAt: number;
}
