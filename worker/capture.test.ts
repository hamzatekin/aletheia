import { beforeEach, describe, expect, it } from 'vitest';
import { NO_TIMES, type PullResponse, type ServerNode, type WireNode } from '../src/sync/wire';
import { dayName, handleCapture, label } from './capture';
import { handleSync, resetSchemaCache, type SqlDatabase } from './sync';
import { sqliteD1 } from './testing/sqlite-d1';

const KEY = 'k'.repeat(32);
const NOW = Date.UTC(2026, 9, 14, 13, 0);
const DAY = 24 * 60 * 60 * 1000;

let db: SqlDatabase;
beforeEach(async () => {
  resetSchemaCache();
  db = sqliteD1();
  await sync('POST', 'space');
});

function sync(method: string, path: string, body?: unknown, key = KEY): Promise<Response> {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${key}` } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handleSync(new Request(`https://aletheia.test/api/sync/${path}`, init), { DB: db });
}

async function captureKey(): Promise<string> {
  return ((await (await sync('POST', 'capture-key')).json()) as { key: string }).key;
}

function capture(key: string | null, body: unknown, init: { method?: string; path?: string; type?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': init.type ?? 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const req = new Request(`https://aletheia.test${init.path ?? '/api/capture'}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.method === 'GET' ? null : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return handleCapture(req, { DB: db }, NOW);
}

function wire(id: string, fields: Partial<WireNode> = {}): WireNode {
  const t = { content: 1, note: 1, pos: 1, collapsed: 1, starred: 1, completed: 1, format: 1, deleted: 1 };
  return { id, parentId: null, order: 'a0', content: '', note: '', collapsed: false, starredAt: null, createdAt: NOW - DAY, deletedAt: null, t, ...fields };
}

async function nodes(): Promise<ServerNode[]> {
  return ((await (await sync('GET', 'pull?since=0')).json()) as PullResponse).nodes;
}

/** The live outline as indented lines ("Work", "  14 Oct", "    Title"), each with its note after " | " when it has one. */
async function outline(): Promise<string[]> {
  const all = (await nodes()).filter((n) => n.deletedAt === null);
  const out: string[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const kids = all.filter((n) => n.parentId === parentId).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
    for (const n of kids) {
      out.push(`${'  '.repeat(depth)}${n.content}${n.collapsed ? ' (collapsed)' : ''}${n.note ? ` | ${n.note}` : ''}`);
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

describe('capture keys', () => {
  it('are made with the sync key, start with alc_, and only the newest one works', async () => {
    const first = await captureKey();
    expect(first).toMatch(/^alc_[0-9a-f]{64}$/);
    expect((await capture(first, { title: 'one' })).status).toBe(201);
    const second = await captureKey();
    expect(second).not.toBe(first);
    const old = await capture(first, { title: 'two' });
    expect(old.status).toBe(401);
    expect(await old.json()).toEqual({ error: 'Unknown capture key. Make a new one in Aletheia: Settings → Sync → Claude Code.' });
    expect((await capture(second, { title: 'three' })).status).toBe(201);
    expect(await outline()).toEqual(['Work', '  14 Oct', '    one', '    three']);
  });

  it('stores only their SHA-256', async () => {
    const key = await captureKey();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await db.prepare('SELECT hash FROM capture_keys').all()).toEqual({ results: [{ hash: hex }] });
  });

  it('cannot be made without a sync space', async () => {
    const res = await sync('POST', 'capture-key', undefined, 'o'.repeat(32));
    expect(res.status).toBe(404);
  });

  it('refuse a missing key, the sync key itself, and other routes', async () => {
    await captureKey();
    expect((await capture(null, { title: 'x' })).status).toBe(401);
    expect((await capture(KEY, { title: 'x' })).status).toBe(401);
    expect((await capture(`alc_${'x'.repeat(43)}`, { title: 'x' })).status).toBe(401);
    const key = await captureKey();
    expect((await capture(key, { title: 'x' }, { method: 'GET' })).status).toBe(404);
    expect(await (await capture(key, { title: 'x' }, { path: '/api/capture/more' })).json()).toEqual({ error: 'not found' });
    // A capture key cannot read or push through the sync API.
    expect((await sync('GET', 'pull?since=0', undefined, key)).status).toBe(404);
    expect(await outline()).toEqual([]);
  });
});

describe('POST /api/capture', () => {
  let key: string;
  beforeEach(async () => {
    key = await captureKey();
  });

  it('makes Work at the top of Home and today under it, with the item and its note', async () => {
    await sync('POST', 'push', { nodes: [wire('later', { content: 'Projects', order: 'a0' }), wire('first', { content: 'Inbox', order: 'Zz' })] });
    const res = await capture(key, { title: 'Fix the login bug', note: '## Done\n\n- one\n- two' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; url: string; path: string[] };
    expect(body.path).toEqual(['Work', '14 Oct', 'Fix the login bug']);
    expect(body.url).toBe(`https://aletheia.test/n/${body.id}`);
    expect(await outline()).toEqual(['Work', '  14 Oct', '    Fix the login bug | ## Done\n\n- one\n- two', 'Inbox', 'Projects']);
    const item = (await nodes()).find((n) => n.id === body.id)!;
    expect(item).toMatchObject({ createdAt: NOW, t: { content: NOW, note: NOW, pos: NOW, collapsed: NOW, starred: NOW, completed: NOW, format: NOW, deleted: NOW } });
  });

  it('uses an existing Work and date, adds items at the end of the day and new days at the top', async () => {
    await sync('POST', 'push', {
      nodes: [
        wire('work', { content: '**work**', order: 'a1' }),
        wire('d14', { parentId: 'work', content: '14 Oct', order: 'a1' }),
        wire('d13', { parentId: 'work', content: '13 Oct', order: 'Zz' }),
        wire('last', { parentId: 'd14', content: 'later', order: 'a2' }),
        wire('old', { parentId: 'd14', content: 'earlier', order: 'a0' }),
        wire('mid', { parentId: 'd14', content: 'middle', order: 'a1' }),
        wire('elsewhere', { content: 'Zebra', order: 'a9' }),
        wire('below', { parentId: 'elsewhere', content: 'first', order: 'Zx' }),
        wire('gone', { parentId: 'd14', content: 'deleted', order: 'a5', deletedAt: NOW - DAY }),
      ],
    });
    await capture(key, { title: 'meeting', date: '14 Oct' });
    await capture(key, { title: 'tomorrow', date: '15 Oct' });
    expect(await outline()).toEqual(['**work**', '  15 Oct', '    tomorrow', '  13 Oct', '  14 Oct', '    earlier', '    middle', '    later', '    meeting', 'Zebra', '  first']);
    const order = Object.fromEntries((await nodes()).map((n) => [n.content, n.order]));
    expect([order.meeting, order['15 Oct'], order.tomorrow]).toEqual(['a3', 'Zy', 'a0']);
    // Nothing was collapsed, so nothing else changed.
    const times = Object.fromEntries((await nodes()).map((n) => [n.id, n.t.collapsed]));
    expect([times.work, times.d14, times.d13]).toEqual([1, 1, 1]);
  });

  it('finds Work nested deeper when Home has none, preferring the shallowest', async () => {
    await sync('POST', 'push', {
      nodes: [
        wire('a', { content: 'Areas', order: 'a0' }),
        wire('b', { parentId: 'a', content: 'Deep', order: 'a0' }),
        wire('deep', { parentId: 'b', content: 'Work', order: 'a0' }),
        wire('newer', { parentId: 'a', content: 'Work', order: 'a2', createdAt: NOW - 1 }),
        wire('shallow', { parentId: 'a', content: 'Work', order: 'a1' }),
        wire('trash', { content: 'Work', order: 'a2', deletedAt: NOW - DAY }),
        // In a cycle: as deep as the others or deeper.
        wire('c1', { parentId: 'c2', content: 'Work', createdAt: NOW - 2 * DAY }),
        wire('c2', { parentId: 'c1', content: 'Loop', createdAt: NOW - 2 * DAY }),
      ],
    });
    await capture(key, { title: 'x' });
    expect(await outline()).toEqual(['Areas', '  Deep', '    Work', '  Work', '    14 Oct', '      x', '  Work']);
  });

  it('counts a Work whose parent is gone as top level, as the app shows it', async () => {
    await sync('POST', 'push', {
      nodes: [wire('a', { content: 'Areas' }), wire('nested', { parentId: 'a', content: 'Work', createdAt: NOW - 2 * DAY }), wire('orphan', { parentId: 'missing', content: 'Work' })],
    });
    await capture(key, { title: 'x' });
    const all = await nodes();
    const day = all.find((n) => n.content === '14 Oct')!;
    expect(day.parentId).toBe('orphan');
  });

  it('opens a collapsed Work and date so the item shows', async () => {
    await sync('POST', 'push', {
      nodes: [
        wire('work', { content: 'Work', collapsed: true, note: 'keep me', starredAt: 5, t: { ...NO_TIMES, content: 1, note: 1, pos: 1, collapsed: 1, starred: 1 } }),
        wire('d14', { parentId: 'work', content: '14 Oct', collapsed: true }),
      ],
    });
    await capture(key, { title: 'x' });
    expect(await outline()).toEqual(['Work | keep me', '  14 Oct', '    x']);
    const work = (await nodes()).find((n) => n.id === 'work')!;
    expect(work).toMatchObject({ content: 'Work', note: 'keep me', starredAt: 5, collapsed: false, t: { content: 1, note: 1, pos: 1, collapsed: NOW, starred: 1 } });
  });

  it('makes a new date rather than reuse last year\'s', async () => {
    await sync('POST', 'push', {
      nodes: [wire('work', { content: 'Work' }), wire('d14', { parentId: 'work', content: '14 Oct', createdAt: NOW - 330 * DAY })],
    });
    await capture(key, { title: 'x' });
    expect(await outline()).toEqual(['Work', '  14 Oct', '    x', '  14 Oct']);
  });

  it('uses the newest of two matching dates', async () => {
    await sync('POST', 'push', {
      nodes: [
        wire('work', { content: 'Work' }),
        wire('older', { parentId: 'work', content: '14 Oct', order: 'a0', createdAt: NOW - 2 * DAY }),
        wire('newer', { parentId: 'work', content: '14 Oct', order: 'a1', createdAt: NOW - DAY }),
        wire('oldest', { parentId: 'work', content: '14 Oct', order: 'a2', createdAt: NOW - 329 * DAY }),
      ],
    });
    await capture(key, { title: 'x' });
    expect(await outline()).toEqual(['Work', '  14 Oct', '  14 Oct', '    x', '  14 Oct']);
  });

  it('names the day in the time zone it is sent, and an explicit date wins', async () => {
    const late = (body: object) =>
      handleCapture(
        new Request('https://aletheia.test/api/capture', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(body) }),
        { DB: db },
        Date.UTC(2026, 9, 14, 22, 30),
      );
    await late({ title: 'utc' });
    await late({ title: 'istanbul', tz: 'Europe/Istanbul' });
    await late({ title: 'given', tz: 'Europe/Istanbul', date: '14 Oct' });
    expect(await outline()).toEqual(['Work', '  15 Oct', '    istanbul', '  14 Oct', '    utc', '    given']);
  });

  it('takes form fields (curl -F) and another section', async () => {
    const form = new FormData();
    form.set('title', '  Plan\n  the  week ');
    form.set('note', 'line 1\r\nline 2\rline 3\n');
    form.set('attachment', new Blob(['ignored']));
    form.set('under', 'Personal');
    form.set('date', '1 Jan');
    const req = new Request('https://aletheia.test/api/capture', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    const res = await handleCapture(req, { DB: db }, NOW);
    expect(res.status).toBe(201);
    expect(await outline()).toEqual(['Personal', '  1 Jan', '    Plan the week | line 1\nline 2\nline 3']);
  });

  it('refuses a body without a title, too long fields, and a body that is not JSON', async () => {
    const error = async (body: unknown, type?: string) => {
      const res = await capture(key, body, type ? { type } : {});
      expect(res.status).toBe(400);
      return ((await res.json()) as { error: string }).error;
    };
    expect(await error({ note: 'just a note' })).toBe('title is required');
    expect(await error({ title: '   ' })).toBe('title is required');
    expect(await error({ title: 5 })).toBe('title is required');
    expect(await error({ title: 'x'.repeat(1001) })).toBe('title must be at most 1000 characters');
    expect(await error({ title: 'x', note: 'x'.repeat(200_001) })).toBe('note must be at most 200000 characters');
    expect(await error({ title: 'x', under: 'x'.repeat(201) })).toBe('under and date must be at most 200 characters');
    expect(await error({ title: 'x', date: 'x'.repeat(201) })).toBe('under and date must be at most 200 characters');
    expect(await error('{oops')).toBe('body must be JSON or form fields');
    expect(await error('null')).toBe('body must be a JSON object');
    expect(await error('5')).toBe('body must be a JSON object');
    await capture(key, { title: 'returns', note: 'a\r\nb\rc' });
    expect((await nodes()).find((n) => n.content === 'returns')!.note).toBe('a\nb\nc');
    expect((await capture(key, { title: 'x'.repeat(1000), note: 'x'.repeat(200_000), under: 'u'.repeat(200), date: 'd'.repeat(200) })).status).toBe(201);
    expect((await outline()).slice(0, 3)).toEqual(['u'.repeat(200), `  ${'d'.repeat(200)}`, `    ${'x'.repeat(1000)} | ${'x'.repeat(200_000)}`]);
  });
});

describe('helpers', () => {
  it('dayName writes the day and short month in the time zone, UTC by default', () => {
    expect(dayName(NOW)).toBe('14 Oct');
    expect(dayName(Date.UTC(2026, 0, 1, 0, 0))).toBe('1 Jan');
    expect(dayName(Date.UTC(2026, 8, 30, 23, 59))).toBe('30 Sep');
    expect(dayName(Date.UTC(2026, 11, 31, 23, 59), 'UTC')).toBe('31 Dec');
    expect(dayName(Date.UTC(2026, 11, 31, 22, 0), 'Europe/Istanbul')).toBe('1 Jan');
    expect(dayName(Date.UTC(2026, 9, 14, 2, 0), 'America/Los_Angeles')).toBe('13 Oct');
    expect(dayName(NOW, 'Not/AZone')).toBe('14 Oct');
    const months = Array.from({ length: 12 }, (_, m) => dayName(Date.UTC(2026, m, 2)));
    expect(months).toEqual(['2 Jan', '2 Feb', '2 Mar', '2 Apr', '2 May', '2 Jun', '2 Jul', '2 Aug', '2 Sep', '2 Oct', '2 Nov', '2 Dec']);
  });

  it('label drops inline marks and link targets, and ignores case and spacing', () => {
    expect(label('  **Work**  ')).toBe('work');
    expect(label('_14_  ~~Oct~~')).toBe('14 oct');
    expect(label('[My `Work`](https://x.test)')).toBe('my work');
    expect(label('a\\*b')).toBe('ab');
  });
});
