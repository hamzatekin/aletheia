import type { DirtyNode, Node, Operation } from '@/model';
import { entriesForChanges, entriesForReplace, mergeEntry, sameTimes, type OutboxEntry } from '@/sync/outbox';
import { REMOTE_OP, type CommitBatch, type SyncRepository } from './repository';

/** In-memory repository for tests and for running without IndexedDB. */
export class MemoryRepository implements SyncRepository {
  readonly nodes = new Map<string, Node>();
  readonly operations: Operation[] = [];
  readonly dirty = new Map<string, DirtyNode>();
  readonly outbox = new Map<string, OutboxEntry>();
  readonly meta = new Map<string, unknown>();
  private tracking = false;

  async loadAllNodes(): Promise<Node[]> {
    return [...this.nodes.values()];
  }

  async commit(batch: CommitBatch): Promise<void> {
    for (const n of batch.upserts) this.nodes.set(n.id, n);
    for (const id of batch.removals) this.nodes.delete(id);
    this.operations.push(batch.operation);
    const markedAt = batch.operation.timestamp;
    for (const nodeId of batch.dirtyNodeIds) this.dirty.set(nodeId, { nodeId, markedAt });
    if (this.tracking && batch.operation.type !== REMOTE_OP) {
      this.merge(entriesForChanges(batch.operation.changes, batch.operation.timestamp));
    }
  }

  async listOperations(): Promise<Operation[]> {
    return [...this.operations];
  }

  async listDirty(): Promise<DirtyNode[]> {
    return [...this.dirty.values()];
  }

  async clearDirty(nodeIds: string[]): Promise<void> {
    for (const id of nodeIds) this.dirty.delete(id);
  }

  async replaceAllNodes(nodes: Node[]): Promise<void> {
    const oldIds = [...this.nodes.keys()];
    this.nodes.clear();
    for (const n of nodes) this.nodes.set(n.id, n);
    this.dirty.clear();
    if (this.tracking) this.merge(entriesForReplace(oldIds, nodes, Date.now()));
  }

  setTracking(on: boolean): void {
    this.tracking = on;
  }

  async listOutbox(limit: number): Promise<OutboxEntry[]> {
    return [...this.outbox.values()].slice(0, limit);
  }

  async getOutbox(nodeIds: readonly string[]): Promise<Map<string, OutboxEntry>> {
    const out = new Map<string, OutboxEntry>();
    for (const id of nodeIds) {
      const e = this.outbox.get(id);
      if (e) out.set(id, e);
    }
    return out;
  }

  async enqueue(entries: readonly OutboxEntry[]): Promise<void> {
    this.merge(entries);
  }

  async ackOutbox(sent: readonly OutboxEntry[]): Promise<void> {
    for (const e of sent) {
      const now = this.outbox.get(e.nodeId);
      if (now && sameTimes(now.t, e.t)) this.outbox.delete(e.nodeId);
    }
  }

  async clearOutbox(): Promise<void> {
    this.outbox.clear();
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.meta.get(key) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, value);
  }

  async deleteMeta(key: string): Promise<void> {
    this.meta.delete(key);
  }

  private merge(entries: readonly OutboxEntry[]): void {
    for (const e of entries) this.outbox.set(e.nodeId, mergeEntry(this.outbox.get(e.nodeId), e));
  }
}
