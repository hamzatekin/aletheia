/**
 * Sync API. One "space" per sync key; the key never reaches the database,
 * only its SHA-256. The server keeps the newest version of every field group
 * of every node, plus a per-space sequence number that orders the change feed.
 *
 *   POST /api/sync/space   create the space for this key (or confirm it exists)
 *   GET  /api/sync/space   200 if the space exists, 404 if not
 *   POST /api/sync/push    { nodes: WireNode[] } -> { seq }
 *   GET  /api/sync/pull?since=N&limit=M -> { nodes, cursor, more }
 *
 * Every request needs `Authorization: Bearer <sync key>`.
 */
import { GROUPS, type PullResponse, type PushRequest, type ServerNode, type WireNode } from '../src/sync/wire';

/** The slice of Cloudflare's D1 API this file uses (so tests can run it on node:sqlite). */
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<unknown[]>;
}
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface SyncEnv {
  DB: SqlDatabase;
  /** How many sync spaces this deployment accepts. Default 1: the first key to turn sync on owns it. */
  SYNC_MAX_SPACES?: string;
}

export const MAX_PUSH_NODES = 500;
export const MAX_PULL_LIMIT = 500;
const MIN_KEY_LENGTH = 32;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS nodes (
    space TEXT NOT NULL,
    id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    content TEXT NOT NULL, content_t INTEGER NOT NULL,
    note TEXT NOT NULL, note_t INTEGER NOT NULL,
    parent_id TEXT, ord TEXT NOT NULL, pos_t INTEGER NOT NULL,
    collapsed INTEGER NOT NULL, collapsed_t INTEGER NOT NULL,
    deleted_at INTEGER, deleted_t INTEGER NOT NULL,
    PRIMARY KEY (space, id)
  )`,
  `CREATE INDEX IF NOT EXISTS nodes_by_seq ON nodes (space, seq)`,
];

// Each group's columns take the incoming value only when its time is newer.
const pick = (col: string, t: string) => `${col} = CASE WHEN excluded.${t} > nodes.${t} THEN excluded.${col} ELSE nodes.${col} END`;
const UPSERT = `
  INSERT INTO nodes (space, id, seq, created_at, content, content_t, note, note_t,
                     parent_id, ord, pos_t, collapsed, collapsed_t, deleted_at, deleted_t)
  SELECT ?1,
         json_extract(j.value, '$.id'),
         (SELECT seq FROM spaces WHERE id = ?1) - ?2 + j.key + 1,
         json_extract(j.value, '$.createdAt'),
         json_extract(j.value, '$.content'), json_extract(j.value, '$.t.content'),
         json_extract(j.value, '$.note'), json_extract(j.value, '$.t.note'),
         json_extract(j.value, '$.parentId'), json_extract(j.value, '$.order'), json_extract(j.value, '$.t.pos'),
         json_extract(j.value, '$.collapsed'), json_extract(j.value, '$.t.collapsed'),
         json_extract(j.value, '$.deletedAt'), json_extract(j.value, '$.t.deleted')
  FROM json_each(?3) AS j WHERE true
  ON CONFLICT (space, id) DO UPDATE SET
    seq = excluded.seq,
    created_at = min(nodes.created_at, excluded.created_at),
    ${pick('content', 'content_t')}, content_t = max(nodes.content_t, excluded.content_t),
    ${pick('note', 'note_t')}, note_t = max(nodes.note_t, excluded.note_t),
    ${pick('parent_id', 'pos_t')}, ${pick('ord', 'pos_t')}, pos_t = max(nodes.pos_t, excluded.pos_t),
    ${pick('collapsed', 'collapsed_t')}, collapsed_t = max(nodes.collapsed_t, excluded.collapsed_t),
    ${pick('deleted_at', 'deleted_t')}, deleted_t = max(nodes.deleted_t, excluded.deleted_t)`;

let schemaReady: Promise<unknown> | null = null;
function ensureSchema(db: SqlDatabase): Promise<unknown> {
  schemaReady ??= db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e: unknown) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

/** For tests: forget that the schema was created (a fresh database needs it again). */
export function resetSchemaCache(): void {
  schemaReady = null;
}

export async function handleSync(request: Request, env: SyncEnv): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  const key = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!key || key.length < MIN_KEY_LENGTH) return json({ error: 'missing or short sync key' }, 401);
  await ensureSchema(env.DB);
  const space = await sha256(key);

  if (route === 'POST /api/sync/space') return createSpace(env, space);
  const exists = await env.DB.prepare('SELECT 1 AS ok FROM spaces WHERE id = ?1').bind(space).first();
  if (!exists) return json({ error: 'no sync space for this key' }, 404);

  switch (route) {
    case 'GET /api/sync/space':
      return json({ ok: true });
    case 'POST /api/sync/push':
      return push(env, space, request);
    case 'GET /api/sync/pull':
      return pull(env, space, url);
    default:
      return json({ error: 'not found' }, 404);
  }
}

async function createSpace(env: SyncEnv, space: string): Promise<Response> {
  const exists = await env.DB.prepare('SELECT 1 AS ok FROM spaces WHERE id = ?1').bind(space).first();
  if (exists) return json({ created: false });
  const max = Number(env.SYNC_MAX_SPACES ?? '1');
  const count = await env.DB.prepare('SELECT count(*) AS n FROM spaces').first<{ n: number }>();
  if ((count?.n ?? 0) >= max) {
    return json({ error: 'This server already has its sync space. Join it with the link from your other device.' }, 403);
  }
  await env.DB.prepare('INSERT OR IGNORE INTO spaces (id, seq, created_at) VALUES (?1, 0, ?2)').bind(space, Date.now()).run();
  return json({ created: true });
}

async function push(env: SyncEnv, space: string, request: Request): Promise<Response> {
  let body: PushRequest;
  try {
    body = (await request.json()) as PushRequest;
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const nodes = Array.isArray(body?.nodes) ? body.nodes : null;
  if (!nodes || nodes.length > MAX_PUSH_NODES || !nodes.every(validWireNode)) {
    return json({ error: `nodes must be 1-${MAX_PUSH_NODES} valid nodes` }, 400);
  }
  if (nodes.length === 0) return json({ seq: null });
  // One transaction: reserve n sequence numbers, then merge every node.
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE spaces SET seq = seq + ?2 WHERE id = ?1').bind(space, nodes.length),
    env.DB.prepare(UPSERT).bind(space, nodes.length, JSON.stringify(nodes)),
    env.DB.prepare('SELECT seq FROM spaces WHERE id = ?1').bind(space),
  ]);
  const last = results[2] as { results?: { seq: number }[] } | undefined;
  return json({ seq: last?.results?.[0]?.seq ?? null });
}

async function pull(env: SyncEnv, space: string, url: URL): Promise<Response> {
  const since = Math.max(0, Math.floor(Number(url.searchParams.get('since') ?? '0')) || 0);
  const limit = Math.min(MAX_PULL_LIMIT, Math.max(1, Math.floor(Number(url.searchParams.get('limit') ?? MAX_PULL_LIMIT)) || MAX_PULL_LIMIT));
  const { results } = await env.DB.prepare('SELECT * FROM nodes WHERE space = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3')
    .bind(space, since, limit + 1)
    .all<Row>();
  const more = results.length > limit;
  const page = results.slice(0, limit).map(fromRow);
  const response: PullResponse = { nodes: page, cursor: page.length > 0 ? page[page.length - 1]!.seq : since, more };
  return json(response);
}

interface Row {
  id: string;
  seq: number;
  created_at: number;
  content: string;
  content_t: number;
  note: string;
  note_t: number;
  parent_id: string | null;
  ord: string;
  pos_t: number;
  collapsed: number;
  collapsed_t: number;
  deleted_at: number | null;
  deleted_t: number;
}

function fromRow(r: Row): ServerNode {
  return {
    id: r.id,
    seq: r.seq,
    parentId: r.parent_id,
    order: r.ord,
    content: r.content,
    note: r.note,
    collapsed: Boolean(r.collapsed),
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
    t: { content: r.content_t, note: r.note_t, pos: r.pos_t, collapsed: r.collapsed_t, deleted: r.deleted_t },
  };
}

function validWireNode(n: unknown): n is WireNode {
  if (typeof n !== 'object' || n === null) return false;
  const w = n as WireNode;
  return (
    typeof w.id === 'string' &&
    w.id.length > 0 &&
    w.id.length <= 64 &&
    (w.parentId === null || typeof w.parentId === 'string') &&
    typeof w.order === 'string' &&
    typeof w.content === 'string' &&
    typeof w.note === 'string' &&
    typeof w.collapsed === 'boolean' &&
    Number.isFinite(w.createdAt) &&
    (w.deletedAt === null || Number.isFinite(w.deletedAt)) &&
    typeof w.t === 'object' &&
    w.t !== null &&
    GROUPS.every((g) => Number.isFinite(w.t[g]))
  );
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
