/**
 * Sync API. One "space" per sync key; the key never reaches the database,
 * only its SHA-256. The server keeps the newest version of every field group
 * of every node, plus a per-space sequence number that orders the change feed.
 *
 *   POST /api/sync/space   create the space for this key (or confirm it exists)
 *   GET  /api/sync/space   200 if the space exists, 404 if not
 *   POST /api/sync/push    { nodes: WireNode[] } -> { seq, rejected: ids }
 *   GET  /api/sync/pull?since=N&limit=M -> { nodes, cursor, more }
 *   POST /api/sync/capture-key   -> { key }: a new key for /api/capture (worker/capture.ts),
 *                                   replacing this space's old one
 *
 * Every request needs `Authorization: Bearer <sync key>`.
 */
import { COLORS, HEADINGS } from '../src/model/node';
import { GROUPS, LATER_GROUPS, type PullResponse, type PushRequest, type PushResponse, type ServerNode, type WireNode } from '../src/sync/wire';
import { json } from './http';

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

const MAX_PUSH_NODES = 500;
/** How far ahead of the server's clock a change time may be. Later times are pulled back to this. */
export const MAX_FUTURE_MS = 60_000;
const MAX_PULL_LIMIT = 500;
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
    starred_at INTEGER, starred_t INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER, completed_t INTEGER NOT NULL DEFAULT 0,
    heading INTEGER, color TEXT, format_t INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (space, id)
  )`,
  `CREATE INDEX IF NOT EXISTS nodes_by_seq ON nodes (space, seq)`,
  // Keys that may only add nodes (Claude Code's /aletheia skill). Only their SHA-256 is kept.
  `CREATE TABLE IF NOT EXISTS capture_keys (
    hash TEXT PRIMARY KEY,
    space TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  // Web pages sent with a capture (worker/pages.ts), opened from a link in the item's note.
  `CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    space TEXT NOT NULL,
    title TEXT NOT NULL,
    html TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
];

/** Columns added after the first release, for databases created before them. */
const ADDED_COLUMNS = [
  { name: 'starred_at', sql: 'ALTER TABLE nodes ADD COLUMN starred_at INTEGER' },
  { name: 'starred_t', sql: 'ALTER TABLE nodes ADD COLUMN starred_t INTEGER NOT NULL DEFAULT 0' },
  { name: 'completed_at', sql: 'ALTER TABLE nodes ADD COLUMN completed_at INTEGER' },
  { name: 'completed_t', sql: 'ALTER TABLE nodes ADD COLUMN completed_t INTEGER NOT NULL DEFAULT 0' },
  { name: 'heading', sql: 'ALTER TABLE nodes ADD COLUMN heading INTEGER' },
  { name: 'color', sql: 'ALTER TABLE nodes ADD COLUMN color TEXT' },
  { name: 'format_t', sql: 'ALTER TABLE nodes ADD COLUMN format_t INTEGER NOT NULL DEFAULT 0' },
];

// Each group's columns take the incoming value only when its time is newer.
const pick = (col: string, t: string) => `${col} = CASE WHEN excluded.${t} > nodes.${t} THEN excluded.${col} ELSE nodes.${col} END`;
const UPSERT = `
  INSERT INTO nodes (space, id, seq, created_at, content, content_t, note, note_t,
                     parent_id, ord, pos_t, collapsed, collapsed_t, deleted_at, deleted_t, starred_at, starred_t,
                     completed_at, completed_t, heading, color, format_t)
  SELECT ?1,
         json_extract(j.value, '$.id'),
         (SELECT seq FROM spaces WHERE id = ?1) - ?2 + j.key + 1,
         json_extract(j.value, '$.createdAt'),
         json_extract(j.value, '$.content'), json_extract(j.value, '$.t.content'),
         json_extract(j.value, '$.note'), json_extract(j.value, '$.t.note'),
         json_extract(j.value, '$.parentId'), json_extract(j.value, '$.order'), json_extract(j.value, '$.t.pos'),
         json_extract(j.value, '$.collapsed'), json_extract(j.value, '$.t.collapsed'),
         json_extract(j.value, '$.deletedAt'), json_extract(j.value, '$.t.deleted'),
         json_extract(j.value, '$.starredAt'), coalesce(json_extract(j.value, '$.t.starred'), 0),
         json_extract(j.value, '$.completedAt'), coalesce(json_extract(j.value, '$.t.completed'), 0),
         json_extract(j.value, '$.heading'), json_extract(j.value, '$.color'), coalesce(json_extract(j.value, '$.t.format'), 0)
  FROM json_each(?3) AS j WHERE true
  ON CONFLICT (space, id) DO UPDATE SET
    seq = excluded.seq,
    created_at = min(nodes.created_at, excluded.created_at),
    ${pick('content', 'content_t')}, content_t = max(nodes.content_t, excluded.content_t),
    ${pick('note', 'note_t')}, note_t = max(nodes.note_t, excluded.note_t),
    ${pick('parent_id', 'pos_t')}, ${pick('ord', 'pos_t')}, pos_t = max(nodes.pos_t, excluded.pos_t),
    ${pick('collapsed', 'collapsed_t')}, collapsed_t = max(nodes.collapsed_t, excluded.collapsed_t),
    ${pick('deleted_at', 'deleted_t')}, deleted_t = max(nodes.deleted_t, excluded.deleted_t),
    ${pick('starred_at', 'starred_t')}, starred_t = max(nodes.starred_t, excluded.starred_t),
    ${pick('completed_at', 'completed_t')}, completed_t = max(nodes.completed_t, excluded.completed_t),
    ${pick('heading', 'format_t')}, ${pick('color', 'format_t')}, format_t = max(nodes.format_t, excluded.format_t)`;

let schemaReady: Promise<unknown> | null = null;
export function ensureSchema(db: SqlDatabase): Promise<unknown> {
  schemaReady ??= db
    .batch(SCHEMA.map((s) => db.prepare(s)))
    .then(async () => {
      const { results } = await db.prepare('PRAGMA table_info(nodes)').all<{ name: string }>();
      const have = new Set(results.map((c) => c.name));
      const missing = ADDED_COLUMNS.filter((c) => !have.has(c.name));
      if (missing.length > 0) await db.batch(missing.map((c) => db.prepare(c.sql)));
    })
    .catch((e: unknown) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

/** For tests: forget that the schema was created (a fresh database needs it again). */
export function resetSchemaCache(): void {
  schemaReady = null;
}

/** The request's sync key (`Authorization: Bearer <key>`), or null when it is missing or too short. */
function bearerKey(request: Request): string | null {
  const key = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  return key && key.length >= MIN_KEY_LENGTH ? key : null;
}

/** Whether the request carries the key of an existing sync space (how other APIs know it is the owner). */
export async function hasSyncSpace(request: Request, env: SyncEnv): Promise<boolean> {
  return (await ownerSpace(request, env)) !== null;
}

/** The existing sync space whose key the request carries, or null. */
export async function ownerSpace(request: Request, env: SyncEnv): Promise<string | null> {
  const space = await requestSpace(request, env);
  return space !== null && (await spaceExists(env.DB, space)) ? space : null;
}

/** The space id (hash of the request's sync key), with the schema ready; null when the key is missing or short. */
async function requestSpace(request: Request, env: SyncEnv): Promise<string | null> {
  const key = bearerKey(request);
  if (!key) return null;
  await ensureSchema(env.DB);
  return sha256(key);
}

async function spaceExists(db: SqlDatabase, space: string): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS ok FROM spaces WHERE id = ?1').bind(space).first()) !== null;
}

export async function handleSync(request: Request, env: SyncEnv): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  const space = await requestSpace(request, env);
  if (!space) return json({ error: 'missing or short sync key' }, 401);

  if (route === 'POST /api/sync/space') return createSpace(env, space);
  if (!(await spaceExists(env.DB, space))) return json({ error: 'no sync space for this key' }, 404);

  switch (route) {
    case 'GET /api/sync/space':
      return json({ ok: true });
    case 'POST /api/sync/push':
      return push(env, space, request);
    case 'GET /api/sync/pull':
      return pull(env, space, url);
    case 'POST /api/sync/capture-key':
      return createCaptureKey(env, space);
    default:
      return json({ error: 'not found' }, 404);
  }
}

async function createSpace(env: SyncEnv, space: string): Promise<Response> {
  if (await spaceExists(env.DB, space)) return json({ created: false });
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
  const all: unknown[] | null = Array.isArray(body?.nodes) ? body.nodes : null;
  if (!all || all.length > MAX_PUSH_NODES) return json({ error: `nodes must be a list of at most ${MAX_PUSH_NODES}` }, 400);
  // Skip invalid nodes rather than refusing the batch: one bad node must not block every later upload.
  const rejected: string[] = [];
  const limit = Date.now() + MAX_FUTURE_MS;
  const nodes: WireNode[] = [];
  for (const n of all) {
    if (validWireNode(n)) nodes.push(capTimes(n, limit));
    else rejected.push(typeof (n as { id?: unknown })?.id === 'string' ? (n as { id: string }).id : '');
  }
  if (nodes.length === 0) return json({ seq: null, rejected } satisfies PushResponse);
  return json({ seq: await mergeNodes(env.DB, space, nodes), rejected } satisfies PushResponse);
}

/** Merge valid nodes into the space in one transaction; returns the space's new sequence number. */
export async function mergeNodes(db: SqlDatabase, space: string, nodes: WireNode[]): Promise<number | null> {
  // Reserve n sequence numbers, then merge every node.
  const results = await db.batch([
    db.prepare('UPDATE spaces SET seq = seq + ?2 WHERE id = ?1').bind(space, nodes.length),
    db.prepare(UPSERT).bind(space, nodes.length, JSON.stringify(nodes)),
    db.prepare('SELECT seq FROM spaces WHERE id = ?1').bind(space),
  ]);
  const last = results[2] as { results?: { seq: number }[] } | undefined;
  return last?.results?.[0]?.seq ?? null;
}

/** Prefix of capture keys, so one pasted in the wrong place is recognizable. */
const CAPTURE_KEY_PREFIX = 'alc_';

async function createCaptureKey(env: SyncEnv, space: string): Promise<Response> {
  const key = CAPTURE_KEY_PREFIX + randomHex(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM capture_keys WHERE space = ?1').bind(space),
    env.DB.prepare('INSERT INTO capture_keys (hash, space, created_at) VALUES (?1, ?2, ?3)').bind(await sha256(key), space, Date.now()),
  ]);
  return json({ key });
}

/** The space a capture key (`Authorization: Bearer alc_...`) belongs to, or null. */
export async function captureSpace(request: Request, env: SyncEnv): Promise<string | null> {
  const key = bearerKey(request);
  // Stryker disable next-line ConditionalExpression: without it a missing key is hashed as "null", which matches no stored key either
  if (!key) return null;
  await ensureSchema(env.DB);
  const row = await env.DB.prepare('SELECT space FROM capture_keys WHERE hash = ?1').bind(await sha256(key)).first<{ space: string }>();
  return row && (await spaceExists(env.DB, row.space)) ? row.space : null;
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
  starred_at: number | null;
  starred_t: number;
  completed_at: number | null;
  completed_t: number;
  heading: number | null;
  color: string | null;
  format_t: number;
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
    starredAt: r.starred_at,
    completedAt: r.completed_at,
    heading: r.heading,
    color: r.color,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
    t: { content: r.content_t, note: r.note_t, pos: r.pos_t, collapsed: r.collapsed_t, starred: r.starred_t, completed: r.completed_t, format: r.format_t, deleted: r.deleted_t },
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
    (w.starredAt === undefined || w.starredAt === null || Number.isFinite(w.starredAt)) &&
    (w.completedAt === undefined || w.completedAt === null || Number.isFinite(w.completedAt)) &&
    (w.heading === undefined || w.heading === null || (HEADINGS as readonly number[]).includes(w.heading)) &&
    (w.color === undefined || w.color === null || (COLORS as readonly string[]).includes(w.color)) &&
    typeof w.t === 'object' &&
    w.t !== null &&
    // Clients from before a group existed send no time for it; that group then never wins.
    GROUPS.every((g) => Number.isFinite(w.t[g]) || (LATER_GROUPS.includes(g) && w.t[g] === undefined))
  );
}

/** Pull change times that are ahead of the server's clock back to `limit`, so a fast device clock cannot win for ever. */
function capTimes(n: WireNode, limit: number): WireNode {
  const t = { ...n.t };
  for (const g of GROUPS) if (t[g] !== undefined && t[g] > limit) t[g] = limit;
  return { ...n, t };
}

async function sha256(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/** `bytes` random bytes as hex. */
export function randomHex(bytes: number): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
