/**
 * Typed rows for future, on-demand AI features. No AI is implemented; these
 * only define storage. AI-derived data must never modify Node.content/note.
 */
export interface EmbeddingRow {
  nodeId: string;
  vector: Float32Array | number[];
  model: string;
  contentHash: string;
  updatedAt: number;
}

export interface SummaryRow {
  nodeId: string;
  text: string;
  model: string;
  contentHash: string;
  updatedAt: number;
}

export interface TagRow {
  nodeId: string;
  tag: string;
  source: 'user' | 'ai';
  confidence?: number;
  createdAt: number;
}

export interface RelationRow {
  sourceId: string;
  targetId: string;
  kind: 'semantic' | 'manual';
  score?: number;
  source: 'user' | 'ai';
  createdAt: number;
}
