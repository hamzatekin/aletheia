/**
 * Feed API: a read-only view of the sync space for pergent's morning task,
 * limited to the piles on an allow-list. Nothing outside the list leaves the
 * Worker.
 *
 *   GET /api/feed[?since=<ISO time>]   -> { generatedAt, nodes, deleted? }
 *
 * Needs `Authorization: Bearer <FEED_TOKEN>` (a Worker secret); a missing or
 * wrong token gets 401 with an empty body. `FEED_PILES` (a Worker variable) is
 * a JSON list of pile paths like `["Inbox", "Personal/Fitness"]`. Every pile
 * named in BLOCKED is left out wherever it is, even when listed.
 *
 * The feed reads the sync space (the first one made, which is the owner's
 * with SYNC_MAX_SPACES = 1), so it only has what a device has synced.
 */
import { json } from './http';
import { label } from './capture';
import { ensureSchema, type SyncEnv } from './sync';

export interface FeedEnv extends SyncEnv {
  /** Bearer token pergent sends (a Cloudflare secret). The feed answers 401 to everyone while it is unset. */
  FEED_TOKEN?: string;
  /** JSON list of pile paths to serve, like `["Inbox", "Personal/Fitness"]`. Missing or invalid: nothing is served. */
  FEED_PILES?: string;
}

/** Piles never served, whatever FEED_PILES says (compared like `pileKey`). */
const BLOCKED = new Set(['passwords', 'budget']);

export interface FeedRow {
  id: string;
  parent_id: string | null;
  ord: string;
  content: string;
  note: string;
  created_at: number;
  content_t: number;
  note_t: number;
  pos_t: number;
  deleted_at: number | null;
  deleted_t: number;
}

export interface FeedNode {
  id: string;
  /** null for a pile itself, even one nested in a pile that isn't served. */
  parentId: string | null;
  /** Titles of the ancestors from the pile down; empty for the pile itself. */
  path: string[];
  text: string;
  note: string | null;
  /** Position among the served siblings, from 0. */
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeedResponse {
  generatedAt: string;
  nodes: FeedNode[];
  deleted?: { id: string; deletedAt: string }[];
}

export async function handleFeed(request: Request, env: FeedEnv, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  if (`${request.method} ${url.pathname}` !== 'GET /api/feed') return json({ error: 'not found' }, 404);
  if (!(await tokenMatches(request, env.FEED_TOKEN))) return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  const sinceParam = url.searchParams.get('since');
  const since = sinceParam === null ? null : Date.parse(sinceParam);
  if (since !== null && !Number.isFinite(since)) return json({ error: 'since must be an ISO timestamp' }, 400);

  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare(
    `SELECT id, parent_id, ord, content, note, created_at, content_t, note_t, pos_t, deleted_at, deleted_t FROM nodes
     WHERE space = (SELECT id FROM spaces ORDER BY created_at, id LIMIT 1)`,
  ).all<FeedRow>();
  return json(buildFeed(results, parsePiles(env.FEED_PILES), since, now));
}

/** The feed for `rows`: the live subtrees of the allowed piles, and with `since`, only what changed after it. */
export function buildFeed(rows: FeedRow[], piles: Set<string>, since: number | null, now: number): FeedResponse {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const kids = new Map<string | null, FeedRow[]>();
  for (const r of rows) {
    if (r.deleted_at !== null) continue;
    const list = kids.get(r.parent_id) ?? [];
    list.push(r);
    kids.set(r.parent_id, list);
  }
  const children = (id: string | null) =>
    (kids.get(id) ?? []).filter((r) => !BLOCKED.has(pileKey(r.content))).sort((a, b) => cmp(a.ord, b.ord) || cmp(a.id, b.id));

  const nodes: FeedNode[] = [];
  const emit = (row: FeedRow, order: number, path: string[], isPile: boolean) => {
    const updated = updatedAt(row);
    if (updated > (since ?? -Infinity)) {
      const note = row.note === '' ? null : row.note;
      nodes.push({ id: row.id, parentId: isPile ? null : row.parent_id, path, text: row.content, note, order, createdAt: iso(row.created_at), updatedAt: iso(updated) });
    }
    children(row.id).forEach((kid, i) => emit(kid, i, [...path, row.content], false));
  };
  // Down from the top level until a node's path is an allowed pile.
  const seek = (parentId: string | null, keys: string[]) => {
    children(parentId).forEach((row, i) => {
      const path = [...keys, pileKey(row.content)];
      if (piles.has(path.join('/'))) emit(row, i, [], true);
      else seek(row.id, path);
    });
  };
  seek(null, []);

  const response: FeedResponse = { generatedAt: iso(now), nodes };
  if (since !== null) {
    response.deleted = rows
      .filter((r) => r.deleted_at !== null && r.deleted_t > since && inAllowedPile(r, byId, piles))
      .map((r) => ({ id: r.id, deletedAt: iso(r.deleted_at!) }));
  }
  return response;
}

/** Whether a (deleted) node sits in an allowed pile, judged by its ancestors whether or not they are deleted. */
function inAllowedPile(row: FeedRow, byId: Map<string, FeedRow>, piles: Set<string>): boolean {
  const chain: FeedRow[] = [];
  const seen = new Set<string>();
  // Stryker disable next-line StringLiteral: any id that no node has ends the walk the same way
  for (let n: FeedRow | undefined = row; n && !seen.has(n.id); n = byId.get(n.parent_id ?? '')) {
    seen.add(n.id);
    chain.unshift(n);
  }
  // A chain that doesn't reach the top level (missing parent or a cycle) is in no pile.
  if (chain[0]!.parent_id !== null) return false;
  const keys = chain.map((n) => pileKey(n.content));
  if (keys.some((k) => BLOCKED.has(k))) return false;
  return keys.some((_, i) => piles.has(keys.slice(0, i + 1).join('/')));
}

/** The last change to a node's text, note or place. */
function updatedAt(row: FeedRow): number {
  return Math.max(row.created_at, row.content_t, row.note_t, row.pos_t);
}

/**
 * How a pile name compares: like capture's `label` (Markdown marks dropped, case
 * ignored), with any dash read as "-" and no spaces around "/", so
 * "Personal/Girişimcilik / Yatırım" matches Personal › "Girişimcilik / Yatırım".
 */
export function pileKey(text: string): string {
  return label(text).replace(/[‐-―−]/g, '-').replace(/\s*\/\s*/g, '/');
}

/** FEED_PILES as compared paths; anything that isn't a JSON list of strings serves nothing. */
export function parsePiles(raw: string | undefined): Set<string> {
  let list: unknown;
  try {
    list = JSON.parse(raw ?? '');
  } catch {
    return new Set();
  }
  if (!Array.isArray(list)) return new Set();
  return new Set(list.filter((p): p is string => typeof p === 'string').map(pileKey).filter((p) => p !== ''));
}

/** Whether the request carries FEED_TOKEN. Both are hashed first, so the comparison takes the same time whatever was sent. */
async function tokenMatches(request: Request, expected: string | undefined): Promise<boolean> {
  if (!expected) return false;
  const given = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function iso(time: number): string {
  return new Date(time).toISOString();
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
