/**
 * Capture API: add one item from outside the app (Claude Code's /aletheia
 * skill) under a dated node, e.g. Work › 14 Oct › "Fix login bug" with the
 * answer as its note. The new nodes reach every device through sync.
 *
 *   POST /api/capture   { title, note?, under?, date?, tz?, page? } as JSON or form fields
 *                       -> 201 { id, url, path, page? }
 *
 * Needs `Authorization: Bearer <capture key>` (made in Settings → Sync), a key
 * that can only add nodes, so the machine running Claude Code never holds the
 * sync key. `under` defaults to "Work" and is made at the top of Home when
 * missing; `date` defaults to today ("14 Oct") in the time zone `tz` (like
 * "Europe/Istanbul"; UTC when missing or unknown). A new date goes at the
 * top of `under` (newest first, like the Inbox); items go at the end of their
 * date, in the order they were sent. `page` is a web page (HTML) stored with
 * the item (worker/pages.ts); the note then starts with a link to it.
 */
import { generateKeyBetween } from 'fractional-indexing';
import { v7 } from 'uuid';
import { NO_TIMES, type WireNode } from '../src/sync/wire';
import { json } from './http';
import { MAX_PAGE_CHARS, savePage } from './pages';
import { captureSpace, mergeNodes, type SyncEnv } from './sync';

const MAX_TITLE_CHARS = 1_000;
const MAX_NOTE_CHARS = 200_000;
const MAX_NAME_CHARS = 200;
/** A date node older than this is last year's "14 Oct", not today's. */
const DATE_REUSE_MS = 330 * 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface CaptureRequest {
  title: string;
  note: string;
  under: string;
  date: string;
  page: string;
}

interface LiveRow {
  id: string;
  parent_id: string | null;
  ord: string;
  content: string;
  collapsed: number;
  created_at: number;
}

export async function handleCapture(request: Request, env: SyncEnv, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  if (`${request.method} ${url.pathname}` !== 'POST /api/capture') return json({ error: 'not found' }, 404);
  const space = await captureSpace(request, env);
  if (!space) return json({ error: 'Unknown capture key. Make a new one in Aletheia: Settings → Sync → Claude Code.' }, 401);

  const parsed = await readRequest(request, now);
  if (typeof parsed === 'string') return json({ error: parsed }, 400);
  const { title, under, date, page } = parsed;
  // The page first, so the note never links to a page that isn't there.
  const pageId = page ? await savePage(env.DB, space, title, page, now) : null;
  const note = pageId ? `[Open the page](/p/${pageId})${parsed.note ? `\n\n${parsed.note}` : ''}` : parsed.note;

  const { results } = await env.DB.prepare('SELECT id, parent_id, ord, content, collapsed, created_at FROM nodes WHERE space = ?1 AND deleted_at IS NULL')
    .bind(space)
    .all<LiveRow>();
  const byId = new Map(results.map((r) => [r.id, r]));
  const children = (parentId: string | null) => results.filter((r) => r.parent_id === parentId);
  // Sibling order keys, sorted. Only their values matter here, so equal keys need no tiebreak.
  const orders = (parentId: string | null) => children(parentId).map((r) => r.ord).sort();
  const writes: WireNode[] = [];

  const section = findSection(results, byId, under);
  let parentId: string;
  if (!section) {
    const node = newNode(null, generateKeyBetween(null, orders(null)[0] ?? null), under, '', now);
    writes.push(node);
    parentId = node.id;
  } else {
    if (section.collapsed) writes.push(expanded(section, now));
    parentId = section.id;
  }

  const day = children(parentId)
    .filter((r) => label(r.content) === label(date) && r.created_at > now - DATE_REUSE_MS)
    .sort((a, b) => b.created_at - a.created_at)[0];
  let dayId: string;
  if (!day) {
    const node = newNode(parentId, generateKeyBetween(null, orders(parentId)[0] ?? null), date, '', now);
    writes.push(node);
    dayId = node.id;
  } else {
    if (day.collapsed) writes.push(expanded(day, now));
    dayId = day.id;
  }

  const item = newNode(dayId, generateKeyBetween(orders(dayId).at(-1) ?? null, null), title, note, now);
  writes.push(item);
  await mergeNodes(env.DB, space, writes);
  const pageUrl = pageId ? { page: `${url.origin}/p/${pageId}` } : {};
  return json({ id: item.id, url: `${url.origin}/n/${item.id}`, path: [under, date, title], ...pageUrl }, 201);
}

/** The request's fields, cleaned, or what is wrong with them. */
async function readRequest(request: Request, now: number): Promise<CaptureRequest | string> {
  let fields: Record<string, unknown>;
  try {
    const type = request.headers.get('Content-Type') ?? '';
    if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
      fields = Object.fromEntries(await request.formData());
    } else {
      fields = (await request.json()) as Record<string, unknown>;
      if (typeof fields !== 'object' || fields === null) return 'body must be a JSON object';
    }
  } catch {
    return 'body must be JSON or form fields';
  }
  const text = (key: string) => (typeof fields[key] === 'string' ? fields[key] : '');
  const line = (key: string) => text(key).replace(/\s+/g, ' ').trim();
  const title = line('title');
  const note = text('note').replace(/\r\n?/g, '\n').trim();
  const under = line('under') || 'Work';
  const date = line('date') || dayName(now, line('tz'));
  const page = text('page').trim();
  if (title === '') return 'title is required';
  if (title.length > MAX_TITLE_CHARS) return `title must be at most ${MAX_TITLE_CHARS} characters`;
  if (note.length > MAX_NOTE_CHARS) return `note must be at most ${MAX_NOTE_CHARS} characters`;
  if (under.length > MAX_NAME_CHARS || date.length > MAX_NAME_CHARS) return `under and date must be at most ${MAX_NAME_CHARS} characters`;
  if (page.length > MAX_PAGE_CHARS) return `page must be at most ${MAX_PAGE_CHARS} characters`;
  return { title, note, under, date, page };
}

/** "14 Oct" for the day `time` falls on in time zone `tz` (UTC when empty or unknown). */
export function dayName(time: number, tz = ''): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', day: 'numeric', month: 'numeric' }).formatToParts(time);
  } catch {
    return dayName(time);
  }
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return `${part('day')} ${MONTHS[part('month') - 1]}`;
}

/** How a row's name compares: inline Markdown marks dropped, spaces collapsed, case ignored. */
export function label(content: string): string {
  return content
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The live node called `name`: the one nearest the top of the tree, then the oldest. */
function findSection(rows: LiveRow[], byId: Map<string, LiveRow>, name: string): LiveRow | undefined {
  const depth = (row: LiveRow) => {
    // Live ancestors, up to a missing parent (the app's tree repair moves such nodes to Home) or a cycle.
    const seen = new Set<string>();
    for (let n = byId.get(row.parent_id ?? ''); n && !seen.has(n.id); n = byId.get(n.parent_id ?? '')) seen.add(n.id);
    return seen.size;
  };
  return rows
    .filter((r) => label(r.content) === label(name))
    .map((r) => ({ r, d: depth(r) }))
    .sort((a, b) => a.d - b.d || a.r.created_at - b.r.created_at)[0]?.r;
}

/** A new node; every field group is new, so each wins over nothing. */
function newNode(parentId: string | null, order: string, content: string, note: string, now: number): WireNode {
  return {
    id: v7(),
    parentId,
    order,
    content,
    note,
    collapsed: false,
    starredAt: null,
    completedAt: null,
    heading: null,
    color: null,
    createdAt: now,
    deletedAt: null,
    t: { content: now, note: now, pos: now, collapsed: now, starred: now, completed: now, format: now, deleted: now },
  };
}

/** Only the "collapsed" group changes (to open); every other field keeps the server's newer value. */
function expanded(row: LiveRow, now: number): WireNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    order: row.ord,
    content: row.content,
    // Stryker disable next-line StringLiteral: the note's time is 0, so the server keeps its own note whatever this is
    note: '',
    collapsed: false,
    starredAt: null,
    createdAt: row.created_at,
    deletedAt: null,
    t: { ...NO_TIMES, collapsed: now },
  };
}
