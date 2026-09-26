import type { DirtyNode, Node, Operation } from '@/model';
import type { OutboxEntry } from '@/sync/outbox';

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

/**
 * What sync needs from storage: an outbox of changes not yet uploaded, and a
 * few values (sync key, cursor). While tracking is on, `commit` and
 * `replaceAllNodes` record every change in the outbox, in the same
 * transaction, except operations of type `REMOTE_OP` (changes that came from
 * the server).
 */
export interface SyncStorage {
  setTracking(on: boolean): void;
  listOutbox(limit: number): Promise<OutboxEntry[]>;
  getOutbox(nodeIds: readonly string[]): Promise<Map<string, OutboxEntry>>;
  /** Merge entries into the outbox. */
  enqueue(entries: readonly OutboxEntry[]): Promise<void>;
  /** Drop uploaded entries, unless they changed again since they were read. */
  ackOutbox(sent: readonly OutboxEntry[]): Promise<void>;
  clearOutbox(): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  deleteMeta(key: string): Promise<void>;
}

/** Operation type for changes pulled from the sync server. Never re-uploaded. */
export const REMOTE_OP = 'remote';

export type SyncRepository = Repository & SyncStorage;
