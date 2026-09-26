import { describe, expect, it } from 'vitest';
import { newId } from '@/model';
import { fixture, ok, outline } from '@/test/helpers';
import { joinMarkdown } from './content-commands';

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
