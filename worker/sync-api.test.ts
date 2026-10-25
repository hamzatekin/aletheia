import { beforeEach, describe, expect, it } from 'vitest';
import { NO_TIMES, type PullResponse, type PushResponse, type WireNode } from '../src/sync/wire';
import { handleSync, hasSyncSpace, MAX_FUTURE_MS, resetSchemaCache, type SqlDatabase } from './sync';
import { sqliteD1 } from './testing/sqlite-d1';

// The HTTP contract of the sync API, request by request: auth, routes,
// validation, merging and paging. worker/sync.test.ts covers whole devices.

const KEY = 'k'.repeat(32);
const OTHER = 'o'.repeat(40);

let db: SqlDatabase;
let maxSpaces: string | undefined;
beforeEach(() => {
  resetSchemaCache();
  db = sqliteD1();
  maxSpaces = undefined;
});

function request(method: string, path: string, key: string | null, body?: unknown, auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.Authorization = auth;
  else if (key) headers.Authorization = `Bearer ${key}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(`https://aletheia.test/api/sync/${path}`, init);
}

function call(method: string, path: string, key: string | null, body?: unknown, auth?: string): Promise<Response> {
  return handleSync(request(method, path, key, body, auth), maxSpaces === undefined ? { DB: db } : { DB: db, SYNC_MAX_SPACES: maxSpaces });
}

async function body<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

function wire(id: string, fields: Partial<WireNode> = {}): WireNode {
  return { id, parentId: null, order: 'a0', content: '', note: '', collapsed: false, starredAt: null, createdAt: 1, deletedAt: null, t: { ...NO_TIMES }, ...fields };
}

const pull = (since = 0, extra = '') => body<PullResponse>(call('GET', `pull?since=${since}${extra}`, KEY));
const push = (nodes: unknown[]) => call('POST', 'push', KEY, { nodes });

describe('auth and routes', () => {
  it('accepts a key of exactly 32 characters and refuses shorter ones or other schemes', async () => {
    expect((await call('POST', 'space', 'k'.repeat(31))).status).toBe(401);
    expect(await body(call('POST', 'space', null))).toEqual({ error: 'missing or short sync key' });
    expect((await call('POST', 'space', null, undefined, `Basic ${KEY}`)).status).toBe(401);
    expect((await call('POST', 'space', null, undefined, `Bearer ${KEY} extra`)).status).toBe(401);
    expect((await call('POST', 'space', null, undefined, `xBearer ${KEY}`)).status).toBe(401);
    const res = await call('POST', 'space', KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers whether the space exists, and 404s unknown routes', async () => {
    expect((await call('GET', 'space', KEY)).status).toBe(404);
    expect(await body(call('GET', 'space', KEY))).toEqual({ error: 'no sync space for this key' });
    await call('POST', 'space', KEY);
    const res = await call('GET', 'space', KEY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await call('GET', 'push', KEY)).status).toBe(404);
    expect((await call('POST', 'pull', KEY)).status).toBe(404);
    expect(await body(call('GET', 'nope', KEY))).toEqual({ error: 'not found' });
  });

  it('allows one space by default, more when configured', async () => {
    await call('POST', 'space', KEY);
    const refused = await call('POST', 'space', OTHER);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'This server already has its sync space. Join it with the link from your other device.' });
    expect((await call('GET', 'space', OTHER)).status).toBe(404);
    maxSpaces = '2';
    expect(await body(call('POST', 'space', OTHER))).toEqual({ created: true });
    expect((await call('POST', 'space', 'z'.repeat(32))).status).toBe(403);
  });

  it('stores only the SHA-256 of the key, never the key', async () => {
    await call('POST', 'space', KEY);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(KEY));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await db.prepare('SELECT id FROM spaces').all()).toEqual({ results: [{ id: hex }] });
  });

  it('hasSyncSpace is true only for the key of an existing space', async () => {
    expect(await hasSyncSpace(request('GET', 'space', null), { DB: db })).toBe(false);
    expect(await hasSyncSpace(request('GET', 'space', KEY), { DB: db })).toBe(false);
    await call('POST', 'space', KEY);
    expect(await hasSyncSpace(request('GET', 'space', KEY), { DB: db })).toBe(true);
    expect(await hasSyncSpace(request('GET', 'space', OTHER), { DB: db })).toBe(false);
  });
});

describe('push', () => {
  beforeEach(async () => {
    await call('POST', 'space', KEY);
  });

  it('refuses a body that is not JSON or has no node list, and more than 500 nodes', async () => {
    const notJson = await call('POST', 'push', KEY, '{oops');
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: 'body must be JSON' });
    expect((await call('POST', 'push', KEY, 'null')).status).toBe(400);
    expect((await call('POST', 'push', KEY, { nodes: 'x' })).status).toBe(400);
    const tooMany = await push(Array.from({ length: 501 }, (_, i) => wire(`n${i}`)));
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toEqual({ error: 'nodes must be a list of at most 500' });
    expect((await push(Array.from({ length: 500 }, (_, i) => wire(`n${i}`)))).status).toBe(200);
  });

  it('returns the new sequence number, and null with nothing valid to store', async () => {
    expect(await body(push([wire('a'), wire('b')]))).toEqual({ seq: 2, rejected: [] });
    expect(await body(push([wire('c')]))).toEqual({ seq: 3, rejected: [] });
    expect(await body(push([]))).toEqual({ seq: null, rejected: [] });
    expect(await body(push([{ id: 'bad' }, 5, null]))).toEqual({ seq: null, rejected: ['bad', '', ''] });
  });

  it('rejects each malformed field and keeps the valid nodes', async () => {
    const t = { ...NO_TIMES };
    const bad: [string, Record<string, unknown>][] = [
      ['empty id', { id: '' }],
      ['long id', { id: 'x'.repeat(65) }],
      ['parent', { parentId: 5 }],
      ['order', { order: null }],
      ['content', { content: 1 }],
      ['note', { note: undefined }],
      ['collapsed', { collapsed: 'yes' }],
      ['createdAt', { createdAt: 'now' }],
      ['deletedAt', { deletedAt: 'then' }],
      ['starredAt', { starredAt: 'soon' }],
      ['completedAt', { completedAt: 'done' }],
      ['heading', { heading: 4 }],
      ['color', { color: 'pink' }],
      ['no times', { t: null }],
      ['times not object', { t: 5 }],
      ['missing time', { t: { ...t, content: undefined } }],
      ['bad time', { t: { ...t, pos: 'x' } }],
    ];
    const nodes = bad.map(([name, fields]) => ({ ...wire(name), ...fields }));
    const res = await body<PushResponse>(push([...nodes, wire('x'.repeat(64)), wire('ok', { parentId: 'p', deletedAt: 3, starredAt: 4, completedAt: 5, heading: 3, color: 'purple' })]));
    expect(res.rejected).toEqual(['', 'x'.repeat(65), 'parent', 'order', 'content', 'note', 'collapsed', 'createdAt', 'deletedAt', 'starredAt', 'completedAt', 'heading', 'color', 'no times', 'times not object', 'missing time', 'bad time']);
    expect(res.seq).toBe(2);
    expect((await pull()).nodes.map((n) => n.id)).toEqual(['x'.repeat(64), 'ok']);
  });

  it('accepts a node without starredAt and without a starred time', async () => {
    const { starredAt: _, ...old } = wire('old');
    const { starred: _s, ...times } = old.t;
    expect(await body(push([{ ...old, t: times }]))).toEqual({ seq: 1, rejected: [] });
  });

  it('accepts a node without done, heading or color, and without their times, and reads them back as none', async () => {
    const { completed: _c, format: _f, ...times } = NO_TIMES;
    expect(await body(push([{ ...wire('old'), t: times }]))).toEqual({ seq: 1, rejected: [] });
    expect((await pull()).nodes).toEqual([{ ...wire('old'), seq: 1, completedAt: null, heading: null, color: null }]);
  });

  it('adds the done, heading and color columns to a database made before them', async () => {
    resetSchemaCache();
    db = sqliteD1();
    await db.prepare(`CREATE TABLE nodes (
      space TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, created_at INTEGER NOT NULL,
      content TEXT NOT NULL, content_t INTEGER NOT NULL, note TEXT NOT NULL, note_t INTEGER NOT NULL,
      parent_id TEXT, ord TEXT NOT NULL, pos_t INTEGER NOT NULL, collapsed INTEGER NOT NULL, collapsed_t INTEGER NOT NULL,
      deleted_at INTEGER, deleted_t INTEGER NOT NULL, starred_at INTEGER, starred_t INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (space, id))`).run();
    await call('POST', 'space', KEY);
    const t = { ...NO_TIMES, completed: 5, format: 6 };
    expect(await body(push([wire('n', { completedAt: 5, heading: 1, color: 'yellow', t })]))).toEqual({ seq: 1, rejected: [] });
    expect((await pull()).nodes).toEqual([{ ...wire('n', { completedAt: 5, heading: 1, color: 'yellow', t }), seq: 1 }]);
  });

  it('stores every field and reads it back exactly', async () => {
    const t = { content: 11, note: 12, pos: 13, collapsed: 14, starred: 15, completed: 17, format: 18, deleted: 16 };
    await push([wire('n', { parentId: 'p', order: 'b5', content: 'c', note: 'nn', collapsed: true, starredAt: 40, completedAt: 41, heading: 2, color: 'blue', createdAt: 7, deletedAt: 50, t })]);
    expect(await pull()).toEqual({
      nodes: [{ id: 'n', seq: 1, parentId: 'p', order: 'b5', content: 'c', note: 'nn', collapsed: true, starredAt: 40, completedAt: 41, heading: 2, color: 'blue', createdAt: 7, deletedAt: 50, t }],
      cursor: 1,
      more: false,
    });
  });

  it('merges each group by its time: newer wins, older and equal lose, and createdAt keeps the earliest', async () => {
    const t1 = { content: 10, note: 10, pos: 10, collapsed: 10, starred: 10, completed: 10, format: 10, deleted: 10 };
    await push([wire('n', { content: 'c1', note: 'n1', parentId: 'p1', order: 'a1', collapsed: false, starredAt: null, deletedAt: null, createdAt: 5, t: t1 })]);
    // Equal times do not overwrite.
    await push([wire('n', { content: 'c2', note: 'n2', parentId: 'p2', order: 'a2', collapsed: true, starredAt: 9, completedAt: 9, heading: 1, color: 'red', deletedAt: 9, createdAt: 8, t: t1 })]);
    let n = (await pull()).nodes[0]!;
    expect(n).toMatchObject({ content: 'c1', note: 'n1', parentId: 'p1', order: 'a1', collapsed: false, starredAt: null, completedAt: null, heading: null, color: null, deletedAt: null, createdAt: 5, t: t1 });
    // Newer times win, group by group; older ones don't lower the stored time.
    const t2 = { content: 20, note: 5, pos: 20, collapsed: 5, starred: 20, completed: 20, format: 5, deleted: 5 };
    await push([wire('n', { content: 'c3', note: 'n3', parentId: 'p3', order: 'a3', collapsed: true, starredAt: 30, completedAt: 31, heading: 3, color: 'green', deletedAt: 30, createdAt: 2, t: t2 })]);
    n = (await pull()).nodes[0]!;
    expect(n).toEqual({
      id: 'n',
      seq: 3,
      content: 'c3',
      note: 'n1',
      parentId: 'p3',
      order: 'a3',
      collapsed: false,
      starredAt: 30,
      completedAt: 31,
      heading: null,
      color: null,
      deletedAt: null,
      createdAt: 2,
      t: { content: 20, note: 10, pos: 20, collapsed: 10, starred: 20, completed: 20, format: 10, deleted: 10 },
    });
  });

  it('caps times more than a minute ahead, and keeps times within that minute', async () => {
    const soon = Date.now() + MAX_FUTURE_MS - 5_000;
    const far = Date.now() + 10 * MAX_FUTURE_MS;
    await push([wire('n', { t: { ...NO_TIMES, content: soon, note: far, deleted: far } })]);
    const t = (await pull()).nodes[0]!.t;
    expect(t.content).toBe(soon);
    expect(t.note).toBeLessThan(far);
    expect(t.note).toBeGreaterThanOrEqual(soon);
    expect(t.note).toBeLessThanOrEqual(Date.now() + MAX_FUTURE_MS);
    expect(t.deleted).toBe(t.note);
    expect(t.pos).toBe(0);
  });
});

describe('pull', () => {
  beforeEach(async () => {
    await call('POST', 'space', KEY);
    await push(Array.from({ length: 4 }, (_, i) => wire(`n${i}`)));
  });

  it('returns changes after `since`, and the same cursor when there are none', async () => {
    expect((await pull(2)).nodes.map((n) => n.id)).toEqual(['n2', 'n3']);
    expect(await pull(4)).toEqual({ nodes: [], cursor: 4, more: false });
    expect(await pull(9)).toEqual({ nodes: [], cursor: 9, more: false });
  });

  it('pages exactly at the limit', async () => {
    expect(await pull(0, '&limit=4')).toMatchObject({ cursor: 4, more: false });
    const p = await pull(0, '&limit=3');
    expect(p.nodes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2']);
    expect(p).toMatchObject({ cursor: 3, more: true });
    expect((await pull(0, '&limit=1')).nodes.map((n) => n.id)).toEqual(['n0']);
  });

  it('reads bad or missing parameters as the defaults', async () => {
    expect((await body<PullResponse>(call('GET', 'pull', KEY))).nodes).toHaveLength(4);
    expect((await body<PullResponse>(call('GET', 'pull?since=abc', KEY))).nodes).toHaveLength(4);
    expect((await body<PullResponse>(call('GET', 'pull?since=-5', KEY))).cursor).toBe(4);
    expect((await pull(1.7)).nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect((await pull(0, '&limit=0')).nodes).toHaveLength(4);
    expect((await pull(0, '&limit=-3')).nodes.map((n) => n.id)).toEqual(['n0']);
    expect((await pull(0, '&limit=abc')).nodes).toHaveLength(4);
    expect((await pull(0, '&limit=2.9')).nodes).toHaveLength(2);
  });

  it('never returns more than 500 at once', async () => {
    await push(Array.from({ length: 500 }, (_, i) => wire(`m${i}`)));
    const p = await pull(0, '&limit=100000');
    expect(p.nodes).toHaveLength(500);
    expect(p).toMatchObject({ cursor: 500, more: true });
    expect((await pull()).nodes).toHaveLength(500);
  });
});
