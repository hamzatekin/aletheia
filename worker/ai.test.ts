import { beforeEach, describe, expect, it } from 'vitest';
import { handleAi, type AiEnv } from './ai';
import { handleSync, resetSchemaCache, type SqlDatabase } from './sync';
import { sqliteD1 } from './testing/sqlite-d1';

const OWNER = 'a'.repeat(43);
const STRANGER = 'b'.repeat(43);

let db: SqlDatabase;
beforeEach(async () => {
  resetSchemaCache();
  db = sqliteD1();
  const req = new Request('https://aletheia.test/api/sync/space', { method: 'POST', headers: { Authorization: `Bearer ${OWNER}` } });
  await handleSync(req, { DB: db });
});

interface Sent {
  url: string;
  auth: string | null;
  body: unknown;
}

/** A relay that records what it was sent and answers with `reply`. */
function relay(reply: () => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const req = new Request(String(input), init);
    sent.push({ url: req.url, auth: req.headers.get('authorization'), body: await req.json() });
    return reply();
  };
  return { sent, fetchFn };
}

function ask(key: string | null, body: unknown = { prompt: 'Suggest a title' }, env: Partial<AiEnv> = {}, fetchFn?: typeof fetch) {
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  const req = new Request('https://aletheia.test/api/ai/complete', { method: 'POST', headers, body: JSON.stringify(body) });
  return handleAi(req, { DB: db, CLAUDE_RELAY_TOKEN: 'relay-secret', ...env }, fetchFn);
}

describe('AI proxy', () => {
  it('forwards the prompt with the relay token and returns the text', async () => {
    const r = relay(() => Response.json({ text: 'Groceries', model: 'm', duration_ms: 1200, usage: {} }));
    const res = await ask(OWNER, { prompt: 'Suggest a title' }, {}, r.fetchFn);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Groceries', model: 'm', durationMs: 1200 });
    expect(r.sent).toEqual([{ url: 'https://ai.hamzatekin.dev/v1/complete', auth: 'Bearer relay-secret', body: { prompt: 'Suggest a title' } }]);
  });

  it('only answers the sync space owner', async () => {
    const r = relay(() => Response.json({ text: 'x' }));
    expect((await ask(null, undefined, {}, r.fetchFn)).status).toBe(401);
    expect((await ask('short', undefined, {}, r.fetchFn)).status).toBe(401);
    expect((await ask(STRANGER, undefined, {}, r.fetchFn)).status).toBe(401);
    expect(r.sent).toHaveLength(0);
  });

  it('says clearly when the relay token is not set', async () => {
    const res = await ask(OWNER, undefined, { CLAUDE_RELAY_TOKEN: '' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/CLAUDE_RELAY_TOKEN/);
  });

  it('rejects a missing or huge prompt', async () => {
    const r = relay(() => Response.json({ text: 'x' }));
    expect((await ask(OWNER, {}, {}, r.fetchFn)).status).toBe(400);
    expect((await ask(OWNER, { prompt: 'x'.repeat(100_001) }, {}, r.fetchFn)).status).toBe(413);
    expect(r.sent).toHaveLength(0);
  });

  it('turns relay failures into readable errors', async () => {
    const error = async (reply: () => Response | Promise<Response>) => {
      const res = await ask(OWNER, undefined, {}, relay(reply).fetchFn);
      return { status: res.status, error: ((await res.json()) as { error: string }).error };
    };
    expect(await error(() => Response.json({ error: 'claude exited 1' }, { status: 500 }))).toEqual({ status: 502, error: 'AI failed: claude exited 1' });
    expect((await error(() => new Response('Bad gateway', { status: 502 }))).error).toBe('AI is unavailable right now (relay 502).');
    expect((await error(() => Response.json({ error: 'bad token' }, { status: 401 }))).error).toMatch(/CLAUDE_RELAY_TOKEN/);
    expect(await error(() => Promise.reject(new TypeError('fetch failed')))).toEqual({ status: 502, error: 'AI is unavailable right now.' });
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(await error(() => Promise.reject(timeout))).toEqual({ status: 504, error: 'AI took too long to answer.' });
  });
});
