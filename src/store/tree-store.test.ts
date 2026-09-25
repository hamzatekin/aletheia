import { describe, expect, it } from 'vitest';
import { createTreeStore, readerOf } from './tree-store';
import { ROOT, type Node } from '@/model';

function n(id: string, parentId: string | null, order: string, deleted = false): Node {
  return { id, parentId, order, content: id, note: '', collapsed: false, createdAt: 0, updatedAt: 0, deletedAt: deleted ? 1 : null };
}

describe('tree store', () => {
  it('load builds a sorted children index that excludes deleted nodes', () => {
    const store = createTreeStore();
    store.getState().load([n('b', null, 'a2'), n('a', null, 'a1'), n('x', null, 'a0', true), n('a1', 'a', 'a0')]);
    expect(store.getState().childrenByParent.get(ROOT)).toEqual(['a', 'b']);
    expect(store.getState().childrenByParent.get('a')).toEqual(['a1']);
    expect(store.getState().nodes.get('x')).toBeDefined();
  });

  it('applyChanges moves nodes between parents and keeps order', () => {
    const store = createTreeStore();
    store.getState().load([n('a', null, 'a1'), n('b', null, 'a2'), n('c', null, 'a3')]);
    const before = store.getState().nodes.get('c')!;
    store.getState().applyChanges([{ id: 'c', before, after: { ...before, parentId: 'a', order: 'a0' } }]);
    expect(store.getState().childrenByParent.get(ROOT)).toEqual(['a', 'b']);
    expect(store.getState().childrenByParent.get('a')).toEqual(['c']);

    const a = store.getState().nodes.get('a')!;
    store.getState().applyChanges([{ id: 'a', before: a, after: { ...a, order: 'a9' } }]);
    expect(store.getState().childrenByParent.get(ROOT)).toEqual(['b', 'a']);
  });

  it('bumps version and keeps unchanged node references stable', () => {
    const store = createTreeStore();
    store.getState().load([n('a', null, 'a1'), n('b', null, 'a2')]);
    const v = store.getState().version;
    const a = store.getState().nodes.get('a')!;
    const b = store.getState().nodes.get('b')!;
    store.getState().applyChanges([{ id: 'a', before: a, after: { ...a, content: 'A' } }]);
    expect(store.getState().version).toBe(v + 1);
    expect(store.getState().nodes.get('b')).toBe(b);
    expect(store.getState().nodes.get('a')).not.toBe(a);
  });

  it('applyChanges removes nodes when after is null and drops empty buckets', () => {
    const store = createTreeStore();
    store.getState().load([n('a', null, 'a1'), n('a1', 'a', 'a0')]);
    store.getState().applyChanges([{ id: 'a1', before: store.getState().nodes.get('a1')!, after: null }]);
    expect(store.getState().nodes.get('a1')).toBeUndefined();
    expect(store.getState().childrenByParent.get('a')).toBeUndefined();
    expect(readerOf(store).children('a')).toEqual([]);
  });

  it('reader.all iterates deleted nodes too', () => {
    const store = createTreeStore();
    store.getState().load([n('a', null, 'a1'), n('d', null, 'a2', true)]);
    expect([...readerOf(store).all()].map((x) => x.id).sort()).toEqual(['a', 'd']);
  });
});
