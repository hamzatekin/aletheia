import { describe, expect, it } from 'vitest';
import { newId } from '@/model';
import { MemoryRepository } from '@/persistence';
import { createEngine } from './engine';
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

describe('engine: operation log, dirty nodes, persistence', () => {
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

  it('records dirty nodes from affectedNodeIds', async () => {
    const f = fixture([['A', ['A1']], 'B']);
    await f.engine.flush();
    await f.repo.clearDirty((await f.repo.listDirty()).map((d) => d.nodeId));
    ok(f.engine.execute({ type: 'moveNode', id: f.ids.A!, parentId: f.ids.B! }));
    await f.engine.flush();
    const dirty = (await f.repo.listDirty()).map((d) => d.nodeId).sort();
    expect(dirty).toEqual([f.ids.A, f.ids.A1, f.ids.B].sort());
  });

  it('undo and redo append operations referencing the reverted op and mark dirty', async () => {
    const f = fixture(['A']);
    const r = f.engine.execute({ type: 'updateContent', id: f.ids.A!, content: 'X' });
    ok(r);
    f.engine.undo();
    f.engine.redo();
    await f.engine.flush();
    const ops = await f.repo.listOperations();
    const tail = ops.slice(-2);
    expect(tail.map((o) => o.type)).toEqual(['undo', 'redo']);
    expect(tail.every((o) => o.targetOpId === r.op.id)).toBe(true);
    expect(tail[0]!.changes[0]!.after?.content).toBe('A');
    expect(tail[1]!.changes[0]!.after?.content).toBe('X');
    expect((await f.repo.listDirty()).some((d) => d.nodeId === f.ids.A)).toBe(true);
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
