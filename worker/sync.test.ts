import { beforeEach, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from '@/commands';
import { newId, type Node } from '@/model';
import { MemoryRepository } from '@/persistence';
import { createTreeStore } from '@/store/tree-store';
import { httpSyncApi, SyncService, type SyncApi } from '@/sync/service';
import { NO_TIMES, type PullResponse, type WireNode } from '@/sync/wire';
import { handleSync, resetSchemaCache, type SqlDatabase } from './sync';
import { sqliteD1 } from './testing/sqlite-d1';

const KEY_A = 'a'.repeat(43);
const KEY_B = 'b'.repeat(43);

let db: SqlDatabase;
let maxSpaces = '1';
beforeEach(() => {
  resetSchemaCache();
  db = sqliteD1();
  maxSpaces = '1';
});

/** fetch() that goes straight into the Worker's handler. */
const serverFetch: typeof fetch = async (input, init) => {
  const request = new Request(new URL(String(input), 'https://aletheia.test'), init);
  return handleSync(request, { DB: db, SYNC_MAX_SPACES: maxSpaces });
};
const api = (): SyncApi => httpSyncApi('', serverFetch);

function call(method: string, path: string, key: string | null, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  return serverFetch(`/api/sync/${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}

function wire(id: string, fields: Partial<WireNode> = {}): WireNode {
  return { id, parentId: null, order: 'a0', content: '', note: '', collapsed: false, createdAt: 1, deletedAt: null, t: { ...NO_TIMES }, ...fields };
}

describe('sync server', () => {
  it('needs a long key, and the first key owns a one-space deployment', async () => {
    expect((await call('POST', 'space', null)).status).toBe(401);
    expect((await call('POST', 'space', 'short')).status).toBe(401);
    expect((await call('GET', 'pull', KEY_A)).status).toBe(404);
    expect(await (await call('POST', 'space', KEY_A)).json()).toEqual({ created: true });
    expect(await (await call('POST', 'space', KEY_A)).json()).toEqual({ created: false });
    expect((await call('POST', 'space', KEY_B)).status).toBe(403);
    maxSpaces = '2';
    expect((await call('POST', 'space', KEY_B)).status).toBe(200);
  });

  it('keeps spaces apart', async () => {
    maxSpaces = '2';
    await call('POST', 'space', KEY_A);
    await call('POST', 'space', KEY_B);
    await call('POST', 'push', KEY_A, { nodes: [wire('n1', { content: 'secret', t: { ...NO_TIMES, content: 5 } })] });
    const b = (await (await call('GET', 'pull?since=0', KEY_B)).json()) as PullResponse;
    expect(b.nodes).toEqual([]);
  });

  it('merges each field group by its own time', async () => {
    await call('POST', 'space', KEY_A);
    const base = { content: 1, note: 1, pos: 1, collapsed: 1, deleted: 1 };
    await call('POST', 'push', KEY_A, { nodes: [wire('n', { content: 'v1', note: 'n1', order: 'a0', t: base })] });
    // Device 1 edits the text at t=10; device 2 moved it at t=5 and edited the text earlier (t=3).
    await call('POST', 'push', KEY_A, { nodes: [wire('n', { content: 'text from 1', order: 'a0', t: { ...NO_TIMES, content: 10 } })] });
    await call('POST', 'push', KEY_A, {
      nodes: [wire('n', { content: 'older text from 2', parentId: 'p', order: 'b0', t: { ...NO_TIMES, content: 3, pos: 5 } })],
    });
    const { nodes, cursor, more } = (await (await call('GET', 'pull?since=0', KEY_A)).json()) as PullResponse;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ content: 'text from 1', note: 'n1', parentId: 'p', order: 'b0', t: { content: 10, note: 1, pos: 5 } });
    expect(cursor).toBe(3);
    expect(more).toBe(false);
  });

  it('pages the change feed', async () => {
    await call('POST', 'space', KEY_A);
    const nodes = Array.from({ length: 7 }, (_, i) => wire(`n${i}`, { t: { ...NO_TIMES, content: 1 } }));
    await call('POST', 'push', KEY_A, { nodes });
    const p1 = (await (await call('GET', 'pull?since=0&limit=5', KEY_A)).json()) as PullResponse;
    expect(p1.nodes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    expect(p1.more).toBe(true);
    const p2 = (await (await call('GET', `pull?since=${p1.cursor}&limit=5`, KEY_A)).json()) as PullResponse;
    expect(p2.nodes.map((n) => n.id)).toEqual(['n5', 'n6']);
    expect(p2.more).toBe(false);
  });

  it('rejects malformed pushes', async () => {
    await call('POST', 'space', KEY_A);
    expect((await call('POST', 'push', KEY_A, { nodes: [{ id: 'x' }] })).status).toBe(400);
    expect((await call('POST', 'push', KEY_A, { nope: 1 })).status).toBe(400);
  });
});

// --- two devices ---

interface Device {
  engine: Engine;
  repo: MemoryRepository;
  sync: SyncService;
  create(content: string, parentId?: string | null): string;
  shape(): unknown[];
  find(content: string): Node;
}

function device(start: number): Device {
  let t = start;
  const now = () => (t += 1000);
  const repo = new MemoryRepository();
  const engine = createEngine({ store: createTreeStore(), repository: repo, now });
  const sync = new SyncService(engine, repo, api(), { now, debounceMs: 60_000 });
  const d: Device = {
    engine,
    repo,
    sync,
    create(content, parentId = null) {
      const id = newId();
      const r = engine.execute({ type: 'createNode', id, parentId, content, at: 'last' });
      if (!r.ok) throw new Error(r.reason);
      return id;
    },
    shape() {
      const walk = (parent: string | null): unknown[] =>
        engine.tree.children(parent).map((id) => {
          const kids = walk(id);
          const label = engine.tree.get(id)!.content;
          return kids.length > 0 ? [label, kids] : label;
        });
      return walk(null);
    },
    find(content) {
      const n = [...engine.tree.all()].find((x) => x.content === content && x.deletedAt === null);
      if (!n) throw new Error(`no live node "${content}"`);
      return n;
    },
  };
  return d;
}

async function syncBoth(a: Device, b: Device): Promise<void> {
  await a.sync.sync();
  await b.sync.sync();
  await a.sync.sync();
}

describe('sync between two devices', () => {
  it('a joining device (replace) gets the same outline, then edits flow both ways', async () => {
    const a = device(1_000_000);
    const p = a.create('Projects');
    a.create('Write', p);
    a.create('Read', p);
    a.create('Someday');
    const key = await a.sync.enable();

    const b = device(2_000_000);
    b.create('sample from first run');
    await b.sync.join(key, 'replace');
    expect(b.shape()).toEqual([['Projects', ['Write', 'Read']], 'Someday']);

    b.engine.execute({ type: 'updateContent', id: b.find('Read').id, content: 'Read more' });
    await syncBoth(a, b);
    expect(a.shape()).toEqual([['Projects', ['Write', 'Read more']], 'Someday']);
    expect(a.sync.state.getState().status).toBe('idle');
    expect(a.repo.outbox.size).toBe(0);
    expect(b.repo.outbox.size).toBe(0);
  });

  it('merge-join keeps both devices notes', async () => {
    const a = device(1_000_000);
    a.create('from A');
    const key = await a.sync.enable();
    const b = device(2_000_000);
    b.create('from B');
    await b.sync.join(key, 'merge');
    await a.sync.sync();
    expect(new Set(a.shape())).toEqual(new Set(['from A', 'from B']));
    expect(new Set(b.shape())).toEqual(new Set(['from A', 'from B']));
  });

  it('text edited on one device and the node moved on the other: both survive', async () => {
    const a = device(1_000_000);
    const x = a.create('X');
    const box = a.create('Box');
    const key = await a.sync.enable();
    const b = device(2_000_000);
    await b.sync.join(key, 'replace');

    a.engine.execute({ type: 'updateContent', id: x, content: 'X edited on A' });
    b.engine.execute({ type: 'moveNode', id: x, parentId: box, at: 'last' });
    await syncBoth(a, b);
    expect(a.shape()).toEqual([['Box', ['X edited on A']]]);
    expect(b.shape()).toEqual(a.shape());
  });

  it('the same text edited on both: the later edit wins everywhere', async () => {
    const a = device(1_000_000);
    const x = a.create('X');
    const key = await a.sync.enable();
    const b = device(2_000_000); // B's clock is ahead, so B's edit is later
    await b.sync.join(key, 'replace');
    b.engine.execute({ type: 'updateContent', id: x, content: 'from B' });
    a.engine.execute({ type: 'updateContent', id: x, content: 'from A' });
    await syncBoth(a, b);
    expect(a.shape()).toEqual(['from B']);
    expect(b.shape()).toEqual(['from B']);
  });

  it('a parent deleted on one device while a child is added on the other comes back with the child', async () => {
    const a = device(1_000_000);
    const p = a.create('Parent');
    a.create('old child', p);
    const key = await a.sync.enable();
    const b = device(2_000_000);
    await b.sync.join(key, 'replace');

    a.engine.execute({ type: 'deleteSubtree', id: p });
    b.create('new child', p);
    await syncBoth(a, b);
    await b.sync.sync();
    expect(a.shape()).toEqual([['Parent', ['new child']]]);
    expect(b.shape()).toEqual(a.shape());
  });

  it('crossed moves that would make a cycle are repaired the same way on both devices', async () => {
    const a = device(1_000_000);
    const x = a.create('X');
    const y = a.create('Y');
    const key = await a.sync.enable();
    const b = device(2_000_000);
    await b.sync.join(key, 'replace');

    a.engine.execute({ type: 'moveNode', id: x, parentId: y, at: 'last' });
    b.engine.execute({ type: 'moveNode', id: y, parentId: x, at: 'last' });
    await syncBoth(a, b);
    await b.sync.sync();
    const shape = a.shape();
    expect(b.shape()).toEqual(shape);
    // One move wins; nothing is lost or left unreachable.
    expect([[['X', ['Y']]], [['Y', ['X']]]]).toContainEqual(shape);
  });

  it('undoing a creation removes the node on the other device too', async () => {
    const a = device(1_000_000);
    a.create('keep');
    const key = await a.sync.enable();
    const b = device(2_000_000);
    await b.sync.join(key, 'replace');
    a.create('oops');
    await a.sync.sync();
    await b.sync.sync();
    expect(b.shape()).toEqual(['keep', 'oops']);
    a.engine.undo();
    await syncBoth(a, b);
    expect(b.shape()).toEqual(['keep']);
  });

  it('downloads large outlines in pages', async () => {
    const a = device(1_000_000);
    for (let i = 0; i < 1234; i++) a.create(`n${i}`);
    const key = await a.sync.enable();
    const b = device(2_000_000);
    await b.sync.join(key, 'replace');
    expect(b.shape()).toHaveLength(1234);
    expect(b.shape()).toEqual(a.shape());
  });

  it('an edit made while a download is in flight is not overwritten', async () => {
    const a = device(1_000_000);
    const x = a.create('X');
    const key = await a.sync.enable();
    const b = device(2_000_000);
    await b.sync.join(key, 'replace');
    b.engine.execute({ type: 'updateContent', id: x, content: 'B typed this' });
    // B has not uploaded yet; A's older edit arrives first.
    a.engine.execute({ type: 'updateContent', id: x, content: 'A older' });
    await a.sync.sync();
    await b.engine.flush();
    const pending = await b.repo.listOutbox(10);
    expect(pending.map((e) => e.nodeId)).toEqual([x]);
    await syncBoth(a, b);
    expect(b.shape()).toEqual(['B typed this']);
    expect(a.shape()).toEqual(['B typed this']);
  });

  it('turning sync off stops recording changes', async () => {
    const a = device(1_000_000);
    a.create('X');
    await a.sync.enable();
    await a.sync.disable();
    a.create('Y');
    await a.engine.flush();
    expect(a.repo.outbox.size).toBe(0);
    expect(a.sync.state.getState().status).toBe('off');
  });

  it('reports a bad link without touching local notes', async () => {
    const a = device(1_000_000);
    a.create('X');
    await a.sync.enable();
    const b = device(2_000_000);
    b.create('mine');
    await expect(b.sync.join(KEY_B, 'replace')).rejects.toThrow(/not valid/);
    expect(b.shape()).toEqual(['mine']);
  });
});
