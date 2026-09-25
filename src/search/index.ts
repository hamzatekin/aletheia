import MiniSearch, { type SearchResult } from 'minisearch';
import type { Engine } from '@/commands';
import { plainText } from '@/editor/markdown';
import type { Node, Operation } from '@/model';

interface Doc {
  id: string;
  content: string;
  note: string;
}

export interface Hit {
  id: string;
  score: number;
}

function toDoc(node: Node): Doc {
  return { id: node.id, content: plainText(node.content), note: node.note };
}

/**
 * Full-text index over content + note, kept current from engine operations.
 * Only live nodes are indexed.
 */
export class SearchIndex {
  private readonly mini = new MiniSearch<Doc>({
    fields: ['content', 'note'],
    storeFields: [],
    searchOptions: { boost: { content: 2 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
  });
  private readonly unsubscribe: () => void;

  constructor(private readonly engine: Engine) {
    this.rebuild();
    this.unsubscribe = engine.onOperation((op) => this.apply(op));
  }

  rebuild(): void {
    this.mini.removeAll();
    const docs: Doc[] = [];
    for (const node of this.engine.tree.all()) if (node.deletedAt === null) docs.push(toDoc(node));
    this.mini.addAll(docs);
  }

  private apply(op: Operation): void {
    for (const { id, after } of op.changes) {
      if (this.mini.has(id)) this.mini.discard(id);
      if (after && after.deletedAt === null) this.mini.add(toDoc(after));
    }
  }

  search(query: string, limit = 20): Hit[] {
    const q = query.trim();
    if (q === '') return [];
    return this.mini.search(q).slice(0, limit).map((r: SearchResult) => ({ id: r.id as string, score: r.score }));
  }

  get size(): number {
    return this.mini.documentCount;
  }

  destroy(): void {
    this.unsubscribe();
  }
}
