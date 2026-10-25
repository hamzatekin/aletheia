import { describe, expect, it } from 'vitest';
import { createTreeStore, readerOf } from '@/store/tree-store';
import { ancestorIds, descendantIds, isSelfOrDescendant, nextSibling, outlineLines, previousSibling, visibleRows } from './tree';
import type { Node } from './node';
import { fixture } from '@/test/helpers';

describe('tree helpers', () => {
  const f = fixture([['A', ['A1', ['A2', ['A2a']]]], 'B']);
  const { engine, ids } = f;

  it('ancestorIds walks up to the top', () => {
    expect(ancestorIds(engine.tree, ids.A2a!)).toEqual([ids.A2, ids.A]);
    expect(ancestorIds(engine.tree, ids.A!)).toEqual([]);
  });

  it('descendantIds is depth-first document order', () => {
    expect(descendantIds(engine.tree, ids.A!)).toEqual([ids.A1, ids.A2, ids.A2a]);
    expect(descendantIds(engine.tree, ids.B!)).toEqual([]);
  });

  it('isSelfOrDescendant', () => {
    expect(isSelfOrDescendant(engine.tree, ids.A!, ids.A!)).toBe(true);
    expect(isSelfOrDescendant(engine.tree, ids.A!, ids.A2a!)).toBe(true);
    expect(isSelfOrDescendant(engine.tree, ids.A2a!, ids.A!)).toBe(false);
    expect(isSelfOrDescendant(engine.tree, ids.A!, ids.B!)).toBe(false);
  });

  it('visibleRows skips collapsed subtrees and respects zoom root', () => {
    expect(visibleRows(engine.tree, null).map((r) => [f.node(labelOf(r.id)).content, r.depth])).toEqual([
      ['A', 0],
      ['A1', 1],
      ['A2', 1],
      ['A2a', 2],
      ['B', 0],
    ]);
    engine.execute({ type: 'toggleCollapse', id: ids.A2! });
    expect(visibleRows(engine.tree, null).map((r) => labelOf(r.id))).toEqual(['A', 'A1', 'A2', 'B']);
    expect(visibleRows(engine.tree, ids.A!).map((r) => labelOf(r.id))).toEqual(['A1', 'A2']);
    engine.undo();
  });

  it('visibleRows shows done rows unless asked to hide them, with what is under them', () => {
    engine.execute({ type: 'toggleComplete', id: ids.A2! });
    expect(visibleRows(engine.tree, null).map((r) => labelOf(r.id))).toEqual(['A', 'A1', 'A2', 'A2a', 'B']);
    expect(visibleRows(engine.tree, null, true).map((r) => labelOf(r.id))).toEqual(['A', 'A1', 'B']);
    engine.undo();
  });

  function labelOf(id: string): string {
    return engine.tree.get(id)!.content;
  }
});

describe('sibling and outline helpers', () => {
  const f = fixture([['A', ['A1', ['A2', ['A2a', 'A2b']], 'A3']], 'B']);
  const { engine, ids } = f;
  const tree = engine.tree;

  it('previousSibling / nextSibling stay among siblings', () => {
    expect(previousSibling(tree, ids.A2!)).toBe(ids.A1);
    expect(nextSibling(tree, ids.A2!)).toBe(ids.A3);
    expect(previousSibling(tree, ids.A1!)).toBeNull();
    expect(nextSibling(tree, ids.A3!)).toBeNull();
    expect(nextSibling(tree, ids.A!)).toBe(ids.B);
    expect(previousSibling(tree, ids.B!)).toBe(ids.A);
    expect(previousSibling(tree, 'missing')).toBeNull();
    expect(nextSibling(tree, 'missing')).toBeNull();
  });

  it('outlineLines indents by depth, skips empty text but keeps its children, and stops at max', () => {
    const text = (id: string) => (id === ids.A2 ? '' : tree.get(id)!.content);
    expect(outlineLines(tree, ids.A!, 10, text)).toEqual(['- A1', '  - A2a', '  - A2b', '- A3']);
    expect(outlineLines(tree, ids.A!, 2, text)).toEqual(['- A1', '  - A2a']);
    expect(outlineLines(tree, ids.A!, 0, text)).toEqual([]);
    expect(outlineLines(tree, ids.B!, 10, text)).toEqual([]);
    const all = (id: string) => tree.get(id)!.content;
    expect(outlineLines(tree, ids.A!, 3, all)).toEqual(['- A1', '- A2', '  - A2a']);
  });

  it('ancestorIds stops at a cycle instead of looping', () => {
    const node = (id: string, parentId: string | null): Node => ({ id, parentId, order: 'a0', content: id, note: '', collapsed: false, createdAt: 1, updatedAt: 1, deletedAt: null });
    const store = createTreeStore();
    store.getState().load([node('x', 'y'), node('y', 'z'), node('z', 'x')]);
    const cyclic = readerOf(store);
    expect(ancestorIds(cyclic, 'x')).toEqual(['y', 'z']);
    store.getState().load([node('t', 'x'), node('x', 'y'), node('y', 'x')]);
    expect(ancestorIds(cyclic, 't')).toEqual(['x', 'y']);
    expect(isSelfOrDescendant(cyclic, 'q', 'x')).toBe(false);
  });
});
