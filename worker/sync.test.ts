import { beforeEach, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from '@/commands';
import { newId, type Node } from '@/model';
import { MemoryRepository } from '@/persistence';
import { createTreeStore } from '@/store/tree-store';
import { createClock } from '@/sync/clock';
import { httpSyncApi, SyncServerError, SyncService, type SyncApi, type SyncServiceOptions } from '@/sync/service';
import { NO_TIMES, type PullResponse, type WireNode } from '@/sync/wire';
import { handleSync, MAX_FUTURE_MS, resetSchemaCache, type SqlDatabase } from './sync';
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
    const base = { content: 1, note: 1, pos: 1, collapsed: 1, starred: 1, deleted: 1 };
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
    expect((await call('POST', 'push', KEY_A, { nope: 1 })).status).toBe(400);
  });

  it('skips invalid nodes but keeps the valid ones in the same push', async () => {
    await call('POST', 'space', KEY_A);
    const res = await call('POST', 'push', KEY_A, { nodes: [{ id: 'bad' }, wire('good', { content: 'ok', t: { ...NO_TIMES, content: 1 } })] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rejected: ['bad'] });
    const pulled = (await (await call('GET', 'pull?since=0', KEY_A)).json()) as PullResponse;
    expect(pulled.nodes.map((n) => n.content)).toEqual(['ok']);
  });

  it('pulls change times from a clock that runs ahead back to the server time', async () => {
    await call('POST', 'space', KEY_A);
    const future = Date.now() + 3_600_000;
    await call('POST', 'push', KEY_A, { nodes: [wire('n', { content: 'fast clock', t: { ...NO_TIMES, content: future } })] });
    const pulled = (await (await call('GET', 'pull?since=0', KEY_A)).json()) as PullResponse;
    expect(pulled.nodes[0]!.t.content).toBeLessThanOrEqual(Date.now() + MAX_FUTURE_MS);
    // So a later edit from a correct clock still wins.
    await call('POST', 'push', KEY_A, { nodes: [wire('n', { content: 'later', t: { ...NO_TIMES, content: Date.now() + MAX_FUTURE_MS + 1000 } })] });
    const again = (await (await call('GET', 'pull?since=0', KEY_A)).json()) as PullResponse;
    expect(again.nodes[0]!.content).toBe('later');
  });

  it('pulls back times stored from a fast clock before times were capped', async () => {
    await call('POST', 'space', KEY_A);
    await call('POST', 'push', KEY_A, { nodes: [wire('n', { t: { ...NO_TIMES, content: 1 } })] });
    await db.prepare('UPDATE nodes SET content_t = ?1').bind(Date.now() + 10 * 3_600_000).run();
    resetSchemaCache(); // a new Worker instance
    const pulled = (await (await call('GET', 'pull?since=0', KEY_A)).json()) as PullResponse;
    expect(pulled.nodes[0]!.t.content).toBeLessThanOrEqual(Date.now() + MAX_FUTURE_MS);
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

/** A device (or a tab, when given another device's repository) whose wall clock starts at `start`. */
function device(start: number, repo = new MemoryRepository(), opts: SyncServiceOptions & { api?: SyncApi } = {}): Device {
  let t = start;
  const clock = createClock(() => (t += 1000));
  const engine = createEngine({ store: createTreeStore(), repository: repo, now: clock.now });
  const sync = new SyncService(engine, repo, opts.api ?? api(), { clock, debounceMs: 60_000, ...opts });
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

/** A second tab of `d`'s browser: same storage, its own copy of the tree in memory. */
async function openTab(d: Device, start: number, opts: SyncServiceOptions = {}): Promise<Device> {
  const t = device(start, d.repo, opts);
  await t.engine.load();
  await t.sync.start();
  await t.sync.sync();
  return t;
}

describe('robustness', () => {
  it('a tab with an old copy of a node uploads the saved version, not its own', async () => {
    const a = device(1_000_000);
    const x = a.create('X');
    const key = await a.sync.enable();
    const tab = await openTab(a, 1_500_000);
    // The first tab edits; the other tab still shows "X" and runs the next sync.
    a.engine.execute({ type: 'updateContent', id: x, content: 'edited in the first tab' });
    await a.engine.flush();
    await tab.sync.sync();
    const phone = device(2_000_000);
    await phone.sync.join(key, 'replace');
    expect(phone.shape()).toEqual(['edited in the first tab']);
  });

  it('reload shows what another tab saved, and keeps edits made while reading', async () => {
    const a = device(1_000_000);
    const x = a.create('X');
    const y = a.create('Y');
    await a.engine.flush();
    const tab = device(1_500_000, a.repo);
    await tab.engine.load();
    a.engine.execute({ type: 'updateContent', id: x, content: 'X from the first tab' });
    a.engine.execute({ type: 'deleteSubtree', id: y });
    a.create('Z');
    await a.engine.flush();
    await tab.engine.reload();
    expect(tab.shape()).toEqual(a.shape());
    // Peer changes are shown, not saved again or queued for upload.
    expect(tab.engine.canUndo()).toBe(false);
  });

  it('applyPeer removes nodes and skips identical ones', async () => {
    const a = device(1_000_000);
    const x = a.create('X');
    const node = a.engine.tree.get(x)!;
    expect(a.engine.applyPeer([{ id: x, after: node }])).toBeNull();
    a.engine.applyPeer([{ id: x, after: null }]);
    expect(a.shape()).toEqual([]);
  });

  it('an edit made after seeing a change wins, even from a device whose clock is behind', async () => {
    const a = device(2_000_000); // A's clock is ahead
    const x = a.create('X');
    const key = await a.sync.enable();
    a.engine.execute({ type: 'updateContent', id: x, content: 'from A' });
    await a.sync.sync();
    const b = device(1_000_000); // B's clock is far behind
    await b.sync.join(key, 'replace');
    b.engine.execute({ type: 'updateContent', id: x, content: 'B edited after seeing A' });
    await syncBoth(a, b);
    expect(a.shape()).toEqual(['B edited after seeing A']);
    expect(b.shape()).toEqual(['B edited after seeing A']);
  });

  it('downloads still run when an upload is refused, and the error is shown', async () => {
    const a = device(1_000_000);
    const key = await a.sync.enable();
    const failing: SyncApi = {
      ...api(),
      push: async () => {
        throw new SyncServerError('too big', 413);
      },
    };
    const b = device(2_000_000, new MemoryRepository(), { api: failing });
    await b.sync.join(key, 'replace');
    b.create('stuck on B');
    a.create('from A');
    await a.sync.sync();
    await b.sync.sync();
    expect(b.shape()).toEqual(['stuck on B', 'from A']);
    expect(b.sync.state.getState()).toMatchObject({ status: 'error', error: 'too big' });
    expect(b.repo.outbox.size).toBe(1);
  });

  it('text saved just before a pulled change lands is kept', async () => {
    const a = device(1_000_000);
    const x = a.create('X');
    const key = await a.sync.enable();
    // B's editor holds unsaved typing; beforeApply saves it (as the app's editor does).
    let typing: string | null = null;
    let bEngine: Engine | null = null;
    const b = device(2_000_000, new MemoryRepository(), {
      beforeApply: (ids) => {
        if (typing !== null && ids.includes(x)) bEngine!.execute({ type: 'updateContent', id: x, content: typing });
        typing = null;
      },
    });
    bEngine = b.engine;
    await b.sync.join(key, 'replace');
    a.engine.execute({ type: 'updateContent', id: x, content: 'A older' });
    await a.sync.sync();
    typing = 'B was typing this';
    await b.sync.sync();
    expect(b.shape()).toEqual(['B was typing this']);
    await syncBoth(a, b);
    expect(a.shape()).toEqual(['B was typing this']);
  });

  it('turning sync off keeps the key, so it can be turned back on', async () => {
    const a = device(1_000_000);
    a.create('X');
    const key = await a.sync.enable();
    await a.sync.disable();
    a.create('added while off');
    expect(a.sync.state.getState()).toMatchObject({ status: 'off', lastKey: key });
    await a.sync.resume();
    expect(a.sync.state.getState()).toMatchObject({ status: 'idle', key });
    const b = device(2_000_000);
    await b.sync.join(key, 'replace');
    expect(b.shape()).toEqual(['X', 'added while off']);
  });

  it('the kept key survives a restart', async () => {
    const a = device(1_000_000);
    const key = await a.sync.enable();
    await a.sync.disable();
    const again = device(1_500_000, a.repo);
    await again.sync.start();
    expect(again.sync.state.getState()).toMatchObject({ status: 'off', lastKey: key });
  });

  it('a tab follows another tab turning sync on and off', async () => {
    const a = device(1_000_000);
    const tab = await openTab(a, 1_500_000);
    const key = await a.sync.enable();
    await tab.sync.reloadKey();
    await tab.sync.sync();
    expect(tab.sync.state.getState()).toMatchObject({ status: 'idle', key });
    await a.sync.disable();
    await tab.sync.reloadKey();
    expect(tab.sync.state.getState()).toMatchObject({ status: 'off', key: null, lastKey: key });
  });
});

describe('stars', () => {
  it('sync between devices, and the newer star or unstar wins', async () => {
    const a = device(1_000_000);
    const x = a.create('X');
    const key = await a.sync.enable();
    const b = device(2_000_000);
    await b.sync.join(key, 'replace');
    a.engine.execute({ type: 'toggleStar', id: x, starred: true });
    await syncBoth(a, b);
    expect(b.find('X').starredAt).toBeGreaterThan(0);
    // B unstars later than A's star: that wins on both.
    b.engine.execute({ type: 'toggleStar', id: x, starred: false });
    await syncBoth(a, b);
    expect(a.find('X').starredAt ?? null).toBeNull();
    expect(b.find('X').starredAt ?? null).toBeNull();
  });

  it('accepts pushes from clients that predate stars without touching the star', async () => {
    await call('POST', 'space', KEY_A);
    await call('POST', 'push', KEY_A, { nodes: [wire('n', { content: 'v1', starredAt: 7, t: { ...NO_TIMES, content: 1, starred: 7 } })] });
    const { starredAt: _s, ...old } = wire('n', { content: 'v2', t: { ...NO_TIMES, content: 2 } });
    const { starred: _t, ...oldTimes } = old.t;
    expect((await call('POST', 'push', KEY_A, { nodes: [{ ...old, t: oldTimes }] })).status).toBe(200);
    const pulled = (await (await call('GET', 'pull?since=0', KEY_A)).json()) as PullResponse;
    expect(pulled.nodes[0]).toMatchObject({ content: 'v2', starredAt: 7, t: { starred: 7, content: 2 } });
  });

  it('adds the star columns to a database created before them', async () => {
    await db.batch([
      db.prepare(`CREATE TABLE spaces (id TEXT PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`),
      db.prepare(`CREATE TABLE nodes (
        space TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, created_at INTEGER NOT NULL,
        content TEXT NOT NULL, content_t INTEGER NOT NULL, note TEXT NOT NULL, note_t INTEGER NOT NULL,
        parent_id TEXT, ord TEXT NOT NULL, pos_t INTEGER NOT NULL,
        collapsed INTEGER NOT NULL, collapsed_t INTEGER NOT NULL,
        deleted_at INTEGER, deleted_t INTEGER NOT NULL, PRIMARY KEY (space, id))`),
    ]);
    await call('POST', 'space', KEY_A);
    await call('POST', 'push', KEY_A, { nodes: [wire('n', { starredAt: 5, t: { ...NO_TIMES, content: 1, starred: 5 } })] });
    const pulled = (await (await call('GET', 'pull?since=0', KEY_A)).json()) as PullResponse;
    expect(pulled.nodes[0]).toMatchObject({ starredAt: 5 });
  });
});
