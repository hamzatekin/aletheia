import { describe, expect, it } from 'vitest';
import { seedNodes } from './seed';
import { createTreeStore, readerOf } from '@/store/tree-store';
import { visibleRows } from './tree';

describe('seedNodes', () => {
  it('builds a small, well-formed tree', () => {
    const nodes = seedNodes(123);
    const store = createTreeStore();
    store.getState().load(nodes);
    const tree = readerOf(store);
    expect(tree.children(null)).toHaveLength(3);
    expect(visibleRows(tree, null)).toHaveLength(nodes.length);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    for (const n of nodes) expect(n.parentId === null || tree.get(n.parentId)).toBeTruthy();
  });
});
