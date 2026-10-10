import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine, type Engine } from '@/commands';
import { newId } from '@/model';
import { MemoryRepository } from '@/persistence';
import { PEER_OP, REMOTE_OP } from '@/persistence/repository';
import { createTreeStore } from '@/store/tree-store';
import { createClock } from './clock';
import { httpSyncApi, keyFromHash, SyncServerError, SyncService, syncLink, type SyncApi } from './service';
import { NO_TIMES, type PullResponse, type PushResponse, type WireNode } from './wire';

// The sync client on its own, against a scripted server. worker/sync.test.ts
// runs it against the real Worker with two devices.

const KEY = 'k'.repeat(43);

interface FakeApi extends SyncApi {
  pushes: WireNode[][];
  pulls: number[];
  spaces: string[];
  pushResult: () => Promise<PushResponse>;
  pullResult: (since: number) => Promise<PullResponse>;
}

function fakeApi(): FakeApi {
  const api: FakeApi = {
    pushes: [],
    pulls: [],
    spaces: [],
    pushResult: async () => ({ seq: 1, rejected: [] }),
    pullResult: async (since) => ({ nodes: [], cursor: since, more: false }),
    async createSpace(key) {
      api.spaces.push(key);
    },
    async checkSpace() {
      return true;
    },
    async push(_key, nodes) {
      api.pushes.push(nodes);
      return api.pushResult();
    },
    async pull(_key, since) {
      api.pulls.push(since);
      return api.pullResult(since);
    },
  };
  return api;
}

interface Setup {
  engine: Engine;
  repo: MemoryRepository;
  api: FakeApi;
  sync: SyncService;
  create(content: string): string;
}

function setup(opts: { debounceMs?: number; afterReplace?: () => void } = {}): Setup {
  let t = 1_000_000;
  const clock = createClock(() => (t += 1000));
  const repo = new MemoryRepository();
  const engine = createEngine({ store: createTreeStore(), repository: repo, now: clock.now });
  const api = fakeApi();
  const sync = new SyncService(engine, repo, api, { clock, ...opts });
  return {
    engine,
    repo,
    api,
    sync,
    create(content) {
      const id = newId();
      engine.execute({ type: 'createNode', id, parentId: null, content });
      return id;
    },
  };
}

describe('sync links', () => {
  it('puts the key in the fragment and reads it back', () => {
    expect(syncLink('https://a.dev', KEY)).toBe(`https://a.dev/#sync=${KEY}`);
    expect(keyFromHash(`#sync=${KEY}`)).toBe(KEY);
    expect(keyFromHash(`#x=1&sync=${KEY}`)).toBe(KEY);
    expect(keyFromHash(`#sync=${KEY}&x=1`)).toBe(KEY);
    expect(keyFromHash('#sync=' + 'a'.repeat(32))).toBe('a'.repeat(32));
  });

  it('ignores short keys, other names and keys not at the start of a field', () => {
    expect(keyFromHash('#sync=' + 'a'.repeat(31))).toBeNull();
    expect(keyFromHash(`#nosync=${KEY}`)).toBeNull();
    expect(keyFromHash(`x#sync=${KEY}`)).toBeNull();
    expect(keyFromHash('#sync=' + '!'.repeat(40))).toBeNull();
    expect(keyFromHash('')).toBeNull();
  });
});

describe('httpSyncApi', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let reply: Response;
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return reply;
  }) as unknown as typeof fetch;
  const api = httpSyncApi('https://a.dev', fetchFn);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  beforeEach(() => {
    calls.length = 0;
    reply = json({});
  });

  it('sends the key as a bearer token, and JSON only with a body', async () => {
    await api.createSpace(KEY);
    expect(calls[0]).toEqual({ url: 'https://a.dev/api/sync/space', init: { method: 'POST', headers: { Authorization: `Bearer ${KEY}` } } });
    reply = json({ seq: 3, rejected: [] });
    expect(await api.push(KEY, [])).toEqual({ seq: 3, rejected: [] });
    expect(calls[1]).toEqual({
      url: 'https://a.dev/api/sync/push',
      init: { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: '{"nodes":[]}' },
    });
    reply = json({ nodes: [], cursor: 9, more: false });
    expect(await api.pull(KEY, 4, 50)).toEqual({ nodes: [], cursor: 9, more: false });
    expect(calls[2]).toEqual({ url: 'https://a.dev/api/sync/pull?since=4&limit=50', init: { method: 'GET', headers: { Authorization: `Bearer ${KEY}` } } });
  });

  it('checks a space: true when it exists, false on 404, an error otherwise', async () => {
    expect(await api.checkSpace(KEY)).toBe(true);
    expect(calls[0]!.url).toBe('https://a.dev/api/sync/space');
    expect(calls[0]!.init.method).toBe('GET');
    reply = json({ error: 'nope' }, 404);
    expect(await api.checkSpace(KEY)).toBe(false);
    reply = json({ error: 'down' }, 503);
    await expect(api.checkSpace(KEY)).rejects.toEqual(new SyncServerError('down', 503));
  });

  it('turns failed responses into server errors with the server message, or a generic one', async () => {
    reply = json({ error: 'This server already has its sync space.' }, 403);
    const error = await api.createSpace(KEY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncServerError);
    expect(error).toMatchObject({ message: 'This server already has its sync space.', status: 403 });
    reply = new Response('<html>', { status: 502 });
    await expect(api.push(KEY, [])).rejects.toMatchObject({ message: 'Sync server error (502)', status: 502 });
    reply = json({}, 500);
    await expect(api.pull(KEY, 0, 1)).rejects.toMatchObject({ message: 'Sync server error (500)', status: 500 });
  });

  it('uses the same origin and the global fetch by default', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url);
      return json({});
    });
    try {
      await httpSyncApi().createSpace(KEY);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toEqual(['/api/sync/space']);
  });
});

describe('SyncService: turning sync on and off', () => {
  it('enable makes a long random base64url key, creates its space and uploads every note', async () => {
    const s = setup();
    s.create('A');
    const key = await s.sync.enable();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.api.spaces).toEqual([key]);
    expect(s.api.pushes.flat().map((w) => w.content)).toEqual(['A']);
    expect(s.sync.state.getState()).toMatchObject({ key, status: 'idle', error: null });
    expect(await setup().sync.enable()).not.toBe(key);
  });

  it('keeps its settings under the names browsers already have saved', async () => {
    const s = setup();
    await s.repo.setMeta('syncKey', KEY);
    await s.repo.setMeta('syncLastKey', 'old');
    await s.repo.setMeta('syncCursor', 7);
    await s.sync.start();
    expect(s.sync.state.getState()).toMatchObject({ key: KEY, lastKey: 'old', status: 'syncing' });
    await vi.waitFor(() => expect(s.sync.state.getState().status).toBe('idle'));
    expect(s.api.pulls).toEqual([7]);
  });

  it('start with sync off only reads the earlier key, and records no changes', async () => {
    const s = setup();
    await s.repo.setMeta('syncLastKey', 'old');
    await s.sync.start();
    expect(s.sync.state.getState()).toMatchObject({ key: null, lastKey: 'old', status: 'off' });
    s.create('A');
    await s.engine.flush();
    expect(s.repo.outbox.size).toBe(0);
    expect(s.api.pulls).toEqual([]);
  });

  it('start with sync on records changes again', async () => {
    const s = setup();
    await s.repo.setMeta('syncKey', KEY);
    await s.sync.start();
    s.create('A');
    await s.engine.flush();
    expect(s.repo.outbox.size).toBe(1);
  });

  it('disable stops recording, forgets the key and cursor but keeps it as the earlier key', async () => {
    const s = setup();
    const key = await s.sync.enable();
    await s.sync.disable();
    expect(s.sync.state.getState()).toMatchObject({ key: null, lastKey: key, status: 'off', error: null, lastSyncedAt: null });
    expect(await s.repo.getMeta('syncKey')).toBeUndefined();
    expect(await s.repo.getMeta('syncCursor')).toBeUndefined();
    expect(await s.repo.getMeta('syncLastKey')).toBe(key);
    s.create('after');
    await s.engine.flush();
    expect(s.repo.outbox.size).toBe(0);
    await s.sync.disable();
    expect(s.sync.state.getState().lastKey).toBe(key);
  });

  it('resume needs an earlier key and then merges into it', async () => {
    const s = setup();
    await expect(s.sync.resume()).rejects.toThrow('This browser has no earlier sync to turn back on.');
    const key = await s.sync.enable();
    await s.sync.disable();
    s.create('written while off');
    await s.sync.resume();
    expect(s.sync.state.getState()).toMatchObject({ key, status: 'idle' });
    expect(s.api.pushes.flat().map((w) => w.content)).toContain('written while off');
  });

  it('joining with replace drops local notes and their pending uploads, then reports the replace', async () => {
    let replaced = 0;
    const s = setup({ afterReplace: () => replaced++ });
    s.create('local');
    await s.sync.join(KEY, 'replace');
    expect(replaced).toBe(1);
    expect([...s.engine.tree.all()]).toEqual([]);
    expect(s.api.pushes).toEqual([]);
    expect(s.sync.state.getState()).toMatchObject({ key: KEY, status: 'idle', download: null });
  });

  it('joining an unknown space fails clearly and changes nothing', async () => {
    const s = setup();
    s.create('local');
    s.api.checkSpace = async () => false;
    await expect(s.sync.join(KEY, 'replace')).rejects.toEqual(new SyncServerError('That sync link is not valid on this server.', 404));
    expect(s.sync.state.getState()).toMatchObject({ key: null, status: 'off', download: null });
    expect([...s.engine.tree.all()].map((n) => n.content)).toEqual(['local']);
  });

  it('follows another tab turning sync on and off without touching the outbox', async () => {
    const s = setup();
    await s.repo.setMeta('syncLastKey', 'old');
    await s.sync.reloadKey();
    expect(s.sync.state.getState()).toMatchObject({ key: null, lastKey: 'old', status: 'off' });
    await s.repo.setMeta('syncKey', KEY);
    await s.sync.reloadKey();
    expect(s.sync.state.getState()).toMatchObject({ key: KEY, status: 'syncing' });
    await s.sync.sync();
    s.create('A');
    await s.engine.flush();
    expect(s.repo.outbox.size).toBe(1);
    await s.repo.deleteMeta('syncKey');
    await s.sync.reloadKey();
    expect(s.sync.state.getState()).toMatchObject({ key: null, status: 'off', lastSyncedAt: null });
    expect(s.repo.outbox.size).toBe(1);
    s.create('B');
    await s.engine.flush();
    expect(s.repo.outbox.size).toBe(1);
  });

  it('keeps a pending join key until joining', async () => {
    const s = setup();
    s.sync.setPendingJoin(KEY);
    expect(s.sync.state.getState().pendingJoinKey).toBe(KEY);
    await s.sync.join(KEY, 'merge');
    expect(s.sync.state.getState().pendingJoinKey).toBeNull();
  });
});

describe('SyncService: scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uploads two seconds after the last edit by default', async () => {
    const s = setup();
    await s.sync.join(KEY, 'merge');
    s.api.pulls.length = 0;
    s.create('A');
    await vi.advanceTimersByTimeAsync(1500);
    s.create('B');
    await vi.advanceTimersByTimeAsync(1999);
    expect(s.api.pulls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(s.api.pulls).toHaveLength(1));
    expect(s.api.pushes.at(-1)!.map((w) => w.content)).toEqual(['A', 'B']);
  });

  it('does not schedule for pulled or other-tab changes, or while sync is off', async () => {
    const s = setup({ debounceMs: 10 });
    s.create('off');
    s.sync.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.api.pulls).toEqual([]);
    await s.sync.join(KEY, 'merge');
    s.api.pulls.length = 0;
    const node = { ...[...s.engine.tree.all()][0]!, id: newId() };
    s.engine.applyExternal([node], REMOTE_OP);
    s.engine.applyPeer([{ id: newId(), after: { ...node, id: newId() } }]);
    expect(PEER_OP).not.toBe(REMOTE_OP);
    await vi.advanceTimersByTimeAsync(100);
    expect(s.api.pulls).toEqual([]);
    s.engine.applyExternal([{ ...node, content: 'repaired' }], 'repair');
    await vi.advanceTimersByTimeAsync(100);
    expect(s.api.pulls).toHaveLength(1);
  });

  it('a sync now cancels the pending timer, and turning sync off cancels it too', async () => {
    const s = setup({ debounceMs: 50 });
    await s.sync.join(KEY, 'merge');
    s.api.pulls.length = 0;
    s.create('A');
    await s.sync.sync();
    expect(s.api.pulls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(s.api.pulls).toHaveLength(1);
    s.create('B');
    await s.sync.disable();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.api.pulls).toHaveLength(1);
  });

  it('stops listening once destroyed', async () => {
    const s = setup({ debounceMs: 10 });
    await s.sync.join(KEY, 'merge');
    s.api.pulls.length = 0;
    s.create('A');
    s.sync.destroy();
    await vi.advanceTimersByTimeAsync(100);
    s.create('B');
    await vi.advanceTimersByTimeAsync(100);
    expect(s.api.pulls).toEqual([]);
  });
});

describe('SyncService: a sync run', () => {
  it('shares one run between concurrent calls, plus one more when asked mid-run', async () => {
    const s = setup();
    await s.sync.join(KEY, 'merge');
    s.api.pulls.length = 0;
    let release!: () => void;
    s.api.pullResult = (since) => new Promise((r) => (release = () => r({ nodes: [], cursor: since, more: false })));
    const first = s.sync.sync();
    expect(s.sync.state.getState().status).toBe('syncing');
    const second = s.sync.sync();
    const third = s.sync.sync();
    expect(second).toBe(first);
    expect(third).toBe(first);
    await vi.waitFor(() => expect(s.api.pulls).toHaveLength(1));
    release();
    await vi.waitFor(() => expect(s.api.pulls).toHaveLength(2));
    release();
    await first;
    expect(s.api.pulls).toHaveLength(2);
    expect(s.sync.state.getState()).toMatchObject({ status: 'idle', error: null });
    expect(s.sync.state.getState().lastSyncedAt).toBeGreaterThan(0);
  });

  it('does nothing while sync is off', async () => {
    const s = setup();
    await s.sync.sync();
    expect(s.api.pulls).toEqual([]);
    expect(s.sync.state.getState().status).toBe('off');
  });

  it('still downloads when an upload is refused, then shows the error', async () => {
    const s = setup();
    await s.sync.join(KEY, 'merge');
    s.api.pulls.length = 0;
    s.create('A');
    s.api.pushResult = async () => {
      throw new SyncServerError('too big', 413);
    };
    await s.sync.sync();
    expect(s.api.pulls).toHaveLength(1);
    expect(s.sync.state.getState()).toMatchObject({ status: 'error', error: 'too big' });
  });

  it('goes offline without downloading when the network fails', async () => {
    const s = setup();
    await s.sync.join(KEY, 'merge');
    s.api.pulls.length = 0;
    s.create('A');
    s.api.pushResult = async () => {
      throw new TypeError('Failed to fetch');
    };
    await s.sync.sync();
    expect(s.api.pulls).toEqual([]);
    expect(s.sync.state.getState()).toMatchObject({ status: 'offline', error: null });
    expect(s.repo.outbox.size).toBe(1);
  });

  it('shows a server error from a download, and clears it on the next good run', async () => {
    const s = setup();
    await s.sync.join(KEY, 'merge');
    s.api.pullResult = async () => {
      throw new SyncServerError('no sync space for this key', 404);
    };
    await s.sync.sync();
    expect(s.sync.state.getState()).toMatchObject({ status: 'error', error: 'no sync space for this key' });
    s.api.pullResult = async (since) => ({ nodes: [], cursor: since, more: false });
    await s.sync.sync();
    expect(s.sync.state.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('runs under the lock, and skips the work if another tab turned sync off while waiting for it', async () => {
    let runs = 0;
    let gate: Promise<void> = Promise.resolve();
    const repo = new MemoryRepository();
    const engine = createEngine({ store: createTreeStore(), repository: repo });
    const api = fakeApi();
    const sync = new SyncService(engine, repo, api, {
      lock: async (work) => {
        runs++;
        await gate;
        await work();
      },
    });
    await sync.join(KEY, 'merge');
    expect(runs).toBe(1);
    api.pulls.length = 0;
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    const running = sync.sync();
    await repo.deleteMeta('syncKey');
    await sync.reloadKey();
    open();
    await running;
    expect(api.pulls).toEqual([]);
    expect(sync.state.getState().status).toBe('off');
  });

  it('pages through downloads, saving the cursor after each page', async () => {
    const s = setup();
    const node = (id: string): WireNode => ({ id, parentId: null, order: 'a0', content: id, note: '', collapsed: false, starredAt: null, createdAt: 1, deletedAt: null, t: { ...NO_TIMES, content: 5 } });
    const pages: PullResponse[] = [
      { nodes: [{ ...node('a'), order: 'a0', seq: 1 }], cursor: 1, more: true },
      { nodes: [{ ...node('b'), order: 'a1', seq: 2 }], cursor: 2, more: false },
    ];
    s.api.pullResult = async () => pages.shift() ?? { nodes: [], cursor: 2, more: false };
    await s.sync.join(KEY, 'replace');
    expect(s.api.pulls).toEqual([0, 1]);
    expect(await s.repo.getMeta('syncCursor')).toBe(2);
    expect([...s.engine.tree.all()].map((n) => n.content)).toEqual(['a', 'b']);
  });
});

describe('SyncService: uploads', () => {
  it('splits uploads to stay under the size limit, and empties the outbox', async () => {
    const s = setup();
    const big = 'x'.repeat(300_000);
    for (let i = 0; i < 5; i++) s.create(`${i}${big}`);
    await s.sync.join(KEY, 'merge');
    expect(s.api.pushes.map((p) => p.length)).toEqual([2, 2, 1]);
    expect(s.repo.outbox.size).toBe(0);
  });

  it('sends a single node bigger than the limit on its own', async () => {
    const s = setup();
    s.create('y'.repeat(900_000));
    s.create('small');
    await s.sync.join(KEY, 'merge');
    expect(s.api.pushes.map((p) => p.length)).toEqual([1, 1]);
  });

  it('counts notes toward the size limit too', async () => {
    const s = setup();
    for (let i = 0; i < 3; i++) {
      const id = s.create(`n${i}`);
      s.engine.execute({ type: 'updateNote', id, note: 'z'.repeat(300_000) });
    }
    await s.sync.join(KEY, 'merge');
    expect(s.api.pushes.map((p) => p.length)).toEqual([2, 1]);
  });

  it('drops nodes the server refuses, with a warning', async () => {
    const s = setup();
    s.create('bad');
    s.api.pushResult = async () => ({ seq: 1, rejected: ['x'] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await s.sync.join(KEY, 'merge');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('sync: the server refused these nodes', ['x']);
      expect(s.repo.outbox.size).toBe(0);
      warn.mockClear();
      s.api.pushResult = async () => ({ seq: 2, rejected: [] });
      s.create('good');
      await s.sync.sync();
      s.api.pushResult = async () => ({ seq: 3 });
      s.create('older server');
      await s.sync.sync();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('uploads a node removed outright as a tombstone stamped with its deletion', async () => {
    const s = setup();
    await s.sync.join(KEY, 'merge');
    s.api.pushes.length = 0;
    const id = s.create('short-lived');
    await s.sync.sync();
    s.engine.undo(); // undoing the creation removes the node
    await s.sync.sync();
    const last = s.api.pushes.at(-1)!;
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ id, content: '', deletedAt: last[0]!.t.deleted });
    expect(last[0]!.t.deleted).toBeGreaterThan(1_000_000);
  });

  it('uploads repairs made after a download', async () => {
    const s = setup();
    await s.sync.join(KEY, 'merge');
    s.api.pushes.length = 0;
    const orphan: WireNode = { id: 'o', parentId: 'gone', order: 'a0', content: 'orphan', note: '', collapsed: false, starredAt: null, createdAt: 1, deletedAt: null, t: { ...NO_TIMES, content: 5, pos: 5 } };
    let served = false;
    s.api.pullResult = async (since) => {
      if (served) return { nodes: [], cursor: since, more: false };
      served = true;
      return { nodes: [{ ...orphan, seq: 1 }], cursor: 1, more: false };
    };
    await s.sync.sync();
    expect(s.engine.tree.get('o')!.parentId).toBeNull();
    expect(s.api.pushes.flat().map((w) => [w.id, w.parentId])).toEqual([['o', null]]);
  });
});
