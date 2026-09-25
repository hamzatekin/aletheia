import type { DirtyNode, Node, Operation } from '@/model';

/** Everything one command writes, applied atomically. */
export interface CommitBatch {
  /** Nodes to upsert (new versions). */
  upserts: Node[];
  /** Nodes to physically remove (only when undoing a creation). */
  removals: string[];
  operation: Operation;
  dirtyNodeIds: string[];
}

/**
 * Storage boundary. Dexie today; SQLite / a sync backend later.
 * The store is the in-memory source of truth; the repository just persists it.
 */
export interface Repository {
  loadAllNodes(): Promise<Node[]>;
  commit(batch: CommitBatch): Promise<void>;
  listOperations(): Promise<Operation[]>;
  listDirty(): Promise<DirtyNode[]>;
  clearDirty(nodeIds: string[]): Promise<void>;
  /** Replace all nodes (import / restore from backup). Clears dirty marks. */
  replaceAllNodes(nodes: Node[]): Promise<void>;
}
