import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createEngine } from '@/commands';
import { newId } from '@/model';
import { AletheiaDB } from './db';
import { DexieRepository } from './dexie-repository';
import { createTreeStore } from '@/store/tree-store';
import { makeClock, ok } from '@/test/helpers';

function freshRepo(): DexieRepository {
  return new DexieRepository(new AletheiaDB(`test-${newId()}`));
}

describe('DexieRepository', () => {
  it('opens the schema with every table', async () => {
    const repo = freshRepo();
    await repo.db.open();
    expect(repo.db.tables.map((t) => t.name).sort()).toEqual(
      ['dirtyNodes', 'embeddings', 'nodes', 'operations', 'relations', 'summaries', 'tags'].sort(),
    );
  });

  it('commits nodes, operations and dirty marks atomically and reloads them', async () => {
    const repo = freshRepo();
    const engine = createEngine({ store: createTreeStore(), repository: repo, now: makeClock() });
    const a = newId();
    const b = newId();
    ok(engine.execute({ type: 'createNode', id: a, parentId: null, content: 'A' }));
    ok(engine.execute({ type: 'createNode', id: b, parentId: a, content: 'B' }));
    ok(engine.execute({ type: 'updateContent', id: b, content: 'B2' }));
    engine.undo();
    await engine.flush();

    const nodes = await repo.loadAllNodes();
    expect(nodes.map((n) => n.content).sort()).toEqual(['A', 'B']);
    const ops = await repo.listOperations();
    expect(ops.map((o) => o.type)).toEqual(['createNode', 'createNode', 'updateContent', 'undo']);
    const dirty = (await repo.listDirty()).map((d) => d.nodeId).sort();
    expect(dirty).toEqual([a, b].sort());

    await repo.clearDirty([a]);
    expect((await repo.listDirty()).map((d) => d.nodeId)).toEqual([b]);

    const store2 = createTreeStore();
    const engine2 = createEngine({ store: store2, repository: repo, now: makeClock() });
    await engine2.load();
    expect(engine2.tree.children(a)).toEqual([b]);
  });

  it('removes nodes when a creation is undone', async () => {
    const repo = freshRepo();
    const engine = createEngine({ store: createTreeStore(), repository: repo, now: makeClock() });
    ok(engine.execute({ type: 'createNode', id: newId(), parentId: null }));
    engine.undo();
    await engine.flush();
    expect(await repo.loadAllNodes()).toEqual([]);
  });

  it('replaceAllNodes swaps the whole node set and clears dirty marks', async () => {
    const repo = freshRepo();
    const engine = createEngine({ store: createTreeStore(), repository: repo, now: makeClock() });
    ok(engine.execute({ type: 'createNode', id: newId(), parentId: null, content: 'old' }));
    await engine.flush();
    const fresh = { id: newId(), parentId: null, order: 'a0', content: 'new', note: '', collapsed: false, createdAt: 1, updatedAt: 1, deletedAt: null };
    await repo.replaceAllNodes([fresh]);
    expect(await repo.loadAllNodes()).toEqual([fresh]);
    expect(await repo.listDirty()).toEqual([]);
  });
});
