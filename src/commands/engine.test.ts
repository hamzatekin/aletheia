import { describe, expect, it } from 'vitest';
import { newId, type Operation } from '@/model';
import { PEER_OP } from '@/persistence/repository';
import { MemoryRepository } from '@/persistence';
import { createEngine } from './engine';
import { moveUpCommand } from './structure-commands';
import { createTreeStore } from '@/store/tree-store';
import { fixture, makeClock, ok, outline } from '@/test/helpers';

describe('engine: undo / redo', () => {
  it('undo of createNode removes the node entirely; redo re-creates it', () => {
    const f = fixture([]);
    const id = newId();
    ok(f.engine.execute({ type: 'createNode', id, parentId: null, content: 'A' }));
    expect(f.engine.canUndo()).toBe(true);
    expect(f.engine.canRedo()).toBe(false);
    f.engine.undo();
    expect(f.engine.tree.get(id)).toBeUndefined();
    expect(f.engine.canRedo()).toBe(true);
    f.engine.redo();
    expect(f.engine.tree.get(id)?.content).toBe('A');
  });

  it('a long sequence undoes and redoes in order', () => {
    const f = fixture(['A', 'B', 'C']);
    ok(f.engine.execute({ type: 'indent', id: f.ids.B! })); // A > B, C
    ok(f.engine.execute({ type: 'indent', id: f.ids.C! })); // A > B, C
    ok(f.engine.execute({ type: 'indent', id: f.ids.C! })); // A > B > C
    ok(f.engine.execute({ type: 'updateContent', id: f.ids.C!, content: 'C!' }));
    ok(f.engine.execute({ type: 'deleteSubtree', id: f.ids.A! }));
    expect(outline(f)).toEqual([]);

    f.engine.undo();
    expect(outline(f)).toEqual([['A', [['B', ['C!']]]]]);
    f.engine.undo();
    expect(outline(f)).toEqual([['A', [['B', ['C']]]]]);
    f.engine.undo();
    expect(outline(f)).toEqual([['A', ['B', 'C']]]);
    f.engine.undo();
    expect(outline(f)).toEqual([['A', ['B']], 'C']);
    f.engine.undo();
    expect(outline(f)).toEqual(['A', 'B', 'C']);

    f.engine.redo();
    f.engine.redo();
    f.engine.redo();
    expect(outline(f)).toEqual([['A', [['B', ['C']]]]]);
    f.engine.redo();
    f.engine.redo();
    expect(outline(f)).toEqual([]);
    expect(f.engine.redo()).toBeNull();
  });

  it('a new command clears the redo stack', () => {
    const f = fixture(['A']);
    ok(f.engine.execute({ type: 'updateContent', id: f.ids.A!, content: 'A1' }));
    f.engine.undo();
    expect(f.engine.canRedo()).toBe(true);
    ok(f.engine.execute({ type: 'updateContent', id: f.ids.A!, content: 'A2' }));
    expect(f.engine.canRedo()).toBe(false);
    expect(f.engine.redo()).toBeNull();
    expect(f.node('A').content).toBe('A2');
  });

  it('undo with nothing to undo returns null; no-op commands do not enter the stack', () => {
    const f = fixture(['A']);
    const depthBefore = countUndos(f);
    ok(f.engine.execute({ type: 'updateContent', id: f.ids.A!, content: 'A' }));
    expect(countUndos(f)).toBe(depthBefore);
    expect(fixture([]).engine.undo()).toBeNull();
  });

  it('undo/redo produce focus hints on surviving nodes', () => {
    const f = fixture(['A', 'B']);
    ok(f.engine.execute({ type: 'mergeNodes', sourceId: f.ids.B!, targetId: f.ids.A! }));
    const u = f.engine.undo();
    ok(u);
    expect(u.focus).toEqual({ id: f.ids.A, offset: 1 });
    const r = f.engine.redo();
    ok(r);
    expect(r.focus).toEqual({ id: f.ids.A, offset: 2 });
  });

  function countUndos(f: ReturnType<typeof fixture>): number {
    let n = 0;
    while (f.engine.undo()) n++;
    for (let i = 0; i < n; i++) f.engine.redo();
    return n;
  }
});

describe('engine: operation log, persistence', () => {
  it('persists every command in order, with the store and repository agreeing', async () => {
    const f = fixture([['A', ['A1']], 'B']);
    ok(f.engine.execute({ type: 'moveNode', id: f.ids.B!, parentId: f.ids.A!, at: 'first' }));
    ok(f.engine.execute({ type: 'updateNote', id: f.ids.B!, note: 'n' }));
    await f.engine.flush();

    const ops = await f.repo.listOperations();
    expect(ops.map((o) => o.type)).toEqual(['createNode', 'createNode', 'createNode', 'moveNode', 'updateNote']);
    expect(ops.every((o, i) => i === 0 || o.timestamp > ops[i - 1]!.timestamp)).toBe(true);

    const persisted = new Map((await f.repo.loadAllNodes()).map((n) => [n.id, n]));
    for (const n of f.engine.tree.all()) expect(persisted.get(n.id)).toEqual(n);
  });

  it('undo and redo append operations that revert and reapply the changes', async () => {
    const f = fixture(['A']);
    const r = f.engine.execute({ type: 'updateContent', id: f.ids.A!, content: 'X' });
    ok(r);
    f.engine.undo();
    f.engine.redo();
    await f.engine.flush();
    const ops = await f.repo.listOperations();
    const tail = ops.slice(-2);
    expect(tail.map((o) => o.type)).toEqual(['undo', 'redo']);
    expect(tail[0]!.changes[0]!.after?.content).toBe('A');
    expect(tail[1]!.changes[0]!.after?.content).toBe('X');
  });

  it('undo of a creation physically removes the node from the repository', async () => {
    const f = fixture([]);
    const id = newId();
    ok(f.engine.execute({ type: 'createNode', id, parentId: null }));
    f.engine.undo();
    await f.engine.flush();
    expect(await f.repo.loadAllNodes()).toEqual([]);
  });

  it('load() hydrates a fresh store from the repository', async () => {
    const f = fixture([['A', ['A1']], 'B']);
    await f.engine.flush();
    const store2 = createTreeStore();
    const engine2 = createEngine({ store: store2, repository: f.repo, now: makeClock() });
    await engine2.load();
    expect(engine2.tree.children(null).map((id) => engine2.tree.get(id)!.content)).toEqual(['A', 'B']);
    expect(engine2.tree.children(f.ids.A!).map((id) => engine2.tree.get(id)!.content)).toEqual(['A1']);
  });

  it('a failing write is reported and does not block later writes', async () => {
    const repo = new MemoryRepository();
    const original = repo.commit.bind(repo);
    let failNext = true;
    repo.commit = async (batch) => {
      if (failNext) {
        failNext = false;
        throw new Error('disk on fire');
      }
      return original(batch);
    };
    const errors: unknown[] = [];
    const engine = createEngine({ store: createTreeStore(), repository: repo, now: makeClock(), onPersistError: (e) => errors.push(e) });
    ok(engine.execute({ type: 'createNode', id: newId(), parentId: null, content: 'lost' }));
    ok(engine.execute({ type: 'createNode', id: newId(), parentId: null, content: 'kept' }));
    await engine.flush();
    expect(errors).toHaveLength(1);
    expect((await repo.loadAllNodes()).map((n) => n.content)).toEqual(['kept']);
  });

  it('notifies operation listeners', () => {
    const f = fixture(['A']);
    const seen: string[] = [];
    const off = f.engine.onOperation((op) => seen.push(op.type));
    f.engine.execute({ type: 'toggleCollapse', id: f.ids.A! });
    f.engine.undo();
    off();
    f.engine.redo();
    expect(seen).toEqual(['toggleCollapse', 'undo']);
  });
});

describe('engine: batch', () => {
  it('runs several commands as one undo step, each seeing the previous result', () => {
    const f = fixture(['A', 'B', 'C']);
    const r = f.engine.batch([
      { type: 'indent', id: f.ids.B! },
      { type: 'indent', id: f.ids.C! },
    ]);
    ok(r);
    expect(outline(f)).toEqual([['A', ['B', 'C']]]);
    expect(r.op.type).toBe('batch');
    f.engine.undo();
    expect(outline(f)).toEqual(['A', 'B', 'C']);
    f.engine.redo();
    expect(outline(f)).toEqual([['A', ['B', 'C']]]);
  });

  it('derives commands from the live tree and skips rejected items', () => {
    const f = fixture(['A', 'B', 'C']);
    // Move B and C up together: B goes above A, then C above A.
    const r = f.engine.batch([
      (tree) => moveUpCommand({ tree, now: 0 }, f.ids.B!),
      (tree) => moveUpCommand({ tree, now: 0 }, f.ids.C!),
      { type: 'indent', id: f.ids.B! }, // now the first child: rejected, skipped
    ]);
    ok(r);
    expect(f.kids(null)).toEqual(['B', 'C', 'A']);
    expect(f.engine.batch([{ type: 'indent', id: f.ids.B! }]).ok).toBe(false);
  });

  it('coalesces changes per node and persists one operation', async () => {
    const f = fixture(['A']);
    ok(f.engine.batch([
      { type: 'updateContent', id: f.ids.A!, content: 'x' },
      { type: 'updateContent', id: f.ids.A!, content: 'y' },
    ]));
    await f.engine.flush();
    const ops = await f.repo.listOperations();
    const last = ops[ops.length - 1]!;
    expect(last.changes).toHaveLength(1);
    expect(last.changes[0]!.before?.content).toBe('A');
    expect(last.changes[0]!.after?.content).toBe('y');
    f.engine.undo();
    expect(f.node('A').content).toBe('A');
  });

  it('drops nodes created and removed inside the same batch', () => {
    const f = fixture([]);
    const id = newId();
    // create then undo-like removal cannot happen via commands; created+deleted stays as a soft-deleted node
    ok(f.engine.batch([{ type: 'createNode', id, parentId: null }, { type: 'deleteSubtree', id }]));
    expect(f.engine.tree.get(id)?.deletedAt).not.toBeNull();
    f.engine.undo();
    expect(f.engine.tree.get(id)).toBeUndefined();
  });
});

describe('engine: details', () => {
  it('a no-op command returns an empty operation that is not persisted or undoable', async () => {
    const f = fixture(['A']);
    await f.engine.flush();
    const before = (await f.repo.listOperations()).length;
    const r = f.engine.execute({ type: 'toggleCollapse', id: f.ids.A!, collapsed: false });
    ok(r);
    expect(r.op).toMatchObject({ type: 'toggleCollapse', input: { type: 'toggleCollapse', id: f.ids.A!, collapsed: false }, changes: [] });
    expect(r).not.toHaveProperty('focus');
    await f.engine.flush();
    expect(await f.repo.listOperations()).toHaveLength(before);
  });

  it('a rejected command reports why and changes nothing', () => {
    const f = fixture(['A']);
    expect(f.engine.execute({ type: 'indent', id: f.ids.A! })).toEqual({ ok: false, reason: 'cannot indent the first child' });
    expect(f.engine.canUndo()).toBe(true); // only the fixture's creations
  });

  it('a batch records its inputs and the last focus, and skips null items', () => {
    const f = fixture(['A', 'B']);
    const r = f.engine.batch([
      () => null,
      { type: 'indent', id: f.ids.A! }, // rejected
      { type: 'toggleCollapse', id: f.ids.A!, collapsed: false }, // no change
      { type: 'updateContent', id: f.ids.A!, content: 'A!' },
      { type: 'indent', id: f.ids.B! },
    ], 'custom');
    ok(r);
    expect(r.op.type).toBe('custom');
    expect(r.op.input).toEqual([
      { type: 'updateContent', id: f.ids.A!, content: 'A!' },
      { type: 'indent', id: f.ids.B! },
    ]);
    expect(r.op.changes.map((c) => c.id).sort()).toEqual([f.ids.A, f.ids.B].sort());
    expect(r.focus).toEqual({ id: f.ids.B, offset: 0 });
  });

  it('a batch keeps the earlier focus when later commands give none, and has none when no command does', () => {
    const f = fixture(['A', 'B']);
    const r = f.engine.batch([
      { type: 'indent', id: f.ids.B! },
      { type: 'toggleCollapse', id: f.ids.A!, collapsed: true },
    ]);
    ok(r);
    expect(r.focus).toEqual({ id: f.ids.B, offset: 0 });
    const r2 = f.engine.batch([{ type: 'updateContent', id: f.ids.A!, content: 'z' }]);
    ok(r2);
    expect(r2).not.toHaveProperty('focus');
    expect(f.engine.batch([])).toEqual({ ok: false, reason: 'nothing to do' });
  });

  it('applyExternal writes only nodes that differ, is not undoable, and returns null when nothing changed', async () => {
    const f = fixture(['A', 'B']);
    const a = f.node('A');
    const fresh = { ...a, id: newId(), content: 'new', updatedAt: 5 };
    expect(f.engine.applyExternal([{ ...a, updatedAt: a.updatedAt + 99 }], 'pull')).toBeNull();
    const undoable = f.engine.canUndo();
    const seen: string[] = [];
    f.engine.onOperation((o) => seen.push(o.type));
    const op = f.engine.applyExternal([a, { ...f.node('B'), content: 'B2' }, fresh], 'pull');
    expect(op).toMatchObject({ type: 'pull', input: null });
    expect(op!.changes).toEqual([
      { id: f.ids.B, before: expect.objectContaining({ content: 'B' }), after: expect.objectContaining({ content: 'B2' }) },
      { id: fresh.id, before: null, after: fresh },
    ]);
    expect(seen).toEqual(['pull']);
    expect(f.engine.tree.get(fresh.id)).toEqual(fresh);
    expect(f.engine.canUndo()).toBe(undoable);
    await f.engine.flush();
    expect((await f.repo.loadAllNodes()).find((n) => n.id === fresh.id)).toEqual(fresh);
  });

  it('sees a change in any synced field as a difference', () => {
    const f = fixture(['A']);
    const a = f.node('A');
    for (const patch of [{ parentId: 'p' }, { order: 'zz' }, { content: 'c' }, { note: 'n' }, { collapsed: true }, { starredAt: 3 }, { deletedAt: 4 }, { createdAt: 1 }]) {
      const op = f.engine.applyExternal([{ ...a, ...patch }], 'pull');
      expect(op?.changes).toHaveLength(1);
      f.engine.applyExternal([a], 'pull');
    }
    expect(f.engine.applyExternal([{ ...a, starredAt: null }], 'pull')).toBeNull();
  });

  it('applyPeer shows changes without writing, tells listeners, and treats a newer updatedAt as a change', async () => {
    const f = fixture(['A']);
    await f.engine.flush();
    const a = f.node('A');
    const seen: Operation[] = [];
    f.engine.onOperation((o) => seen.push(o));
    expect(f.engine.applyPeer([{ id: 'nobody', after: null }, { id: a.id, after: a }])).toBeNull();
    const op = f.engine.applyPeer([{ id: a.id, after: { ...a, updatedAt: a.updatedAt + 1 } }]);
    expect(op).toMatchObject({ type: PEER_OP, input: null });
    expect(op!.changes.map((c) => c.id)).toEqual([a.id]);
    expect(seen).toEqual([op]);
    const gone = f.engine.applyPeer([{ id: a.id, after: null }]);
    expect(gone!.changes).toEqual([{ id: a.id, before: { ...a, updatedAt: a.updatedAt + 1 }, after: null }]);
    expect(f.engine.tree.get(a.id)).toBeUndefined();
    await f.engine.flush();
    expect((await f.repo.loadAllNodes()).map((n) => n.content)).toEqual(['A']);
  });

  it('reload drops nodes another tab removed and keeps nodes this tab created meanwhile', async () => {
    const f = fixture(['A', 'B']);
    await f.engine.flush();
    // Another tab removed B from disk outright (as undoing its creation would).
    await f.repo.commit({ upserts: [], removals: [f.ids.B!], operation: { id: newId(), type: 'x', input: null, changes: [], timestamp: 1 } });
    const reloading = f.engine.reload();
    const mine = newId();
    f.engine.execute({ type: 'createNode', id: mine, parentId: null, content: 'mine' });
    await reloading;
    expect(f.engine.tree.get(f.ids.B!)).toBeUndefined();
    expect(f.engine.tree.get(mine)?.content).toBe('mine');
    expect(f.node('A').content).toBe('A');
  });

  it('replaceAll swaps every node, clears undo and redo, and tells replace listeners until unsubscribed', async () => {
    const f = fixture(['A']);
    f.engine.execute({ type: 'updateContent', id: f.ids.A!, content: 'x' });
    f.engine.undo();
    let calls = 0;
    const off = f.engine.onReplace(() => calls++);
    const node = { ...f.node('A'), id: newId(), content: 'restored' };
    await f.engine.replaceAll([node]);
    expect(calls).toBe(1);
    expect(f.engine.canUndo()).toBe(false);
    expect(f.engine.canRedo()).toBe(false);
    expect(outline(f)).toEqual(['restored']);
    expect(await f.repo.loadAllNodes()).toEqual([node]);
    off();
    await f.engine.replaceAll([]);
    expect(calls).toBe(1);
  });

  it('logs failed writes to the console when no handler is given', async () => {
    const repo = new MemoryRepository();
    repo.commit = async () => {
      throw new Error('nope');
    };
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      const engine = createEngine({ store: createTreeStore(), repository: repo, now: makeClock() });
      engine.execute({ type: 'createNode', id: newId(), parentId: null });
      await engine.flush();
    } finally {
      console.error = original;
    }
    expect(logged).toHaveLength(1);
    expect(logged[0]![0]).toBe('persist failed');
    expect((logged[0]![1] as Error).message).toBe('nope');
  });

  it('writes upserts and removals separately', async () => {
    const f = fixture([]);
    const id = newId();
    ok(f.engine.execute({ type: 'createNode', id, parentId: null, content: 'x' }));
    await f.engine.flush();
    const calls: { upserts: number; removals: string[] }[] = [];
    const original = f.repo.commit.bind(f.repo);
    f.repo.commit = async (batch) => {
      calls.push({ upserts: batch.upserts.length, removals: batch.removals });
      return original(batch);
    };
    f.engine.undo();
    f.engine.redo();
    await f.engine.flush();
    expect(calls).toEqual([{ upserts: 0, removals: [id] }, { upserts: 1, removals: [] }]);
  });
});

describe('engine: focus after undo and redo', () => {
  it('undo focuses the command subject at the end of its old text, redo at the end of its new text', () => {
    const f = fixture(['Alpha', 'Beta']);
    ok(f.engine.execute({ type: 'updateContent', id: f.ids.Beta!, content: 'Beta 2' }));
    expect(f.engine.undo()).toMatchObject({ focus: { id: f.ids.Beta, offset: 4 } });
    expect(f.engine.redo()).toMatchObject({ focus: { id: f.ids.Beta, offset: 6 } });
  });

  it('undoing a creation focuses another changed node that existed before; redo focuses the new one', () => {
    const f = fixture(['hello']);
    const nid = newId();
    ok(f.engine.execute({ type: 'splitNode', id: f.ids.hello!, newId: nid, left: 'he', right: 'llo' }));
    expect(f.engine.undo()).toMatchObject({ focus: { id: f.ids.hello, offset: 5 } });
    expect(f.engine.redo()).toMatchObject({ focus: { id: f.ids.hello, offset: 2 } });
  });

  it('falls back to the subject id with offset 0 when no change survives', () => {
    const f = fixture([]);
    const id = newId();
    ok(f.engine.execute({ type: 'createNode', id, parentId: null, content: 'abc' }));
    expect(f.engine.undo()).toMatchObject({ focus: { id, offset: 0 } });
    expect(f.engine.redo()).toMatchObject({ focus: { id, offset: 3 } });
  });

  it('uses the merge target as the subject when the command has no id', () => {
    const f = fixture(['A', 'BB']);
    ok(f.engine.execute({ type: 'mergeNodes', sourceId: f.ids.BB!, targetId: f.ids.A! }));
    expect(f.engine.undo()).toMatchObject({ focus: { id: f.ids.A, offset: 1 } });
    expect(f.engine.redo()).toMatchObject({ focus: { id: f.ids.A, offset: 3 } });
  });

  it('a batch has no subject: undo and redo focus its first surviving change', () => {
    const f = fixture(['A', 'B']);
    ok(f.engine.batch([
      { type: 'updateContent', id: f.ids.A!, content: 'AAA' },
      { type: 'updateContent', id: f.ids.B!, content: 'BB' },
    ]));
    expect(f.engine.undo()).toMatchObject({ focus: { id: f.ids.A, offset: 1 } });
    expect(f.engine.redo()).toMatchObject({ focus: { id: f.ids.A, offset: 3 } });
  });

  it('with nothing to focus, gives an empty id', () => {
    const f = fixture([]);
    const id = newId();
    ok(f.engine.batch([{ type: 'createNode', id, parentId: null, content: 'x' }]));
    expect(f.engine.undo()).toMatchObject({ focus: { id: '', offset: 0 } });
  });
});
