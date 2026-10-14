/**
 * Pages sent with a capture (Claude Code's /aletheia skill): stored by the
 * Worker (worker/pages.ts), linked from the item's note as /p/<id>, and
 * fetched with the sync key, so only this user's synced devices can open them.
 */

export interface SentPage {
  title: string;
  html: string;
}

/** Fetch a page; throws with the server's message when it can't be opened. */
export async function fetchPage(syncKey: string, id: string, fetchFn: typeof fetch = (...args) => fetch(...args)): Promise<SentPage> {
  const res = await fetchFn(`/api/pages/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${syncKey}` } });
  let body: Partial<SentPage> & { error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // not JSON; handled below
  }
  if (!res.ok || typeof body.html !== 'string') throw new Error(body.error ?? `Could not open the page (${res.status}).`);
  return { title: body.title ?? '', html: body.html };
}
