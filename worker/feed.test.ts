import { beforeEach, describe, expect, it } from 'vitest';
import type { WireNode } from '../src/sync/wire';
import { handleFeed, parsePiles, type FeedEnv, type FeedResponse } from './feed';
import { handleSync, resetSchemaCache, type SqlDatabase } from './sync';
import { sqliteD1 } from './testing/sqlite-d1';

const KEY = 'k'.repeat(32);
const TOKEN = 'feed-token-0123456789';
// In the past, so the sync server never pulls these times back to its clock.
const NOW = Date.UTC(2026, 9, 10, 6, 0);
const DAY = 24 * 60 * 60 * 1000;
const PILES = JSON.stringify(['Inbox', 'Work', 'Personal/Fitness', 'Personal/Girişimcilik / Yatırım', 'Personal/Passwords']);

let db: SqlDatabase;
beforeEach(async () => {
  resetSchemaCache();
  db = sqliteD1();
  await sync('POST', 'space');
});

function sync(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${KEY}` } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handleSync(new Request(`https://aletheia.test/api/sync/${path}`, init), { DB: db });
}

/** A node changed at `at` (every group), created a week before NOW unless given. */
function wire(id: string, parentId: string | null, order: string, content: string, fields: Partial<WireNode> & { at?: number } = {}): WireNode {
  const { at = NOW - 7 * DAY, ...rest } = fields;
  const t = { content: at, note: at, pos: at, collapsed: at, starred: at, deleted: at };
  return { id, parentId, order, content, note: '', collapsed: false, starredAt: null, createdAt: NOW - 7 * DAY, deletedAt: null, t, ...rest };
}

async function push(...nodes: WireNode[]): Promise<void> {
  expect((await sync('POST', 'push', { nodes })).status).toBe(200);
}

function feed(query = '', init: { token?: string | null; auth?: string; env?: Partial<FeedEnv>; method?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = init.token === undefined ? TOKEN : init.token;
  if (token !== null) headers.Authorization = init.auth ?? `Bearer ${token}`;
  const req = new Request(`https://aletheia.test/api/feed${query}`, { method: init.method ?? 'GET', headers });
  return handleFeed(req, { DB: db, FEED_TOKEN: TOKEN, FEED_PILES: PILES, ...init.env }, NOW);
}

async function body(query = '', env: Partial<FeedEnv> = {}): Promise<FeedResponse> {
  const res = await feed(query, { env });
  expect(res.status).toBe(200);
  return (await res.json()) as FeedResponse;
}

/** Each node as "path › text" (the pile alone for a pile). */
const lines = (r: FeedResponse) => r.nodes.map((n) => [...n.path, n.text].join(' › '));

/** Inbox, Work, and Personal with Fitness, Girişimcilik / Yatırım, Journal, Passwords and Budget. */
async function seed(): Promise<void> {
  await push(
    wire('inbox', null, 'a0', 'Inbox'),
    wire('i1', 'inbox', 'a0', 'call the bank', { note: 'before Friday' }),
    wire('work', null, 'a1', '**Work**'),
    wire('w1', 'work', 'a0', 'whatsapp templates'),
    wire('w2', 'work', 'a1', 'release notes'),
    wire('w2a', 'w2', 'a0', 'draft'),
    wire('personal', null, 'a2', 'Personal'),
    wire('fit', 'personal', 'a0', 'Fitness'),
    wire('f1', 'fit', 'a0', 'run 5k'),
    wire('inv', 'personal', 'a1', 'Girişimcilik / Yatırım'),
    wire('v1', 'inv', 'a0', 'index funds'),
    wire('journal', 'personal', 'a2', 'Journal'),
    wire('j1', 'journal', 'a0', 'dear diary'),
    wire('pw', 'personal', 'a3', 'Passwords'),
    wire('p1', 'pw', 'a0', 'hunter2'),
    wire('budget', 'personal', 'a4', 'Budget'),
    wire('b1', 'budget', 'a0', 'rent'),
  );
}

describe('feed auth', () => {
  it('answers 401 with an empty body to a missing, wrong or short token, and while FEED_TOKEN is unset', async () => {
    await seed();
    for (const res of [
      await feed('', { token: null }),
      await feed('', { token: 'wrong-token-0123456789' }),
      await feed('', { token: TOKEN.slice(0, -1) }),
      await feed('', { token: '' }),
      await feed('', { env: { FEED_TOKEN: '' } }),
      await feed('', { env: { FEED_TOKEN: undefined } }),
      await feed('', { token: null, env: { FEED_TOKEN: undefined } }),
      await feed('', { auth: `Basic Bearer ${TOKEN}` }),
      await feed('', { auth: `Bearer ${TOKEN} more` }),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('does not take the sync key', async () => {
    expect((await feed('', { token: KEY })).status).toBe(401);
  });

  it('only answers GET /api/feed', async () => {
    const res = await feed('', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

describe('feed', () => {
  it('serves the allowed piles as a flat list, as JSON nobody caches', async () => {
    await seed();
    const res = await feed();
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const r = (await res.json()) as FeedResponse;
    expect(r.generatedAt).toBe('2026-10-10T06:00:00.000Z');
    expect(r.deleted).toBeUndefined();
    expect(lines(r)).toEqual([
      'Inbox',
      'Inbox › call the bank',
      '**Work**',
      '**Work** › whatsapp templates',
      '**Work** › release notes',
      '**Work** › release notes › draft',
      'Fitness',
      'Fitness › run 5k',
      'Girişimcilik / Yatırım',
      'Girişimcilik / Yatırım › index funds',
    ]);
  });

  it('gives each node its parent, note, place among siblings and times', async () => {
    await push(
      wire('work', null, 'a0', 'Work'),
      wire('w1', 'work', 'a0', 'one', { note: 'details', createdAt: NOW - 30 * DAY, at: NOW - 21 * DAY }),
      wire('w2', 'work', 'a1', 'two'),
    );
    await push({ ...wire('w2', 'work', 'a1', 'two', { at: 0 }), note: 'edited', t: { content: 0, note: NOW - DAY, pos: 0, collapsed: NOW, starred: NOW, deleted: 0 } });
    const r = await body('', { FEED_PILES: '["Work"]' });
    expect(r.nodes).toEqual([
      { id: 'work', parentId: null, path: [], text: 'Work', note: null, order: 0, createdAt: '2026-10-03T06:00:00.000Z', updatedAt: '2026-10-03T06:00:00.000Z' },
      { id: 'w1', parentId: 'work', path: ['Work'], text: 'one', note: 'details', order: 0, createdAt: '2026-09-10T06:00:00.000Z', updatedAt: '2026-09-19T06:00:00.000Z' },
      // Expanding or starring isn't an update; editing the note is.
      { id: 'w2', parentId: 'work', path: ['Work'], text: 'two', note: 'edited', order: 1, createdAt: '2026-10-03T06:00:00.000Z', updatedAt: '2026-10-09T06:00:00.000Z' },
    ]);
  });

  it('lists siblings in outline order, whatever order they were synced in', async () => {
    await push(wire('w3', 'work', 'a2', 'three'), wire('w1b', 'work', 'a0', 'one b'), wire('w1a', 'work', 'a0', 'one a'), wire('w2', 'work', 'a1', 'two'), wire('work', null, 'a0', 'Work'));
    const r = await body('', { FEED_PILES: '["Work"]' });
    expect(r.nodes.map((n) => `${n.text} ${n.order}`)).toEqual(['Work 0', 'one a 0', 'one b 1', 'two 2', 'three 3']);
  });

  it('starts a nested pile at the pile: no parent and no ancestors outside it', async () => {
    await seed();
    const r = await body('', { FEED_PILES: '["Personal/Fitness"]' });
    expect(r.nodes.map((n) => [n.id, n.parentId, n.path])).toEqual([
      ['fit', null, []],
      ['f1', 'fit', ['Fitness']],
    ]);
  });

  it('never serves Passwords or Budget, even when listed or inside a listed pile', async () => {
    await seed();
    await push(wire('wpw', 'work', 'a2', 'passwords'), wire('wpw1', 'wpw', 'a0', 'wifi'), wire('top', null, 'a3', 'Budget'), wire('t1', 'top', 'a0', 'rent'));
    const r = await body('', { FEED_PILES: '["Personal", "Personal/Passwords", "Budget", "Work"]' });
    const ids = r.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['personal', 'fit', 'journal', 'j1', 'w1']));
    for (const id of ['pw', 'p1', 'budget', 'b1', 'wpw', 'wpw1', 'top', 't1']) expect(ids).not.toContain(id);
    // Order counts only what is served, so a blocked sibling leaves no gap.
    expect(r.nodes.find((n) => n.id === 'journal')!.order).toBe(2);
  });

  it('matches pile names whatever their case, Markdown marks, dashes or spaces around "/"', async () => {
    await push(wire('rec', null, 'a0', 'Tavsiye Müzik – Film — Dizi - Kitap'), wire('r1', 'rec', 'a0', 'Dune'));
    const r = await body('', { FEED_PILES: '["tavsiye müzik - film - dizi - kitap"]' });
    expect(lines(r)).toEqual(['Tavsiye Müzik – Film — Dizi - Kitap', 'Tavsiye Müzik – Film — Dizi - Kitap › Dune']);
  });

  it('leaves out deleted nodes and everything not in a listed pile', async () => {
    await seed();
    await push(wire('w2', 'work', 'a1', 'release notes', { deletedAt: NOW - DAY, at: NOW - DAY }), wire('w2a', 'w2', 'a0', 'draft', { deletedAt: NOW - DAY, at: NOW - DAY }));
    const r = await body('', { FEED_PILES: '["Work"]' });
    expect(lines(r)).toEqual(['**Work**', '**Work** › whatsapp templates']);
  });

  it('serves nothing when FEED_PILES is missing or not a list of paths', async () => {
    await seed();
    await push(wire('blank', null, 'a9', ''), wire('b1', 'blank', 'a0', 'under a blank row'));
    for (const FEED_PILES of [undefined, '', 'Inbox', '{"Inbox": true}', '[1, null]', '["", " "]']) {
      expect((await body('', { FEED_PILES })).nodes).toEqual([]);
    }
  });

  it('serves nothing before sync is on', async () => {
    resetSchemaCache();
    db = sqliteD1();
    expect((await body()).nodes).toEqual([]);
  });
});

describe('feed since', () => {
  it('returns only what changed after it, with its full path, and what was deleted after it', async () => {
    await seed();
    const minuteAgo = NOW - 60_000;
    await push(
      wire('w2a', 'w2', 'a0', 'draft', { note: 'new note', at: NOW - 30_000 }),
      wire('i1', 'inbox', 'a0', 'call the bank', { deletedAt: NOW - 10_000, at: NOW - 10_000 }),
      wire('w9', 'work', 'a9', 'old delete', { deletedAt: NOW - 2 * DAY, at: NOW - 2 * DAY }),
      wire('j1', 'journal', 'a0', 'dear diary', { deletedAt: NOW - 10_000, at: NOW - 10_000 }),
      wire('p1', 'pw', 'a0', 'hunter2', { deletedAt: NOW - 10_000, at: NOW - 10_000 }),
    );
    const r = await body(`?since=${new Date(minuteAgo).toISOString()}`);
    expect(r.nodes.map((n) => [n.id, n.path, n.note])).toEqual([['w2a', ['**Work**', 'release notes'], 'new note']]);
    expect(r.deleted).toEqual([{ id: 'i1', deletedAt: '2026-10-10T05:59:50.000Z' }]);
  });

  it('leaves out what changed exactly at since', async () => {
    await seed();
    const at = NOW - 1000;
    await push(wire('w1', 'work', 'a0', 'edited', { at }), wire('w2a', 'w2', 'a0', 'draft', { deletedAt: at, at }));
    const r = await body(`?since=${new Date(at).toISOString()}`);
    expect(r).toMatchObject({ nodes: [], deleted: [] });
  });

  it('lists a deleted nested pile, but no deleted node outside the top level', async () => {
    await seed();
    const at = NOW - 1000;
    await push(
      wire('fit', 'personal', 'a0', 'Fitness', { deletedAt: at, at }),
      // Its parent is gone: like a live node there, it is in no pile.
      wire('lost', 'gone', 'a0', 'Inbox', { deletedAt: at, at }),
      // A loop of parents never reaches the top level.
      wire('x', 'y', 'a0', 'Inbox', { deletedAt: at, at }),
      wire('y', 'x', 'a0', 'Inbox', { deletedAt: at, at }),
    );
    const r = await body(`?since=${new Date(NOW - 60_000).toISOString()}`);
    expect(r.deleted).toEqual([{ id: 'fit', deletedAt: '2026-10-10T05:59:59.000Z' }]);
  });

  it('lists the deleted descendants of a deleted node', async () => {
    await seed();
    const at = NOW - 1000;
    await push(wire('w2', 'work', 'a1', 'release notes', { deletedAt: at, at }), wire('w2a', 'w2', 'a0', 'draft', { deletedAt: at, at }));
    const r = await body(`?since=${new Date(NOW - 60_000).toISOString()}`);
    expect(r.nodes).toEqual([]);
    expect(r.deleted!.map((d) => d.id).sort()).toEqual(['w2', 'w2a']);
  });

  it('refuses a since that is not a time', async () => {
    const res = await feed('?since=yesterday');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'since must be an ISO timestamp' });
  });
});

describe('parsePiles', () => {
  it('reads a JSON list of paths, compared without case or spaces around "/"', () => {
    expect([...parsePiles('["Inbox", "Personal / Fitness", "Personal/ Journal", "Personal /Astro", "**Work**", 3]')]).toEqual([
      'inbox',
      'personal/fitness',
      'personal/journal',
      'personal/astro',
      'work',
    ]);
  });
});
