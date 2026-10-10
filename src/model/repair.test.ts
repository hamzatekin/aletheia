import { describe, expect, it } from 'vitest';
import { createTreeStore, readerOf } from '@/store/tree-store';
import type { Node } from './node';
import { repairTree } from './repair';

const NOW = 9000;

function node(id: string, parentId: string | null, order: string, fields: Partial<Node> = {}): Node {
  return { id, parentId, order, content: id, note: '', collapsed: false, createdAt: 1, updatedAt: 1, deletedAt: null, ...fields };
}

function treeOf(nodes: Node[]) {
  const store = createTreeStore();
  store.getState().load(nodes);
  return readerOf(store);
}

describe('repairTree', () => {
  it('changes nothing in a valid tree, deleted subtrees included', () => {
    const tree = treeOf([node('a', null, 'a0'), node('b', 'a', 'a0'), node('c', null, 'a1', { deletedAt: 5 }), node('d', 'c', 'a0', { deletedAt: 5 })]);
    expect(repairTree(tree, NOW)).toEqual([]);
  });

  it('brings back every deleted ancestor of a live node', () => {
    const p = node('p', null, 'a0', { deletedAt: 5 });
    const q = node('q', 'p', 'a0', { deletedAt: 5 });
    const tree = treeOf([p, q, node('c', 'q', 'a0')]);
    const fixed = repairTree(tree, NOW);
    expect(fixed).toHaveLength(2);
    expect(fixed).toEqual(expect.arrayContaining([
      { ...p, deletedAt: null, updatedAt: NOW },
      { ...q, deletedAt: null, updatedAt: NOW },
    ]));
  });

  it('moves a live node with a missing parent to the end of the top level', () => {
    const tree = treeOf([node('a', null, 'a0'), node('b', null, 'a1'), node('orphan', 'gone', 'a5')]);
    expect(repairTree(tree, NOW)).toEqual([{ ...node('orphan', null, 'a2'), updatedAt: NOW }]);
  });

  it('places several orphans one after another', () => {
    const tree = treeOf([node('x', 'gone1', 'a0'), node('y', 'gone2', 'a0')]);
    const fixed = repairTree(tree, NOW);
    expect(fixed.map((n) => [n.id, n.parentId, n.order])).toEqual([
      ['x', null, 'a0'],
      ['y', null, 'a1'],
    ]);
  });

  it('leaves a deleted node with a missing parent alone', () => {
    expect(repairTree(treeOf([node('d', 'gone', 'a0', { deletedAt: 5 })]), NOW)).toEqual([]);
  });

  it('breaks a cycle by moving its smallest id to the top level, wherever the walk starts', () => {
    const nodes = [node('a', null, 'a0'), node('m', 'k', 'a0'), node('k', 'z', 'a0'), node('z', 'm', 'a0')];
    for (const order of [nodes, [...nodes].reverse()]) {
      const fixed = repairTree(treeOf(order), NOW);
      expect(fixed).toEqual([{ ...node('k', null, 'a1'), updatedAt: NOW }]);
    }
  });

  it('moves only the cycle member, not a node hanging off the cycle with a smaller id', () => {
    // 'a' is walked first and leads into the cycle m -> k -> z -> m.
    const tree = treeOf([node('a', 'm', 'a0'), node('m', 'k', 'a0'), node('k', 'z', 'a0'), node('z', 'm', 'a0')]);
    expect(repairTree(tree, NOW)).toEqual([{ ...node('k', null, 'a0'), updatedAt: NOW }]);
  });

  it('breaks a node that is its own parent', () => {
    const fixed = repairTree(treeOf([node('s', 's', 'a0')]), NOW);
    expect(fixed).toEqual([{ ...node('s', null, 'a0'), updatedAt: NOW }]);
  });
});
