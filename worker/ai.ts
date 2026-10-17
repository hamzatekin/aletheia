/**
 * AI API: a thin proxy to Avvos's Claude relay, so the relay token stays on
 * the server. The site is public, so only a device with a sync key (the
 * owner's) may call it.
 *
 *   POST /api/ai/complete   { prompt } -> { text, model, durationMs } or { error }
 *   POST /api/ai/complete   { prompt, session } -> the same plus { session }
 *
 * With `session` (null to start one), the prompt goes to the relay's /v1/chat,
 * which keeps one Claude conversation alive per session so an agent's later
 * steps send only what's new. A relay without /v1/chat answers 404; then a new
 * session falls back to /v1/complete and comes back as `session: null`, and
 * the app keeps sending the whole conversation. An unknown session is 410.
 *
 * Needs `Authorization: Bearer <sync key>` and the CLAUDE_RELAY_TOKEN secret.
 */
import { json } from './http';
import { hasSyncSpace, type SyncEnv } from './sync';

export interface AiEnv extends SyncEnv {
  /** Bearer token for the relay (a Cloudflare secret: `wrangler secret put CLAUDE_RELAY_TOKEN`). */
  CLAUDE_RELAY_TOKEN?: string;
  /** Relay endpoint; defaults to DEFAULT_RELAY_URL. */
  CLAUDE_RELAY_URL?: string;
  /** The relay's session endpoint; defaults to the relay URL with /complete swapped for /chat. */
  CLAUDE_RELAY_CHAT_URL?: string;
}

const DEFAULT_RELAY_URL = 'https://ai.hamzatekin.dev/v1/complete';
/** `claude -p` can take a while on a long prompt; give up before the browser does. */
const RELAY_TIMEOUT_MS = 90_000;
const MAX_PROMPT_CHARS = 100_000;
const MAX_SESSION_CHARS = 200;

interface RelayReply {
  text?: string;
  model?: string;
  duration_ms?: number;
  session?: string;
  error?: string;
}

export async function handleAi(request: Request, env: AiEnv, fetchFn: typeof fetch = fetch): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (`${request.method} ${pathname}` !== 'POST /api/ai/complete') return json({ error: 'not found' }, 404);
  if (!(await hasSyncSpace(request, env))) return json({ error: 'AI needs sync to be on for this device.' }, 401);
  if (!env.CLAUDE_RELAY_TOKEN) return json({ error: 'AI is not set up on this server (the CLAUDE_RELAY_TOKEN secret is missing).' }, 503);

  let body: { prompt?: unknown; session?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const { prompt, session } = body;
  if (typeof prompt !== 'string' || prompt.trim() === '') return json({ error: 'prompt is required' }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'That is too much text to send to AI.' }, 413);
  if (session !== undefined && session !== null && (typeof session !== 'string' || session === '' || session.length > MAX_SESSION_CHARS)) {
    return json({ error: 'session must be a string or null' }, 400);
  }

  const relayUrl = env.CLAUDE_RELAY_URL || DEFAULT_RELAY_URL;
  if (session === undefined) return answer(await callRelay(relayUrl, { prompt }, env.CLAUDE_RELAY_TOKEN, fetchFn), false);

  const chatUrl = env.CLAUDE_RELAY_CHAT_URL || relayUrl.replace(/\/complete$/, '/chat');
  const chat = await callRelay(chatUrl, { session, prompt }, env.CLAUDE_RELAY_TOKEN, fetchFn);
  if ('status' in chat && chat.status === 404) {
    // No session endpoint on this relay: an ongoing session can't exist, a new one runs as a plain completion.
    if (session !== null) return json({ error: 'session expired' }, 410);
    return answer(await callRelay(relayUrl, { prompt }, env.CLAUDE_RELAY_TOKEN, fetchFn), true);
  }
  return answer(chat, true);
}

type RelayResult = { reply: RelayReply } | { status: number; reply: RelayReply | null } | { failed: Response };

/** POST to the relay; a reply the app can't use is turned into an error response here. */
async function callRelay(url: string, payload: object, token: string, fetchFn: typeof fetch): Promise<RelayResult> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    console.error('relay unreachable', error);
    return { failed: json({ error: timedOut ? 'AI took too long to answer.' : 'AI is unavailable right now.' }, timedOut ? 504 : 502) };
  }

  let reply: RelayReply | null = null;
  try {
    reply = (await res.json()) as RelayReply;
  } catch {
    // not JSON (a proxy error page); handled below
  }
  if (res.status === 401 || res.status === 403) {
    console.error('relay rejected the token', res.status);
    return { failed: json({ error: 'The AI relay rejected this server (check CLAUDE_RELAY_TOKEN).' }, 502) };
  }
  if (res.status === 404 || res.status === 409 || res.status === 410) return { status: res.status, reply };
  if (!res.ok || !reply || reply.error || typeof reply.text !== 'string') {
    console.error('relay failed', res.status, reply?.error);
    return { failed: json({ error: reply?.error ? `AI failed: ${reply.error}` : `AI is unavailable right now (relay ${res.status}).` }, 502) };
  }
  return { reply };
}

function answer(result: RelayResult, withSession: boolean): Response {
  if ('failed' in result) return result.failed;
  if ('status' in result) {
    if (result.status === 410) return json({ error: 'session expired' }, 410);
    if (result.status === 409) return json({ error: 'AI is still answering the last step.' }, 409);
    return json({ error: 'AI is unavailable right now (relay 404).' }, 502);
  }
  const { reply } = result;
  return json({
    text: reply.text,
    model: reply.model ?? null,
    durationMs: reply.duration_ms ?? null,
    ...(withSession ? { session: typeof reply.session === 'string' && reply.session !== '' ? reply.session : null } : {}),
  });
}
