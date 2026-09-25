import type { Node, NodeChange, TreeReader } from '@/model';

/**
 * Accumulates node changes for one command. Reads see pending writes, so a
 * command can touch the same node twice and the change stays coalesced.
 */
export class ChangeSet {
  private readonly pending = new Map<string, NodeChange>();

  constructor(
    private readonly tree: TreeReader,
    private readonly now: number,
  ) {}

  current(id: string): Node | undefined {
    const p = this.pending.get(id);
    return p ? (p.after ?? undefined) : this.tree.get(id);
  }

  update(id: string, patch: Partial<Omit<Node, 'id' | 'createdAt'>>): Node {
    const before = this.current(id);
    if (!before) throw new Error(`ChangeSet.update: unknown node ${id}`);
    const after: Node = { ...before, ...patch, updatedAt: this.now };
    this.write(id, after);
    return after;
  }

  create(node: Omit<Node, 'createdAt' | 'updatedAt' | 'deletedAt'>): Node {
    if (this.current(node.id)) throw new Error(`ChangeSet.create: node ${node.id} already exists`);
    const after: Node = { ...node, createdAt: this.now, updatedAt: this.now, deletedAt: null };
    this.write(node.id, after);
    return after;
  }

  private write(id: string, after: Node): void {
    const existing = this.pending.get(id);
    if (existing) existing.after = after;
    else this.pending.set(id, { id, before: this.tree.get(id) ?? null, after });
  }

  list(): NodeChange[] {
    return [...this.pending.values()];
  }
}
