import type { DirtyNode, Node, Operation } from '@/model';
import { entriesForChanges, entriesForReplace, mergeEntry, sameTimes, type OutboxEntry } from '@/sync/outbox';
import { AletheiaDB } from './db';
import { REMOTE_OP, type CommitBatch, type SyncRepository } from './repository';

export class DexieRepository implements SyncRepository {
  private tracking = false;

  constructor(readonly db: AletheiaDB = new AletheiaDB()) {}

  loadAllNodes(): Promise<Node[]> {
    return this.db.nodes.toArray();
  }

  commit(batch: CommitBatch): Promise<void> {
    const { db } = this;
    const track = this.tracking && batch.operation.type !== REMOTE_OP;
    return db.transaction('rw', [db.nodes, db.operations, db.dirtyNodes, db.outbox], async () => {
      if (batch.upserts.length > 0) await db.nodes.bulkPut(batch.upserts);
      if (batch.removals.length > 0) await db.nodes.bulkDelete(batch.removals);
      await db.operations.put(batch.operation);
      if (batch.dirtyNodeIds.length > 0) {
        const markedAt = batch.operation.timestamp;
        await db.dirtyNodes.bulkPut(batch.dirtyNodeIds.map((nodeId) => ({ nodeId, markedAt })));
      }
      if (track) await this.mergeIntoOutbox(entriesForChanges(batch.operation.changes, batch.operation.timestamp));
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
    const track = this.tracking;
    return db.transaction('rw', [db.nodes, db.dirtyNodes, db.outbox], async () => {
      const oldIds = track ? ((await db.nodes.toCollection().primaryKeys()) as string[]) : [];
      await db.nodes.clear();
      await db.dirtyNodes.clear();
      await db.nodes.bulkAdd(nodes);
      if (track) await this.mergeIntoOutbox(entriesForReplace(oldIds, nodes, Date.now()));
    });
  }

  // --- SyncStorage ---

  setTracking(on: boolean): void {
    this.tracking = on;
  }

  listOutbox(limit: number): Promise<OutboxEntry[]> {
    return this.db.outbox.limit(limit).toArray();
  }

  async getOutbox(nodeIds: readonly string[]): Promise<Map<string, OutboxEntry>> {
    const rows = await this.db.outbox.bulkGet([...nodeIds]);
    const out = new Map<string, OutboxEntry>();
    for (const r of rows) if (r) out.set(r.nodeId, r);
    return out;
  }

  enqueue(entries: readonly OutboxEntry[]): Promise<void> {
    return this.db.transaction('rw', this.db.outbox, () => this.mergeIntoOutbox(entries));
  }

  ackOutbox(sent: readonly OutboxEntry[]): Promise<void> {
    const { db } = this;
    return db.transaction('rw', db.outbox, async () => {
      const current = await db.outbox.bulkGet(sent.map((e) => e.nodeId));
      const done = sent.filter((e, i) => {
        const now = current[i];
        return now !== undefined && sameTimes(now.t, e.t);
      });
      await db.outbox.bulkDelete(done.map((e) => e.nodeId));
    });
  }

  clearOutbox(): Promise<void> {
    return this.db.outbox.clear();
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  deleteMeta(key: string): Promise<void> {
    return this.db.meta.delete(key);
  }

  /** Call inside a transaction that includes `outbox`. */
  private async mergeIntoOutbox(entries: readonly OutboxEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const ids = [...new Set(entries.map((e) => e.nodeId))];
    const existing = await this.db.outbox.bulkGet(ids);
    const merged = new Map<string, OutboxEntry>();
    ids.forEach((id, i) => {
      const e = existing[i];
      if (e) merged.set(id, e);
    });
    for (const e of entries) merged.set(e.nodeId, mergeEntry(merged.get(e.nodeId), e));
    await this.db.outbox.bulkPut([...merged.values()]);
  }
}
