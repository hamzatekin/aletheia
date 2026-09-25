import type { DirtyNode, Node, Operation } from '@/model';
import type { CommitBatch, Repository } from './repository';

/** In-memory repository for tests and for running without IndexedDB. */
export class MemoryRepository implements Repository {
  readonly nodes = new Map<string, Node>();
  readonly operations: Operation[] = [];
  readonly dirty = new Map<string, DirtyNode>();

  async loadAllNodes(): Promise<Node[]> {
    return [...this.nodes.values()];
  }

  async commit(batch: CommitBatch): Promise<void> {
    for (const n of batch.upserts) this.nodes.set(n.id, n);
    for (const id of batch.removals) this.nodes.delete(id);
    this.operations.push(batch.operation);
    const markedAt = batch.operation.timestamp;
    for (const nodeId of batch.dirtyNodeIds) this.dirty.set(nodeId, { nodeId, markedAt });
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
    this.nodes.clear();
    for (const n of nodes) this.nodes.set(n.id, n);
    this.dirty.clear();
  }
}
