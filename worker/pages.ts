/**
 * Web pages sent along with a capture (a work report with charts, say). The
 * item's note links to /p/<id>, an app route that fetches the page here with
 * the sync key and shows it in a sandboxed frame, so only the owner's devices
 * can open it.
 *
 *   GET /api/pages/<id>   -> { title, html, createdAt }
 *
 * Needs `Authorization: Bearer <sync key>`.
 */
import { json } from './http';
import { ownerSpace, randomHex, type SqlDatabase, type SyncEnv } from './sync';

/** D1 keeps rows up to 2 MB; HTML is mostly ASCII. */
export const MAX_PAGE_CHARS = 1_000_000;

export async function handlePages(request: Request, env: SyncEnv): Promise<Response> {
  const id = /^\/api\/pages\/([0-9a-f]{32})$/.exec(new URL(request.url).pathname)?.[1];
  if (request.method !== 'GET' || !id) return json({ error: 'not found' }, 404);
  const space = await ownerSpace(request, env);
  if (!space) return json({ error: 'This page opens only on your devices with sync on.' }, 401);
  const row = await env.DB.prepare('SELECT title, html, created_at FROM pages WHERE id = ?1 AND space = ?2')
    .bind(id, space)
    .first<{ title: string; html: string; created_at: number }>();
  if (!row) return json({ error: 'This page does not exist.' }, 404);
  return json({ title: row.title, html: row.html, createdAt: row.created_at });
}

/** Store a page in the space; returns its id. */
export async function savePage(db: SqlDatabase, space: string, title: string, html: string, now: number): Promise<string> {
  const id = randomHex(16);
  await db.prepare('INSERT INTO pages (id, space, title, html, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, space, title, html, now).run();
  return id;
}
