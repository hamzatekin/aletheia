import Dexie, { type EntityTable } from 'dexie';
import type { OutboxEntry } from '@/sync/outbox';
import type { Node, Operation } from '@/model';

export class AletheiaDB extends Dexie {
  nodes!: EntityTable<Node, 'id'>;
  operations!: EntityTable<Operation, 'id'>;
  /** Sync: node changes not yet uploaded. */
  outbox!: EntityTable<OutboxEntry, 'nodeId'>;
  /** Sync: key, cursor. */
  meta!: Dexie.Table<{ key: string; value: unknown }, string>;

  constructor(name = 'aletheia') {
    super(name);
    // dirtyNodes, embeddings, summaries, tags and relations are no longer
    // used. They stay in the schema because dropping a table needs a version
    // upgrade, which would close the database in every other open tab.
    this.version(1).stores({
      nodes: 'id, parentId, deletedAt',
      operations: 'id, timestamp',
      dirtyNodes: 'nodeId',
      embeddings: 'nodeId, model',
      summaries: 'nodeId, model',
      tags: '[nodeId+tag], nodeId, tag',
      relations: '[sourceId+targetId+kind], sourceId, targetId',
    });
    this.version(2).stores({
      outbox: 'nodeId',
      meta: 'key',
    });
  }
}
