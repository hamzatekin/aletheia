import { beforeEach, describe, expect, it } from 'vitest';
import type { PullResponse } from '../src/sync/wire';
import { handleCapture } from './capture';
import { handlePages } from './pages';
import { handleSync, resetSchemaCache, type SqlDatabase } from './sync';
import { sqliteD1 } from './testing/sqlite-d1';

const KEY = 'k'.repeat(32);
const NOW = Date.UTC(2026, 9, 14, 13, 0);
const PAGE = '<!doctype html><title>Week 42</title><h1>Done this week</h1>';

let db: SqlDatabase;
let captureKey: string;
beforeEach(async () => {
  resetSchemaCache();
  db = sqliteD1();
  await sync('POST', 'space');
  captureKey = ((await (await sync('POST', 'capture-key')).json()) as { key: string }).key;
});

function sync(method: string, path: string, key = KEY): Promise<Response> {
  return handleSync(new Request(`https://aletheia.test/api/sync/${path}`, { method, headers: { Authorization: `Bearer ${key}` } }), { DB: db });
}

async function capture(body: object): Promise<Response> {
  const req = new Request('https://aletheia.test/api/capture', {
    method: 'POST',
    headers: { Authorization: `Bearer ${captureKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleCapture(req, { DB: db }, NOW);
}

function getPage(path: string, key: string | null = KEY, method = 'GET'): Promise<Response> {
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  return handlePages(new Request(`https://aletheia.test${path}`, { method, headers }), { DB: db });
}

async function itemNote(id: string): Promise<string> {
  const { nodes } = (await (await sync('GET', 'pull?since=0')).json()) as PullResponse;
  return nodes.find((n) => n.id === id)!.note;
}

describe('pages sent with a capture', () => {
  it('stores the page, links it at the top of the note, and returns its address', async () => {
    const res = await capture({ title: 'Week 42 report', note: 'Shipped **three** things.', page: `  ${PAGE}\n` });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; page: string };
    const id = /^https:\/\/aletheia\.test\/p\/([0-9a-f]{32})$/.exec(body.page)![1]!;
    expect(await itemNote(body.id)).toBe(`[Open the page](/p/${id})\n\nShipped **three** things.`);
    const page = await getPage(`/api/pages/${id}`);
    expect(page.status).toBe(200);
    expect(await page.json()).toEqual({ title: 'Week 42 report', html: PAGE, createdAt: NOW });
  });

  it('makes the note just the link when there is no note, and adds nothing without a page', async () => {
    const withPage = (await (await capture({ title: 'a', page: PAGE })).json()) as { id: string; page: string };
    expect(await itemNote(withPage.id)).toBe(`[Open the page](${new URL(withPage.page).pathname})`);
    const plain = (await (await capture({ title: 'b', note: 'n', page: '   ' })).json()) as Record<string, unknown>;
    expect(Object.keys(plain)).toEqual(['id', 'url', 'path']);
    expect(await itemNote(plain.id as string)).toBe('n');
    expect(await db.prepare('SELECT count(*) AS n FROM pages').first()).toEqual({ n: 1 });
  });

  it('refuses a page over the size limit', async () => {
    const res = await capture({ title: 'big', page: 'x'.repeat(1_000_001) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'page must be at most 1000000 characters' });
    expect((await capture({ title: 'fits', page: 'x'.repeat(1_000_000) })).status).toBe(201);
  });
});

describe('GET /api/pages/<id>', () => {
  let id: string;
  beforeEach(async () => {
    const body = (await (await capture({ title: 'Report', page: PAGE })).json()) as { page: string };
    id = body.page.split('/p/')[1]!;
  });

  it('opens only with the sync key of the space that owns it', async () => {
    const message = { error: 'This page opens only on your devices with sync on.' };
    expect(await (await getPage(`/api/pages/${id}`, null)).json()).toEqual(message);
    expect((await getPage(`/api/pages/${id}`, null)).status).toBe(401);
    expect((await getPage(`/api/pages/${id}`, captureKey)).status).toBe(401);
    expect((await getPage(`/api/pages/${id}`, 'o'.repeat(32))).status).toBe(401);
    // Another space on the same server cannot read it.
    await db.prepare("INSERT INTO pages (id, space, title, html, created_at) VALUES (?1, 'other', 't', 'h', 1)").bind('a'.repeat(32)).run();
    const other = await getPage(`/api/pages/${'a'.repeat(32)}`);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: 'This page does not exist.' });
  });

  it('answers 404 for other methods and malformed ids', async () => {
    expect((await getPage(`/api/pages/${id}`, KEY, 'POST')).status).toBe(404);
    expect(await (await getPage(`/api/pages/${id.toUpperCase()}`)).json()).toEqual({ error: 'not found' });
    expect((await getPage(`/api/pages/${id}x`)).status).toBe(404);
    expect((await getPage(`/api/pages/${id.slice(1)}`)).status).toBe(404);
    expect((await getPage(`/api/pages/x/${id}`)).status).toBe(404);
    expect((await getPage(`/api/pages/api/pages/${id}`)).status).toBe(404);
    expect((await getPage(`/api/pages/${id}/`)).status).toBe(404);
    expect((await getPage(`/api/pages/${id}`)).status).toBe(200);
  });
});
