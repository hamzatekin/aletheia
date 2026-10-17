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

  it('sends a session step to the relay chat endpoint and returns the session', async () => {
    const r = relay(() => Response.json({ text: '{"read":[]}', model: 'm', duration_ms: 300, session: 's1' }));
    const first = await ask(OWNER, { prompt: 'Start', session: null }, {}, r.fetchFn);
    expect(await first.json()).toEqual({ text: '{"read":[]}', model: 'm', durationMs: 300, session: 's1' });
    await ask(OWNER, { prompt: 'Next', session: 's1' }, {}, r.fetchFn);
    expect(r.sent).toEqual([
      { url: 'https://ai.hamzatekin.dev/v1/chat', auth: 'Bearer relay-secret', body: { session: null, prompt: 'Start' } },
      { url: 'https://ai.hamzatekin.dev/v1/chat', auth: 'Bearer relay-secret', body: { session: 's1', prompt: 'Next' } },
    ]);
  });

  it('falls back to a plain completion when the relay has no chat endpoint', async () => {
    const r = relay(() => {
      const last = r.sent[r.sent.length - 1]!;
      return last.url.endsWith('/v1/chat') ? new Response('Not found', { status: 404 }) : Response.json({ text: 'Answer' });
    });
    const res = await ask(OWNER, { prompt: 'Start', session: null }, {}, r.fetchFn);
    expect(await res.json()).toEqual({ text: 'Answer', model: null, durationMs: null, session: null });
    expect(r.sent.map((s) => s.url)).toEqual(['https://ai.hamzatekin.dev/v1/chat', 'https://ai.hamzatekin.dev/v1/complete']);
    const later = await ask(OWNER, { prompt: 'Next', session: 's1' }, {}, r.fetchFn);
    expect(later.status).toBe(410);
  });

  it('passes on an expired or busy session', async () => {
    const expired = await ask(OWNER, { prompt: 'Next', session: 's1' }, {}, relay(() => Response.json({ error: 'session expired' }, { status: 410 })).fetchFn);
    expect({ status: expired.status, body: await expired.json() }).toEqual({ status: 410, body: { error: 'session expired' } });
    const busy = await ask(OWNER, { prompt: 'Next', session: 's1' }, {}, relay(() => Response.json({ error: 'session busy' }, { status: 409 })).fetchFn);
    expect({ status: busy.status, body: await busy.json() }).toEqual({ status: 409, body: { error: 'AI is still answering the last step.' } });
  });

  it('uses the configured chat URL and rejects a bad session', async () => {
    const r = relay(() => Response.json({ text: 'x', session: 's2' }));
    await ask(OWNER, { prompt: 'Start', session: null }, { CLAUDE_RELAY_CHAT_URL: 'https://relay.test/chat' }, r.fetchFn);
    expect(r.sent[0]!.url).toBe('https://relay.test/chat');
    expect((await ask(OWNER, { prompt: 'Start', session: 5 }, {}, r.fetchFn)).status).toBe(400);
    expect((await ask(OWNER, { prompt: 'Start', session: '' }, {}, r.fetchFn)).status).toBe(400);
    expect(r.sent).toHaveLength(1);
  });
});
