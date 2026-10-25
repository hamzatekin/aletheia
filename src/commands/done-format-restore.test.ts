import { describe, expect, it } from 'vitest';
import { deletedItems, deletionRoot, type Node, type TreeReader } from '@/model';
import { fixture, ok, outline } from '@/test/helpers';
import { computeEffect } from './dispatch';
import { Rejection, type Command, type Effect } from './types';

const effect = (f: ReturnType<typeof fixture>, cmd: Command) => computeEffect({ tree: f.engine.tree, now: 777 }, cmd);

describe('toggleComplete', () => {
  it('flips by default, an explicit value is idempotent, and undo brings it back', () => {
    const f = fixture(['A']);
    const id = f.ids.A!;
    expect(effect(f, { type: 'toggleComplete', id, completed: false })).toEqual({ changes: [] });
    const done = effect(f, { type: 'toggleComplete', id });
    expect(done).toEqual({ changes: [{ id, before: f.node('A'), after: { ...f.node('A'), completedAt: 777, updatedAt: 777 } }] });
    ok(f.engine.execute({ type: 'toggleComplete', id }));
    const at = f.node('A').completedAt!;
    expect(at).toBeGreaterThan(0);
    expect(effect(f, { type: 'toggleComplete', id, completed: true })).toEqual({ changes: [] });
    ok(f.engine.execute({ type: 'toggleComplete', id }));
    expect(f.node('A').completedAt).toBeNull();
    f.engine.undo();
    expect(f.node('A').completedAt).toBe(at);
    ok(f.engine.execute({ type: 'toggleComplete', id, completed: false }));
    expect(f.node('A').completedAt).toBeNull();
  });
});

describe('setHeading / setColor', () => {
  it('set and clear the value, and do nothing when it is already so', () => {
    const f = fixture(['A']);
    const id = f.ids.A!;
    expect(effect(f, { type: 'setHeading', id, heading: null })).toEqual({ changes: [] });
    expect(effect(f, { type: 'setColor', id, color: null })).toEqual({ changes: [] });
    ok(f.engine.execute({ type: 'setHeading', id, heading: 2 }));
    ok(f.engine.execute({ type: 'setColor', id, color: 'green' }));
    expect([f.node('A').heading, f.node('A').color]).toEqual([2, 'green']);
    expect(effect(f, { type: 'setHeading', id, heading: 2 })).toEqual({ changes: [] });
    expect(effect(f, { type: 'setColor', id, color: 'green' })).toEqual({ changes: [] });
    ok(f.engine.execute({ type: 'setHeading', id, heading: null }));
    ok(f.engine.execute({ type: 'setColor', id, color: null }));
    expect([f.node('A').heading, f.node('A').color]).toEqual([null, null]);
  });

  it('refuse values outside the list', () => {
    const f = fixture(['A']);
    const id = f.ids.A!;
    expect(effect(f, { type: 'setHeading', id, heading: 4 })).toEqual(new Rejection('unknown heading'));
    expect(effect(f, { type: 'setHeading', id, heading: 0 })).toEqual(new Rejection('unknown heading'));
    expect(effect(f, { type: 'setColor', id, color: 'pink' })).toEqual(new Rejection('unknown color'));
    for (const heading of [1, 3]) expect((effect(f, { type: 'setHeading', id, heading }) as Effect).changes[0]!.after!.heading).toBe(heading);
    for (const color of ['red', 'purple']) expect((effect(f, { type: 'setColor', id, color }) as Effect).changes[0]!.after!.color).toBe(color);
  });

  it('refuse a deleted node, as toggleComplete does', () => {
    const f = fixture(['A']);
    const id = f.ids.A!;
    f.engine.execute({ type: 'deleteSubtree', id });
    const reason = 'node is missing or deleted';
    expect(effect(f, { type: 'toggleComplete', id })).toEqual(new Rejection(reason));
    expect(effect(f, { type: 'setHeading', id, heading: 1 })).toEqual(new Rejection(reason));
    expect(effect(f, { type: 'setColor', id, color: 'red' })).toEqual(new Rejection(reason));
  });
});

describe('restoreNode', () => {
  it('brings back the node with what went with it, in its old place, but not what was deleted before', () => {
    const f = fixture(['A', ['B', ['B1', ['B2', ['B2a']]]], 'C']);
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.B2! }));
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.B! }));
    expect(outline(f)).toEqual(['A', 'C']);
    ok(f.engine.execute({ type: 'restoreNode', id: f.ids.B! }));
    expect(outline(f)).toEqual(['A', ['B', ['B1']], 'C']);
    ok(f.engine.execute({ type: 'restoreNode', id: f.ids.B2! }));
    expect(outline(f)).toEqual(['A', ['B', ['B1', ['B2', ['B2a']]]], 'C']);
  });

  it('puts it at the top of Home when its parent is gone, and undo deletes it again', () => {
    const f = fixture(['A', ['P', ['K']]]);
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.K! }));
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.P! }));
    ok(f.engine.execute({ type: 'restoreNode', id: f.ids.K! }));
    expect(outline(f)).toEqual(['K', 'A']);
    expect(f.node('K').parentId).toBeNull();
    f.engine.undo();
    expect(outline(f)).toEqual(['A']);
    expect(f.node('K').parentId).toBe(f.ids.P);
  });

  it('brings back only the chosen one of several nodes deleted together', () => {
    const f = fixture(['A', 'B', 'C']);
    ok(f.engine.batch([{ type: 'deleteSubtree', id: f.ids.A! }, { type: 'deleteSubtree', id: f.ids.B! }], 'deleteSelection'));
    expect(f.node('A').deletedAt).toBe(f.node('B').deletedAt);
    ok(f.engine.execute({ type: 'restoreNode', id: f.ids.B! }));
    expect(outline(f)).toEqual(['B', 'C']);
  });

  it('refuses a live or missing node', () => {
    const f = fixture(['A']);
    expect(effect(f, { type: 'restoreNode', id: f.ids.A! })).toEqual(new Rejection('node is missing or not deleted'));
    expect(effect(f, { type: 'restoreNode', id: 'nope' })).toEqual(new Rejection('node is missing or not deleted'));
  });
});

describe('deletedItems', () => {
  it('lists each deletion once, newest first, with how many went with it, leaving out blank rows', () => {
    const f = fixture([['A', [['B', ['B1', 'B2']]]], 'C', '', ['', ['x']]]);
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.A! }));
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.C! }));
    const blanks = f.engine.tree.children(null).filter((id) => f.engine.tree.get(id)!.content === '');
    // A blank row alone is left out; a blank row with something inside is listed.
    for (const id of blanks) ok(f.engine.execute({ type: 'deleteSubtree', id }));
    expect(deletedItems(f.engine.tree).map((d) => [d.node.content, d.inside])).toEqual([
      ['', 1],
      ['C', 0],
      ['A', 3],
    ]);
    expect(deletedItems(f.engine.tree, 2)).toHaveLength(2);
    ok(f.engine.execute({ type: 'restoreNode', id: f.ids.A! }));
    expect(deletedItems(f.engine.tree).map((d) => d.node.content)).toEqual(['', 'C']);
  });

  it('orders deletions made at the same moment by id, and lists a blank row that has a note', () => {
    const f = fixture(['A', 'B', '   ', ' ']);
    const blank = f.engine.tree.children(null).filter((id) => f.engine.tree.get(id)!.content.trim() === '');
    ok(f.engine.execute({ type: 'updateNote', id: blank[0]!, note: 'kept' }));
    ok(f.engine.execute({ type: 'updateNote', id: blank[1]!, note: '  ' }));
    const ids = [f.ids.A!, f.ids.B!, ...blank];
    ok(f.engine.batch(ids.map((id): Command => ({ type: 'deleteSubtree', id })), 'deleteSelection'));
    expect(deletedItems(f.engine.tree).map((d) => d.node.id)).toEqual([f.ids.A!, f.ids.B!, blank[0]!].sort());
  });

  const deleted = (id: string, parentId: string | null, at = 5): Node => ({ id, parentId, order: 'a', content: id, note: '', collapsed: false, createdAt: 1, updatedAt: 1, deletedAt: at });
  const treeOf = (list: Node[]): TreeReader => {
    const nodes = new Map(list.map((n) => [n.id, n]));
    return { get: (id) => nodes.get(id), children: () => [], all: () => nodes.values() };
  };

  it('follows a broken parent cycle no further than once round', () => {
    const tree = treeOf([deleted('x', 'y'), deleted('y', 'x'), deleted('w', 'x')]);
    expect(deletionRoot(tree, tree.get('x')!).id).toBe('y');
    expect(deletionRoot(tree, tree.get('y')!).id).toBe('x');
    // A cycle above the node, not through it, ends too.
    expect(deletionRoot(tree, tree.get('w')!).id).toBe('y');
  });

  it('breaks ties between deletions at the same moment by id, whatever order the tree holds them in', () => {
    const tree = treeOf([deleted('b', null), deleted('c', null), deleted('a', null), deleted('d', null, 9)]);
    expect(deletedItems(tree).map((d) => d.node.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('lists a child deleted earlier on its own, apart from its parent deleted later', () => {
    const f = fixture([['P', ['K', 'L']]]);
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.K! }));
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.P! }));
    expect(deletedItems(f.engine.tree).map((d) => [d.node.content, d.inside])).toEqual([
      ['P', 1],
      ['K', 0],
    ]);
  });
});
