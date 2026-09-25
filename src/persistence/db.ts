import Dexie, { type EntityTable } from 'dexie';
import type {
  DirtyNode,
  EmbeddingRow,
  Node,
  Operation,
  RelationRow,
  SummaryRow,
  TagRow,
} from '@/model';

export class AletheiaDB extends Dexie {
  nodes!: EntityTable<Node, 'id'>;
  operations!: EntityTable<Operation, 'id'>;
  dirtyNodes!: EntityTable<DirtyNode, 'nodeId'>;
  // Empty, typed tables reserved for future on-demand AI features. No UI.
  embeddings!: EntityTable<EmbeddingRow, 'nodeId'>;
  summaries!: EntityTable<SummaryRow, 'nodeId'>;
  tags!: Dexie.Table<TagRow, [string, string]>;
  relations!: Dexie.Table<RelationRow, [string, string, string]>;

  constructor(name = 'aletheia') {
    super(name);
    this.version(1).stores({
      nodes: 'id, parentId, deletedAt',
      operations: 'id, timestamp',
      dirtyNodes: 'nodeId',
      embeddings: 'nodeId, model',
      summaries: 'nodeId, model',
      tags: '[nodeId+tag], nodeId, tag',
      relations: '[sourceId+targetId+kind], sourceId, targetId',
    });
  }
}
