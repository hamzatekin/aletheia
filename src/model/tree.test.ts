import { describe, expect, it } from 'vitest';
import { ancestorIds, descendantIds, isSelfOrDescendant, nextVisible, previousVisible, visibleRows } from './tree';
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
    expect(previousVisible(engine.tree, null, ids.B!)).toBe(ids.A2);
    expect(nextVisible(engine.tree, null, ids.A2!)).toBe(ids.B);
    expect(previousVisible(engine.tree, null, ids.A!)).toBeNull();
    expect(nextVisible(engine.tree, null, ids.B!)).toBeNull();
    engine.undo();
  });

  function labelOf(id: string): string {
    return engine.tree.get(id)!.content;
  }
});
