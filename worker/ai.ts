/**
 * AI API: a thin proxy to Avvos's Claude relay, so the relay token stays on
 * the server. The site is public, so only a device with a sync key (the
 * owner's) may call it.
 *
 *   POST /api/ai/complete   { prompt } -> { text, model, durationMs } or { error }
 *
 * Needs `Authorization: Bearer <sync key>` and the CLAUDE_RELAY_TOKEN secret.
 */
import { hasSyncSpace, type SyncEnv } from './sync';

export interface AiEnv extends SyncEnv {
  /** Bearer token for the relay (a Cloudflare secret: `wrangler secret put CLAUDE_RELAY_TOKEN`). */
  CLAUDE_RELAY_TOKEN?: string;
  /** Relay endpoint; defaults to DEFAULT_RELAY_URL. */
  CLAUDE_RELAY_URL?: string;
}

const DEFAULT_RELAY_URL = 'https://ai.hamzatekin.dev/v1/complete';
/** `claude -p` can take a while on a long prompt; give up before the browser does. */
export const RELAY_TIMEOUT_MS = 90_000;
const MAX_PROMPT_CHARS = 100_000;

interface RelayReply {
  text?: string;
  model?: string;
  duration_ms?: number;
  error?: string;
}

export async function handleAi(request: Request, env: AiEnv, fetchFn: typeof fetch = fetch): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (`${request.method} ${pathname}` !== 'POST /api/ai/complete') return json({ error: 'not found' }, 404);
  if (!(await hasSyncSpace(request, env))) return json({ error: 'AI needs sync to be on for this device.' }, 401);
  if (!env.CLAUDE_RELAY_TOKEN) return json({ error: 'AI is not set up on this server (the CLAUDE_RELAY_TOKEN secret is missing).' }, 503);

  let prompt: unknown;
  try {
    prompt = ((await request.json()) as { prompt?: unknown }).prompt;
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') return json({ error: 'prompt is required' }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'That is too much text to send to AI.' }, 413);

  let res: Response;
  try {
    res = await fetchFn(env.CLAUDE_RELAY_URL || DEFAULT_RELAY_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CLAUDE_RELAY_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    console.error('relay unreachable', error);
    return json({ error: timedOut ? 'AI took too long to answer.' : 'AI is unavailable right now.' }, timedOut ? 504 : 502);
  }

  let reply: RelayReply | null = null;
  try {
    reply = (await res.json()) as RelayReply;
  } catch {
    // not JSON (a proxy error page); handled below
  }
  if (res.status === 401 || res.status === 403) {
    console.error('relay rejected the token', res.status);
    return json({ error: 'The AI relay rejected this server (check CLAUDE_RELAY_TOKEN).' }, 502);
  }
  if (!res.ok || !reply || reply.error || typeof reply.text !== 'string') {
    console.error('relay failed', res.status, reply?.error);
    return json({ error: reply?.error ? `AI failed: ${reply.error}` : `AI is unavailable right now (relay ${res.status}).` }, 502);
  }
  return json({ text: reply.text, model: reply.model ?? null, durationMs: reply.duration_ms ?? null });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
