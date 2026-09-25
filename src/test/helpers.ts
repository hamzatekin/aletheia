import { createEngine, type Engine } from '@/commands';
import { newId, type Node } from '@/model';
import { MemoryRepository } from '@/persistence';
import { createTreeStore } from '@/store/tree-store';

export type Spec = string | [string, Spec[]];

export interface Fixture {
  engine: Engine;
  repo: MemoryRepository;
  ids: Record<string, string>;
  /** Content labels of live children of `label` (or top level for null). */
  kids(label: string | null): string[];
  node(label: string): Node;
  tick(): number;
}

/** Fake clock: each call advances by 1s so timestamps are distinct and deterministic. */
export function makeClock(start = 1_000_000): () => number {
  let t = start;
  return () => (t += 1000);
}

export function fixture(spec: Spec[] = []): Fixture {
  const store = createTreeStore();
  const repo = new MemoryRepository();
  const clock = makeClock();
  const engine = createEngine({ store, repository: repo, now: clock });
  const ids: Record<string, string> = {};

  const add = (parentId: string | null, items: Spec[]): void => {
    for (const item of items) {
      const [label, children] = typeof item === 'string' ? [item, []] : item;
      const id = newId();
      ids[label] = id;
      const r = engine.execute({ type: 'createNode', id, parentId, content: label });
      if (!r.ok) throw new Error(`fixture: ${r.reason}`);
      add(id, children);
    }
  };
  add(null, spec);

  const labelOf = (id: string): string => store.getState().nodes.get(id)!.content;
  return {
    engine,
    repo,
    ids,
    kids: (label) => engine.tree.children(label === null ? null : ids[label]!).map(labelOf),
    node: (label) => {
      const n = store.getState().nodes.get(ids[label]!);
      if (!n) throw new Error(`no node ${label}`);
      return n;
    },
    tick: clock,
  };
}

/** Nested outline of live nodes as labels, e.g. [['A', ['A1']], 'B']. */
export function outline(f: Fixture, root: string | null = null): Spec[] {
  const labelOf = (id: string): string => f.engine.tree.get(id)!.content;
  const walk = (pid: string | null): Spec[] =>
    f.engine.tree.children(pid).map((id) => {
      const kids = walk(id);
      return kids.length === 0 ? labelOf(id) : [labelOf(id), kids];
    });
  return walk(root === null ? null : f.ids[root]!);
}

export function ok<T extends { ok: boolean }>(r: T | null): asserts r is T & { ok: true } {
  if (!r || !r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
}
