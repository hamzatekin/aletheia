import { describe, expect, it } from 'vitest';
import { newId } from '@/model';
import { fixture, ok, outline } from '@/test/helpers';
import { ChangeSet } from './changes';
import { joinMarkdown } from './content-commands';
import { computeEffect } from './dispatch';
import { orderFor, parentNodeIds } from './position';
import { moveDownCommand, moveUpCommand } from './structure-commands';
import { Rejection, type Command } from './types';

describe('createNode', () => {
  it('appends at the end by default and can insert first / after / before', () => {
    const f = fixture(['A', 'B']);
    ok(f.engine.execute({ type: 'createNode', id: (f.ids.C = newId()), parentId: null, content: 'C' }));
    ok(f.engine.execute({ type: 'createNode', id: (f.ids.Z = newId()), parentId: null, content: 'Z', at: 'first' }));
    ok(f.engine.execute({ type: 'createNode', id: (f.ids.AB = newId()), parentId: null, content: 'AB', at: { after: f.ids.A! } }));
    ok(f.engine.execute({ type: 'createNode', id: (f.ids.BC = newId()), parentId: null, content: 'BC', at: { before: f.ids.C! } }));
    expect(f.kids(null)).toEqual(['Z', 'A', 'AB', 'B', 'BC', 'C']);
  });

  it('rejects a deleted or missing parent and duplicate ids', () => {
    const f = fixture(['A']);
    expect(f.engine.execute({ type: 'createNode', id: newId(), parentId: 'nope' }).ok).toBe(false);
    expect(f.engine.execute({ type: 'createNode', id: f.ids.A!, parentId: null }).ok).toBe(false);
    f.engine.execute({ type: 'deleteSubtree', id: f.ids.A! });
    expect(f.engine.execute({ type: 'createNode', id: newId(), parentId: f.ids.A! }).ok).toBe(false);
  });

  it('marks the node and its parent as affected', () => {
    const f = fixture(['A']);
    const id = newId();
    const r = f.engine.execute({ type: 'createNode', id, parentId: f.ids.A! });
    ok(r);
    expect(r.op.affectedNodeIds).toEqual([id, f.ids.A]);
  });
});

describe('updateContent / updateNote', () => {
  it('updates content and note, no-op when unchanged', () => {
    const f = fixture(['A']);
    const r = f.engine.execute({ type: 'updateContent', id: f.ids.A!, content: '**bold**' });
    ok(r);
    expect(f.node('A').content).toBe('**bold**');
    expect(f.engine.execute({ type: 'updateContent', id: f.ids.A!, content: '**bold**' })).toMatchObject({ ok: true });
    expect(f.engine.canUndo()).toBe(true);
    ok(f.engine.execute({ type: 'updateNote', id: f.ids.A!, note: 'line 1\n\nline 2' }));
    expect(f.node('A').note).toBe('line 1\n\nline 2');
    f.engine.undo();
    expect(f.node('A').note).toBe('');
    f.engine.undo();
    expect(f.node('A').content).toBe('A');
  });

  it('rejects deleted nodes', () => {
    const f = fixture(['A']);
    f.engine.execute({ type: 'deleteSubtree', id: f.ids.A! });
    expect(f.engine.execute({ type: 'updateContent', id: f.ids.A!, content: 'x' }).ok).toBe(false);
  });
});

describe('splitNode', () => {
  it('splits into a next sibling when the node has no visible children', () => {
    const f = fixture(['hello world', 'B']);
    const id = f.ids['hello world']!;
    const newId_ = newId();
    const r = f.engine.execute({ type: 'splitNode', id, newId: newId_, left: 'hello', right: ' world' });
    ok(r);
    expect(f.kids(null)).toEqual(['hello', ' world', 'B']);
    expect(r.focus).toEqual({ id: newId_, offset: 0 });
    expect(f.engine.tree.get(newId_)!.parentId).toBeNull();
  });

  it('creates a first child when the node is expanded with children', () => {
    const f = fixture([['A', ['A1', 'A2']]]);
    const nid = newId();
    ok(f.engine.execute({ type: 'splitNode', id: f.ids.A!, newId: nid, left: 'A', right: '' }));
    expect(outline(f)).toEqual([['A', ['', 'A1', 'A2']]]);
  });

  it('splits into a sibling when the node is collapsed, children stay with the original', () => {
    const f = fixture([['A', ['A1']], 'B']);
    f.engine.execute({ type: 'toggleCollapse', id: f.ids.A! });
    ok(f.engine.execute({ type: 'splitNode', id: f.ids.A!, newId: newId(), left: 'A', right: '' }));
    expect(outline(f)).toEqual([['A', ['A1']], '', 'B']);
  });

  it('inserts an empty node above when the caret is at the start', () => {
    const f = fixture(['A', 'B']);
    const nid = newId();
    const r = f.engine.execute({ type: 'splitNode', id: f.ids.A!, newId: nid, left: '', right: 'A' });
    ok(r);
    expect(f.kids(null)).toEqual(['', 'A', 'B']);
    expect(r.focus).toEqual({ id: f.ids.A, offset: 0 });
    expect(f.node('A').content).toBe('A');
  });

  it('undo removes the new node and restores the content', () => {
    const f = fixture(['hello world']);
    const id = f.ids['hello world']!;
    const nid = newId();
    ok(f.engine.execute({ type: 'splitNode', id, newId: nid, left: 'hello', right: ' world' }));
    f.engine.undo();
    expect(f.kids(null)).toEqual(['hello world']);
    expect(f.engine.tree.get(nid)).toBeUndefined();
    f.engine.redo();
    expect(f.kids(null)).toEqual(['hello', ' world']);
  });
});

describe('joinMarkdown', () => {
  it('re-joins a mark split at the caret and leaves other joins alone', () => {
    expect(joinMarkdown('a **n**', '**ew** b')).toBe('a **new** b');
    expect(joinMarkdown('*x*', '*y*')).toBe('*xy*');
    expect(joinMarkdown('`co`', '`de`')).toBe('`code`');
    expect(joinMarkdown('**a**', 'b')).toBe('**a**b');
    expect(joinMarkdown('a', '')).toBe('a');
  });
});

describe('mergeNodes', () => {
  it('appends content, soft-deletes the source, and reports a caret at the join', () => {
    const f = fixture(['foo', 'bar']);
    const r = f.engine.execute({ type: 'mergeNodes', sourceId: f.ids.bar!, targetId: f.ids.foo! });
    ok(r);
    expect(f.kids(null)).toEqual(['foobar']);
    expect(f.node('bar').deletedAt).not.toBeNull();
    expect(r.focus).toEqual({ id: f.ids.foo, offset: 3 });
  });

  it('split then merge round-trips content with a mark at the caret', () => {
    const f = fixture(['a **new** b']);
    const id = f.ids['a **new** b']!;
    const nid = newId();
    ok(f.engine.execute({ type: 'splitNode', id, newId: nid, left: 'a **n**', right: '**ew** b' }));
    ok(f.engine.execute({ type: 'mergeNodes', sourceId: nid, targetId: id }));
    expect(f.engine.tree.get(id)!.content).toBe('a **new** b');
  });

  it("moves the source's children to the end of the target's children", () => {
    const f = fixture([['A', ['A1']], ['B', ['B1', 'B2']]]);
    ok(f.engine.execute({ type: 'mergeNodes', sourceId: f.ids.B!, targetId: f.ids.A! }));
    expect(outline(f)).toEqual([['AB', ['A1', 'B1', 'B2']]]);
  });

  it("keeps the source's children in place when merging into the parent", () => {
    const f = fixture([['P', [['C', ['x', 'y']], 'D']]]);
    ok(f.engine.execute({ type: 'mergeNodes', sourceId: f.ids.C!, targetId: f.ids.P! }));
    expect(outline(f)).toEqual([['PC', ['x', 'y', 'D']]]);
  });

  it('rejects merging into itself or into a descendant', () => {
    const f = fixture([['A', ['A1']]]);
    expect(f.engine.execute({ type: 'mergeNodes', sourceId: f.ids.A!, targetId: f.ids.A! }).ok).toBe(false);
    expect(f.engine.execute({ type: 'mergeNodes', sourceId: f.ids.A!, targetId: f.ids.A1! }).ok).toBe(false);
  });

  it('undo restores the source, its children and the target content', () => {
    const f = fixture([['A', ['A1']], ['B', ['B1']]]);
    ok(f.engine.execute({ type: 'mergeNodes', sourceId: f.ids.B!, targetId: f.ids.A! }));
    f.engine.undo();
    expect(outline(f)).toEqual([['A', ['A1']], ['B', ['B1']]]);
    f.engine.redo();
    expect(outline(f)).toEqual([['AB', ['A1', 'B1']]]);
  });
});

describe('moveNode', () => {
  it('reorders among siblings and reparents whole subtrees', () => {
    const f = fixture([['A', ['A1']], 'B', 'C']);
    ok(f.engine.execute({ type: 'moveNode', id: f.ids.C!, parentId: null, at: 'first' }));
    expect(f.kids(null)).toEqual(['C', 'A', 'B']);
    ok(f.engine.execute({ type: 'moveNode', id: f.ids.A!, parentId: f.ids.B!, at: 'last' }));
    expect(outline(f)).toEqual(['C', ['B', [['A', ['A1']]]]]);
  });

  it('rejects moving into itself or its own descendant', () => {
    const f = fixture([['A', [['A1', ['A1a']]]]]);
    expect(f.engine.execute({ type: 'moveNode', id: f.ids.A!, parentId: f.ids.A! })).toMatchObject({ ok: false });
    expect(f.engine.execute({ type: 'moveNode', id: f.ids.A!, parentId: f.ids.A1a! })).toMatchObject({ ok: false });
    expect(outline(f)).toEqual([['A', [['A1', ['A1a']]]]]);
    expect(f.engine.canUndo()).toBe(true); // only fixture creates
  });

  it('rejects a deleted target parent and a missing anchor', () => {
    const f = fixture(['A', 'B']);
    f.engine.execute({ type: 'deleteSubtree', id: f.ids.B! });
    expect(f.engine.execute({ type: 'moveNode', id: f.ids.A!, parentId: f.ids.B! }).ok).toBe(false);
    expect(f.engine.execute({ type: 'moveNode', id: f.ids.A!, parentId: null, at: { after: 'ghost' } }).ok).toBe(false);
  });

  it('affected ids include the subtree and both parents', () => {
    const f = fixture([['A', [['A1', ['A1a']]]], 'B']);
    const r = f.engine.execute({ type: 'moveNode', id: f.ids.A1!, parentId: f.ids.B! });
    ok(r);
    expect([...r.op.affectedNodeIds].sort()).toEqual([f.ids.A1, f.ids.A1a, f.ids.A, f.ids.B].sort());
  });

  it('a move within the same parent keeps the moved node out of its own anchor search', () => {
    const f = fixture(['A', 'B', 'C']);
    ok(f.engine.execute({ type: 'moveNode', id: f.ids.A!, parentId: null, at: { after: f.ids.B! } }));
    expect(f.kids(null)).toEqual(['B', 'A', 'C']);
    ok(f.engine.execute({ type: 'moveNode', id: f.ids.C!, parentId: null, at: { before: f.ids.B! } }));
    expect(f.kids(null)).toEqual(['C', 'B', 'A']);
  });
});

describe('indent / outdent', () => {
  it('indent rejects the first child', () => {
    const f = fixture([['A', ['A1', 'A2']]]);
    expect(f.engine.execute({ type: 'indent', id: f.ids.A1! })).toMatchObject({ ok: false });
    expect(f.engine.execute({ type: 'indent', id: f.ids.A! })).toMatchObject({ ok: false });
  });

  it('indent makes the node the last child of the previous sibling and expands it', () => {
    const f = fixture([['A', ['A1']], ['B', ['B1']]]);
    f.engine.execute({ type: 'toggleCollapse', id: f.ids.A! });
    expect(f.node('A').collapsed).toBe(true);
    ok(f.engine.execute({ type: 'indent', id: f.ids.B! }));
    expect(outline(f)).toEqual([['A', ['A1', ['B', ['B1']]]]]);
    expect(f.node('A').collapsed).toBe(false);
    f.engine.undo();
    expect(outline(f)).toEqual([['A', ['A1']], ['B', ['B1']]]);
    expect(f.node('A').collapsed).toBe(true);
  });

  it('outdent rejects top-level nodes', () => {
    const f = fixture(['A']);
    expect(f.engine.execute({ type: 'outdent', id: f.ids.A! })).toMatchObject({ ok: false });
  });

  it('outdent of the last child places it right after its parent', () => {
    const f = fixture([['A', ['A1', 'A2']], 'B']);
    ok(f.engine.execute({ type: 'outdent', id: f.ids.A2! }));
    expect(outline(f)).toEqual([['A', ['A1']], 'A2', 'B']);
  });

  it('outdent of a middle child leaves following siblings with the old parent', () => {
    const f = fixture([['A', ['A1', ['A2', ['A2a']], 'A3']], 'B']);
    ok(f.engine.execute({ type: 'outdent', id: f.ids.A2! }));
    expect(outline(f)).toEqual([['A', ['A1', 'A3']], ['A2', ['A2a']], 'B']);
    f.engine.undo();
    expect(outline(f)).toEqual([['A', ['A1', ['A2', ['A2a']], 'A3']], 'B']);
  });

  it('indent then outdent round-trips', () => {
    const f = fixture(['A', 'B', 'C']);
    ok(f.engine.execute({ type: 'indent', id: f.ids.B! }));
    expect(outline(f)).toEqual([['A', ['B']], 'C']);
    ok(f.engine.execute({ type: 'outdent', id: f.ids.B! }));
    expect(outline(f)).toEqual(['A', 'B', 'C']);
  });
});

describe('toggleCollapse', () => {
  it('toggles and accepts an explicit value', () => {
    const f = fixture(['A']);
    ok(f.engine.execute({ type: 'toggleCollapse', id: f.ids.A! }));
    expect(f.node('A').collapsed).toBe(true);
    ok(f.engine.execute({ type: 'toggleCollapse', id: f.ids.A!, collapsed: true }));
    expect(f.node('A').collapsed).toBe(true);
    ok(f.engine.execute({ type: 'toggleCollapse', id: f.ids.A! }));
    expect(f.node('A').collapsed).toBe(false);
  });
});

describe('deleteNode', () => {
  it('deletes only the node; its children take its place under its parent', () => {
    const f = fixture([['P', ['X', ['E', ['E1', ['E2', ['E2a']]]], 'Y']]]);
    ok(f.engine.execute({ type: 'deleteNode', id: f.ids.E! }));
    expect(outline(f)).toEqual([['P', ['X', 'E1', ['E2', ['E2a']], 'Y']]]);
    expect(f.node('E').deletedAt).not.toBeNull();
    expect(f.node('E1').deletedAt).toBeNull();
  });

  it('works at the top level and undo puts the children back', () => {
    const f = fixture(['A', ['E', ['E1', 'E2']], 'B']);
    ok(f.engine.execute({ type: 'deleteNode', id: f.ids.E! }));
    expect(outline(f)).toEqual(['A', 'E1', 'E2', 'B']);
    f.engine.undo();
    expect(outline(f)).toEqual(['A', ['E', ['E1', 'E2']], 'B']);
  });
});

describe('deleteSubtree / restore', () => {
  it('soft-deletes the whole subtree with one timestamp and hides it', () => {
    const f = fixture([['A', ['A1', ['A2', ['A2a']]]], 'B']);
    const r = f.engine.execute({ type: 'deleteSubtree', id: f.ids.A! });
    ok(r);
    expect(outline(f)).toEqual(['B']);
    const stamp = f.node('A').deletedAt;
    expect(stamp).not.toBeNull();
    for (const l of ['A1', 'A2', 'A2a']) expect(f.node(l).deletedAt).toBe(stamp);
    expect([...r.op.affectedNodeIds].sort()).toEqual([f.ids.A, f.ids.A1, f.ids.A2, f.ids.A2a].sort());
  });

  it('focus hint points at the previous sibling, else the parent', () => {
    const f = fixture([['A', ['A1', 'A2']]]);
    const r1 = f.engine.execute({ type: 'deleteSubtree', id: f.ids.A2! });
    ok(r1);
    expect(r1.focus).toEqual({ id: f.ids.A1, offset: 2 });
    const r2 = f.engine.execute({ type: 'deleteSubtree', id: f.ids.A1! });
    ok(r2);
    expect(r2.focus).toEqual({ id: f.ids.A, offset: 1 });
  });

  it('restore brings back the subtree but not descendants deleted earlier', () => {
    const f = fixture([['A', ['A1', ['A2', ['A2a']]]], 'B']);
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.A1! }));
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.A! }));
    expect(outline(f)).toEqual(['B']);
    ok(f.engine.execute({ type: 'restore', id: f.ids.A! }));
    expect(outline(f)).toEqual([['A', [['A2', ['A2a']]]], 'B']);
    expect(f.node('A1').deletedAt).not.toBeNull();
    ok(f.engine.execute({ type: 'restore', id: f.ids.A1! }));
    expect(outline(f)).toEqual([['A', ['A1', ['A2', ['A2a']]]], 'B']);
  });

  it('restore re-attaches at the top level when the parent is gone', () => {
    const f = fixture([['A', ['A1']], 'B']);
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.A1! }));
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.A! }));
    ok(f.engine.execute({ type: 'restore', id: f.ids.A1! }));
    expect(outline(f)).toEqual(['B', 'A1']);
  });

  it('restore rejects live or unknown nodes; delete rejects deleted nodes', () => {
    const f = fixture(['A']);
    expect(f.engine.execute({ type: 'restore', id: f.ids.A! }).ok).toBe(false);
    expect(f.engine.execute({ type: 'restore', id: 'ghost' }).ok).toBe(false);
    f.engine.execute({ type: 'deleteSubtree', id: f.ids.A! });
    expect(f.engine.execute({ type: 'deleteSubtree', id: f.ids.A! }).ok).toBe(false);
  });

  it('delete then undo restores the subtree in its original position', () => {
    const f = fixture(['X', ['A', ['A1', 'A2']], 'B']);
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.A! }));
    f.engine.undo();
    expect(outline(f)).toEqual(['X', ['A', ['A1', 'A2']], 'B']);
    f.engine.redo();
    expect(outline(f)).toEqual(['X', 'B']);
  });
});

describe('rejections', () => {
  it('every command refuses a missing or deleted node, with the reason', () => {
    const f = fixture(['A', 'B']);
    f.engine.execute({ type: 'deleteSubtree', id: f.ids.B! });
    const reason = (cmd: Command) => {
      const r = computeEffect({ tree: f.engine.tree, now: 1 }, cmd);
      return r instanceof Rejection ? r.reason : 'accepted';
    };
    for (const id of ['missing', f.ids.B!]) {
      expect(reason({ type: 'updateContent', id, content: 'x' })).toBe('node is missing or deleted');
      expect(reason({ type: 'updateNote', id, note: 'x' })).toBe('node is missing or deleted');
      expect(reason({ type: 'splitNode', id, newId: newId(), left: 'a', right: 'b' })).toBe('node is missing or deleted');
      expect(reason({ type: 'mergeNodes', sourceId: id, targetId: f.ids.A! })).toBe('node is missing or deleted');
      expect(reason({ type: 'mergeNodes', sourceId: f.ids.A!, targetId: id })).toBe('node is missing or deleted');
      expect(reason({ type: 'moveNode', id, parentId: null })).toBe('node is missing or deleted');
      expect(reason({ type: 'moveNode', id: f.ids.A!, parentId: id })).toBe('target parent is missing or deleted');
      expect(reason({ type: 'indent', id })).toBe('node is missing or deleted');
      expect(reason({ type: 'outdent', id })).toBe('node is missing or deleted');
      expect(reason({ type: 'toggleCollapse', id })).toBe('node is missing or deleted');
      expect(reason({ type: 'toggleStar', id })).toBe('node is missing or deleted');
      expect(reason({ type: 'deleteSubtree', id })).toBe('node is missing or deleted');
      expect(reason({ type: 'deleteNode', id })).toBe('node is missing or deleted');
      expect(reason({ type: 'createNode', id: newId(), parentId: id })).toBe('parent is missing or deleted');
    }
    expect(reason({ type: 'createNode', id: f.ids.A!, parentId: null })).toBe('node already exists');
    expect(reason({ type: 'createNode', id: newId(), parentId: null, at: { after: 'missing' } })).toBe('anchor sibling not found');
    expect(reason({ type: 'createNode', id: newId(), parentId: null, at: { before: 'missing' } })).toBe('anchor sibling not found');
    expect(reason({ type: 'splitNode', id: f.ids.A!, newId: f.ids.B!, left: 'a', right: 'b' })).toBe('newId already exists');
    expect(reason({ type: 'mergeNodes', sourceId: f.ids.A!, targetId: f.ids.A! })).toBe('cannot merge a node into itself');
    expect(reason({ type: 'moveNode', id: f.ids.A!, parentId: f.ids.A! })).toBe('cannot move a node into itself or its descendant');
    expect(reason({ type: 'moveNode', id: f.ids.A!, parentId: null, at: { after: 'missing' } })).toBe('anchor sibling not found');
    expect(reason({ type: 'indent', id: f.ids.A! })).toBe('cannot indent the first child');
    expect(reason({ type: 'outdent', id: f.ids.A! })).toBe('cannot outdent a top-level node');
    expect(reason({ type: 'restore', id: 'missing' })).toBe('node not found');
    expect(reason({ type: 'restore', id: f.ids.A! })).toBe('node is not deleted');
  });

  it('a merge into a descendant gives its own reason', () => {
    const f = fixture([['A', ['A1']]]);
    const r = computeEffect({ tree: f.engine.tree, now: 1 }, { type: 'mergeNodes', sourceId: f.ids.A!, targetId: f.ids.A1! });
    expect(r).toEqual(new Rejection('cannot merge a node into its own descendant'));
  });
});

describe('command effects', () => {
  const effect = (f: ReturnType<typeof fixture>, cmd: Command) => {
    const r = computeEffect({ tree: f.engine.tree, now: 777 }, cmd);
    if (r instanceof Rejection) throw new Error(r.reason);
    return r;
  };

  it('createNode makes an empty node at the end, focused at its start', () => {
    const f = fixture([['P', ['x']]]);
    const id = newId();
    const e = effect(f, { type: 'createNode', id, parentId: f.ids.P! });
    expect(e.affectedNodeIds).toEqual([id, f.ids.P]);
    expect(e.focus).toEqual({ id, offset: 0 });
    expect(e.changes).toEqual([{ id, before: null, after: { id, parentId: f.ids.P, order: e.changes[0]!.after!.order, content: '', note: '', collapsed: false, createdAt: 777, updatedAt: 777, deletedAt: null } }]);
    expect(e.changes[0]!.after!.order > f.node('x').order).toBe(true);
    expect(effect(f, { type: 'createNode', id: newId(), parentId: null }).affectedNodeIds).toHaveLength(1);
  });

  it('updates and toggles report only the node, and nothing when unchanged', () => {
    const f = fixture(['A']);
    const id = f.ids.A!;
    expect(effect(f, { type: 'updateContent', id, content: 'x' })).toEqual({ changes: [expect.objectContaining({ id })], affectedNodeIds: [id] });
    expect(effect(f, { type: 'updateContent', id, content: 'A' })).toEqual({ changes: [], affectedNodeIds: [] });
    expect(effect(f, { type: 'updateNote', id, note: 'n' })).toEqual({ changes: [expect.objectContaining({ id })], affectedNodeIds: [id] });
    expect(effect(f, { type: 'updateNote', id, note: '' })).toEqual({ changes: [], affectedNodeIds: [] });
    expect(effect(f, { type: 'toggleCollapse', id })).toEqual({ changes: [expect.objectContaining({ id })], affectedNodeIds: [id] });
    expect(effect(f, { type: 'toggleCollapse', id, collapsed: false })).toEqual({ changes: [], affectedNodeIds: [] });
    expect(effect(f, { type: 'toggleStar', id, starred: false })).toEqual({ changes: [], affectedNodeIds: [] });
    const star = effect(f, { type: 'toggleStar', id });
    expect(star).toEqual({ changes: [expect.objectContaining({ id })], affectedNodeIds: [id] });
    expect(star.changes[0]!.after!.starredAt).toBe(777);
  });

  it('toggleStar flips by default, and an explicit value is idempotent', () => {
    const f = fixture(['A']);
    const id = f.ids.A!;
    ok(f.engine.execute({ type: 'toggleStar', id }));
    expect(f.node('A').starredAt).toBeGreaterThan(0);
    expect(effect(f, { type: 'toggleStar', id, starred: true })).toEqual({ changes: [], affectedNodeIds: [] });
    ok(f.engine.execute({ type: 'toggleStar', id }));
    expect(f.node('A').starredAt).toBeNull();
    ok(f.engine.execute({ type: 'toggleStar', id, starred: true }));
    expect(f.node('A').starredAt).toBeGreaterThan(0);
    ok(f.engine.execute({ type: 'toggleStar', id, starred: false }));
    expect(f.node('A').starredAt).toBeNull();
  });

  it('indent leaves an open previous sibling alone and opens a collapsed one', () => {
    const f = fixture([['A', ['A1']], 'B', 'C']);
    expect(effect(f, { type: 'indent', id: f.ids.B! }).changes.map((c) => c.id)).toEqual([f.ids.B]);
    f.engine.execute({ type: 'toggleCollapse', id: f.ids.A!, collapsed: true });
    const e = effect(f, { type: 'indent', id: f.ids.B! });
    expect(e.changes.map((c) => [c.id, c.after!.collapsed])).toEqual([[f.ids.B, false], [f.ids.A, false]]);
    expect(e.focus).toEqual({ id: f.ids.B, offset: 0 });
  });

  it('moveUpCommand / moveDownCommand swap with the neighbour, null at the ends', () => {
    const f = fixture(['A', 'B', 'C']);
    const ctx = { tree: f.engine.tree, now: 1 };
    expect(moveUpCommand(ctx, f.ids.B!)).toEqual({ type: 'moveNode', id: f.ids.B, parentId: null, at: { before: f.ids.A } });
    expect(moveDownCommand(ctx, f.ids.B!)).toEqual({ type: 'moveNode', id: f.ids.B, parentId: null, at: { after: f.ids.C } });
    expect(moveUpCommand(ctx, f.ids.A!)).toBeNull();
    expect(moveDownCommand(ctx, f.ids.C!)).toBeNull();
    expect(moveUpCommand(ctx, 'missing')).toBeNull();
    expect(moveDownCommand(ctx, 'missing')).toBeNull();
    ok(f.engine.execute(moveDownCommand(ctx, f.ids.A!)!));
    expect(f.kids(null)).toEqual(['B', 'A', 'C']);
  });

  it('splitNode: an empty caret split with nothing on the right adds an empty sibling below', () => {
    const f = fixture(['', 'B']);
    const nid = newId();
    const e = effect(f, { type: 'splitNode', id: f.ids['']!, newId: nid, left: '', right: '' });
    expect(e.focus).toEqual({ id: nid, offset: 0 });
    expect(e.changes).toHaveLength(1);
    ok(f.engine.execute({ type: 'splitNode', id: f.ids['']!, newId: nid, left: '', right: '' }));
    expect(f.engine.tree.children(null)).toEqual([f.ids[''], nid, f.ids.B]);
  });

  it('splitNode inserting above keeps the content and the caret on the original', () => {
    const f = fixture(['A', 'text']);
    const nid = newId();
    const e = effect(f, { type: 'splitNode', id: f.ids.text!, newId: nid, left: '', right: 'text' });
    expect(e.focus).toEqual({ id: f.ids.text, offset: 0 });
    expect(e.affectedNodeIds).toEqual([f.ids.text, nid]);
    expect(e.changes).toEqual([{ id: nid, before: null, after: expect.objectContaining({ content: '', note: '', collapsed: false, parentId: null }) }]);
    ok(f.engine.execute({ type: 'splitNode', id: f.ids.text!, newId: nid, left: '', right: 'text' }));
    expect(f.engine.tree.children(null)).toEqual([f.ids.A, nid, f.ids.text]);
  });

  it('splitNode writes the left part only when it changed, and reports the parent', () => {
    const f = fixture([['P', ['ab']]]);
    const nid = newId();
    const same = effect(f, { type: 'splitNode', id: f.ids.ab!, newId: nid, left: 'ab', right: '' });
    expect(same.changes.map((c) => c.id)).toEqual([nid]);
    expect(same.affectedNodeIds).toEqual([f.ids.ab, nid, f.ids.P]);
    const cut = effect(f, { type: 'splitNode', id: f.ids.ab!, newId: nid, left: 'a', right: 'b' });
    expect(cut.changes.map((c) => [c.id, c.after!.content])).toEqual([[f.ids.ab, 'a'], [nid, 'b']]);
    expect(cut.changes[1]!.after).toMatchObject({ note: '', collapsed: false, parentId: f.ids.P });
  });

  it('mergeNodes into the parent puts the children in the source slot, before its next sibling', () => {
    const f = fixture([['P', ['first', ['S', ['S1', 'S2']], 'next']]]);
    const e = effect(f, { type: 'mergeNodes', sourceId: f.ids.S!, targetId: f.ids.P! });
    expect(e.focus).toEqual({ id: f.ids.P, offset: 1 });
    expect(new Set(e.affectedNodeIds)).toEqual(new Set([f.ids.S, f.ids.P, f.ids.S1, f.ids.S2]));
    ok(f.engine.execute({ type: 'mergeNodes', sourceId: f.ids.S!, targetId: f.ids.P! }));
    expect(outline(f)).toEqual([['PS', ['first', 'S1', 'S2', 'next']]]);
  });

  it('mergeNodes into the parent as its first child puts the children first', () => {
    const f = fixture([['P', [['S', ['S1']], 'next']]]);
    ok(f.engine.execute({ type: 'mergeNodes', sourceId: f.ids.S!, targetId: f.ids.P! }));
    expect(outline(f)).toEqual([['PS', ['S1', 'next']]]);
  });

  it('mergeNodes into another node appends the children after its own, with their subtrees affected', () => {
    const f = fixture([['T', ['t1']], ['S', [['S1', ['S1a']]]], 'Z']);
    const e = effect(f, { type: 'mergeNodes', sourceId: f.ids.S!, targetId: f.ids.T! });
    expect(new Set(e.affectedNodeIds)).toEqual(new Set([f.ids.S, f.ids.T, f.ids.S1, f.ids.S1a]));
    ok(f.engine.execute({ type: 'mergeNodes', sourceId: f.ids.S!, targetId: f.ids.T! }));
    expect(outline(f)).toEqual([['TS', ['t1', ['S1', ['S1a']]]], 'Z']);
    const g = fixture(['T', ['S', ['S1', 'S2']]]);
    ok(g.engine.execute({ type: 'mergeNodes', sourceId: g.ids.S!, targetId: g.ids.T! }));
    expect(outline(g)).toEqual([['TS', ['S1', 'S2']]]);
  });

  it('mergeNodes without children only changes the target and the source', () => {
    const f = fixture([['P', ['A', 'B']]]);
    const e = effect(f, { type: 'mergeNodes', sourceId: f.ids.B!, targetId: f.ids.A! });
    expect(e.changes.map((c) => c.id)).toEqual([f.ids.A, f.ids.B]);
    expect(e.changes[1]!.after!.deletedAt).toBe(777);
    expect(new Set(e.affectedNodeIds)).toEqual(new Set([f.ids.A, f.ids.B, f.ids.P]));
  });

  it('deleteNode in the middle keeps the children between its neighbours', () => {
    const f = fixture(['A', ['D', ['D1', ['D2', ['D2a']]]], 'Z']);
    const e = effect(f, { type: 'deleteNode', id: f.ids.D! });
    expect(new Set(e.affectedNodeIds)).toEqual(new Set([f.ids.D, f.ids.D1, f.ids.D2, f.ids.D2a]));
    expect(e.focus).toEqual({ id: f.ids.A, offset: 1 });
    ok(f.engine.execute({ type: 'deleteNode', id: f.ids.D! }));
    expect(outline(f)).toEqual(['A', 'D1', ['D2', ['D2a']], 'Z']);
  });

  it('deleteNode as the first child puts the children first, and focuses the parent', () => {
    const f = fixture([['Parent', [['D', ['D1']], 'Z']]]);
    const e = effect(f, { type: 'deleteNode', id: f.ids.D! });
    expect(e.focus).toEqual({ id: f.ids.Parent, offset: 6 });
    expect(e.affectedNodeIds).toEqual([f.ids.D, f.ids.Parent, f.ids.D1]);
    ok(f.engine.execute({ type: 'deleteNode', id: f.ids.D! }));
    expect(outline(f)).toEqual([['Parent', ['D1', 'Z']]]);
  });

  it('deleting the only top-level node gives no focus', () => {
    const f = fixture(['A']);
    expect(effect(f, { type: 'deleteNode', id: f.ids.A! })).not.toHaveProperty('focus');
    expect(effect(f, { type: 'deleteSubtree', id: f.ids.A! })).not.toHaveProperty('focus');
  });

  it('restore reports every restored node and the parent, focused on the node', () => {
    const f = fixture([['P', [['X', ['X1', 'X2']]]]]);
    f.engine.execute({ type: 'deleteSubtree', id: f.ids.X! });
    const e = effect(f, { type: 'restore', id: f.ids.X! });
    expect(new Set(e.affectedNodeIds)).toEqual(new Set([f.ids.X, f.ids.X1, f.ids.X2, f.ids.P]));
    expect(e.changes).toHaveLength(3);
    expect(e.focus).toEqual({ id: f.ids.X, offset: 0 });
  });

  it('restore keeps the old order when free and moves to the end when another node took it', () => {
    const f = fixture(['A', 'B', 'C']);
    const order = f.node('B').order;
    f.engine.execute({ type: 'deleteSubtree', id: f.ids.B! });
    expect(effect(f, { type: 'restore', id: f.ids.B! }).changes[0]!.after!.order).toBe(order);
    const taker = newId();
    f.engine.applyExternal([{ ...f.node('A'), id: taker, content: 'taker', order }], 'test');
    ok(f.engine.execute({ type: 'restore', id: f.ids.B! }));
    expect(f.kids(null)).toEqual(['A', 'taker', 'C', 'B']);
  });

  it('restore leaves alone other deleted nodes with the same time that are not its descendants', () => {
    const f = fixture(['A', 'B']);
    // Both deleted in one batch: one timestamp, separate subtrees.
    ok(f.engine.batch([{ type: 'deleteSubtree', id: f.ids.A! }, { type: 'deleteSubtree', id: f.ids.B! }]));
    expect(f.node('A').deletedAt).toBe(f.node('B').deletedAt);
    ok(f.engine.execute({ type: 'restore', id: f.ids.A! }));
    expect(f.kids(null)).toEqual(['A']);
  });
});

describe('ChangeSet', () => {
  it('refuses to update an unknown node or create an existing one', () => {
    const f = fixture(['A']);
    const cs = new ChangeSet(f.engine.tree, 5);
    expect(() => cs.update('nope', { content: 'x' })).toThrow('ChangeSet.update: unknown node nope');
    expect(() => cs.create({ id: f.ids.A!, parentId: null, order: 'a0', content: '', note: '', collapsed: false })).toThrow(`ChangeSet.create: node ${f.ids.A} already exists`);
  });

  it('coalesces two updates of one node into one change from the original', () => {
    const f = fixture(['A']);
    const cs = new ChangeSet(f.engine.tree, 5);
    cs.update(f.ids.A!, { content: 'x' });
    cs.update(f.ids.A!, { note: 'n' });
    expect(cs.list()).toEqual([{ id: f.ids.A, before: f.node('A'), after: { ...f.node('A'), content: 'x', note: 'n', updatedAt: 5 } }]);
  });
});

describe('orderFor', () => {
  it('ignores the node being placed and refuses an unknown anchor', () => {
    const f = fixture(['A', 'B']);
    const tree = f.engine.tree;
    expect(orderFor(tree, null, { before: 'missing' })).toBeNull();
    expect(orderFor(tree, null, { after: 'missing' })).toBeNull();
    // Moving A to the front: the slot is before B, not before A itself.
    const first = orderFor(tree, null, 'first', f.ids.A!)!;
    expect(first < f.node('B').order).toBe(true);
    expect(first > orderFor(tree, null, 'first')!).toBe(true);
  });

  it('parentNodeIds drops nulls and duplicates, keeping order', () => {
    expect(parentNodeIds(null, 'a', undefined, 'b', 'a')).toEqual(['a', 'b']);
  });
});
