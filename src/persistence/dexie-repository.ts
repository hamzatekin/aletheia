import type { DirtyNode, Node, Operation } from '@/model';
import { AletheiaDB } from './db';
import type { CommitBatch, Repository } from './repository';

export class DexieRepository implements Repository {
  constructor(readonly db: AletheiaDB = new AletheiaDB()) {}

  loadAllNodes(): Promise<Node[]> {
    return this.db.nodes.toArray();
  }

  commit(batch: CommitBatch): Promise<void> {
    const { db } = this;
    return db.transaction('rw', db.nodes, db.operations, db.dirtyNodes, async () => {
      if (batch.upserts.length > 0) await db.nodes.bulkPut(batch.upserts);
      if (batch.removals.length > 0) await db.nodes.bulkDelete(batch.removals);
      await db.operations.put(batch.operation);
      if (batch.dirtyNodeIds.length > 0) {
        const markedAt = batch.operation.timestamp;
        await db.dirtyNodes.bulkPut(batch.dirtyNodeIds.map((nodeId) => ({ nodeId, markedAt })));
      }
    });
  }

  listOperations(): Promise<Operation[]> {
    return this.db.operations.orderBy('timestamp').toArray();
  }

  listDirty(): Promise<DirtyNode[]> {
    return this.db.dirtyNodes.toArray();
  }

  clearDirty(nodeIds: string[]): Promise<void> {
    return this.db.dirtyNodes.bulkDelete(nodeIds);
  }

  replaceAllNodes(nodes: Node[]): Promise<void> {
    const { db } = this;
    return db.transaction('rw', db.nodes, db.dirtyNodes, async () => {
      await db.nodes.clear();
      await db.dirtyNodes.clear();
      await db.nodes.bulkAdd(nodes);
    });
  }
}
