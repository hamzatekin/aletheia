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

const waits: number[] = [];
beforeEach(() => {
  waits.length = 0;
});

function ask(key: string | null, body: unknown = { prompt: 'Suggest a title' }, env: Partial<AiEnv> = {}, fetchFn?: typeof fetch) {
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  const req = new Request('https://aletheia.test/api/ai/complete', { method: 'POST', headers, body: JSON.stringify(body) });
  return handleAi(req, { DB: db, CLAUDE_RELAY_TOKEN: 'relay-secret', ...env }, fetchFn, async (ms) => void waits.push(ms));
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

  it('fails when the relay has no chat endpoint', async () => {
    const r = relay(() => new Response('Not found', { status: 404 }));
    const res = await ask(OWNER, { prompt: 'Start', session: null }, {}, r.fetchFn);
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 502, body: { error: 'AI is unavailable right now (relay 404).' } });
    expect(r.sent.map((s) => s.url)).toEqual(['https://ai.hamzatekin.dev/v1/chat']);
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

  it('sends the system prompt only when a session starts', async () => {
    const r = relay(() => Response.json({ text: 'x', session: 's1' }));
    await ask(OWNER, { prompt: 'Start', session: null, system: 'Reply in JSON' }, {}, r.fetchFn);
    await ask(OWNER, { prompt: 'Next', session: 's1', system: 'Reply in JSON' }, {}, r.fetchFn);
    expect(r.sent.map((s) => s.body)).toEqual([
      { session: null, prompt: 'Start', system: 'Reply in JSON' },
      { session: 's1', prompt: 'Next' },
    ]);
    expect((await ask(OWNER, { prompt: 'Start', session: null, system: 7 }, {}, r.fetchFn)).status).toBe(400);
    expect((await ask(OWNER, { prompt: 'Start', session: null, system: 'x'.repeat(20_001) }, {}, r.fetchFn)).status).toBe(400);
    expect(r.sent).toHaveLength(2);
  });

  it('sends a json_schema only when a session starts, and passes on the structured reply', async () => {
    const schema = { type: 'object', properties: { answer: { type: 'string' } } };
    const r = relay(() => Response.json({ text: 'x', session: 's1', structured: { answer: 'Hi' } }));
    const res = await ask(OWNER, { prompt: 'Start', session: null, system: 'Rules', json_schema: schema }, {}, r.fetchFn);
    expect(await res.json()).toEqual({ text: 'x', model: null, durationMs: null, session: 's1', structured: { answer: 'Hi' } });
    await ask(OWNER, { prompt: 'Next', session: 's1', json_schema: schema }, {}, r.fetchFn);
    expect(r.sent.map((s) => s.body)).toEqual([
      { session: null, prompt: 'Start', system: 'Rules', json_schema: schema },
      { session: 's1', prompt: 'Next' },
    ]);
    expect((await ask(OWNER, { prompt: 'Start', session: null, json_schema: 'x' }, {}, r.fetchFn)).status).toBe(400);
    expect((await ask(OWNER, { prompt: 'Start', session: null, json_schema: [] }, {}, r.fetchFn)).status).toBe(400);
    expect((await ask(OWNER, { prompt: 'Start', session: null, json_schema: null }, {}, r.fetchFn)).status).toBe(400);
    expect((await ask(OWNER, { prompt: 'Start', session: null, json_schema: { d: 'x'.repeat(20_000) } }, {}, r.fetchFn)).status).toBe(400);
    expect(r.sent).toHaveLength(2);
  });

  it('waits and tries again while every relay session is busy', async () => {
    const busy = () => Response.json({ error: 'too many chat sessions' }, { status: 503 });
    const r = relay(() => (r.sent.length < 3 ? busy() : Response.json({ text: 'ok', session: 's1' })));
    const res = await ask(OWNER, { prompt: 'Start', session: null }, {}, r.fetchFn);
    expect(await res.json()).toEqual({ text: 'ok', model: null, durationMs: null, session: 's1' });
    expect(waits).toEqual([1_500, 3_000]);

    waits.length = 0;
    const always = relay(busy);
    const gaveUp = await ask(OWNER, { prompt: 'Start', session: null }, {}, always.fetchFn);
    expect({ status: gaveUp.status, body: await gaveUp.json() }).toEqual({ status: 503, body: { error: 'AI is busy with other chats. Try again in a moment.' } });
    expect(always.sent).toHaveLength(3);
    // A plain completion doesn't wait: a 503 there means the relay is down.
    const plain = await ask(OWNER, undefined, {}, relay(busy).fetchFn);
    expect({ status: plain.status, body: await plain.json() }).toEqual({ status: 502, body: { error: 'AI failed: too many chat sessions' } });
  });
});
