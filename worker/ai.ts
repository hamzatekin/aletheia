/**
 * AI API: a thin proxy to Avvos's Claude relay, so the relay token stays on
 * the server. The site is public, so only a device with a sync key (the
 * owner's) may call it.
 *
 *   POST /api/ai/complete   { prompt } -> { text, model, durationMs } or { error }
 *   POST /api/ai/complete   { prompt, session, system?, json_schema? } -> the same plus { session, structured? }
 *
 * With `session` (null to start one, with `system` as its system prompt), the
 * prompt goes to the relay's /v1/chat, which keeps one Claude conversation
 * alive per session so an agent's later steps send only what's new. An
 * unknown or ended session is 410; the app starts a new one with the whole
 * conversation. When all relay sessions are
 * busy (503) the Worker waits and tries again. With `json_schema` (a new
 * session only, like `system`) the relay holds every reply to that shape and
 * sends it as `structured` beside the text.
 *
 *   POST /api/ai/transcribe  base64 WAV as the text body -> { text }
 *
 * Transcribe turns a voice memo into text with Whisper on Workers AI (the `ai`
 * binding), not the relay; the free daily allowance covers a few hours of audio.
 *
 * Needs `Authorization: Bearer <sync key>`; complete needs the CLAUDE_RELAY_TOKEN secret.
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
  /** Workers AI, for speech to text (the `ai` binding in wrangler.jsonc). */
  AI?: { run(model: string, input: object): Promise<unknown> };
}

const DEFAULT_RELAY_URL = 'https://ai.hamzatekin.dev/v1/complete';
/** `claude -p` can take a while on a long prompt; give up before the browser does. */
const RELAY_TIMEOUT_MS = 90_000;
const MAX_PROMPT_CHARS = 100_000;
const MAX_SESSION_CHARS = 200;
const MAX_SYSTEM_CHARS = 20_000;
const MAX_SCHEMA_CHARS = 20_000;
/** Waits before trying again when every relay session is busy. */
const BUSY_RETRY_MS = [1_500, 3_000];
const WHISPER = '@cf/openai/whisper-large-v3-turbo';
/** A bit over 5 minutes of 16 kHz mono WAV (32 kB a second) as base64; the app stops recording at 5. */
const MAX_AUDIO_CHARS = 14_000_000;

interface RelayReply {
  text?: string;
  model?: string;
  duration_ms?: number;
  session?: string;
  /** The reply as an object, when the session was started with a json_schema. */
  structured?: unknown;
  error?: string;
}

export async function handleAi(
  request: Request,
  env: AiEnv,
  fetchFn: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Response> {
  const { pathname } = new URL(request.url);
  const route = `${request.method} ${pathname}`;
  if (route !== 'POST /api/ai/complete' && route !== 'POST /api/ai/transcribe') return json({ error: 'not found' }, 404);
  if (!(await hasSyncSpace(request, env))) return json({ error: 'AI needs sync to be on for this device.' }, 401);
  if (route === 'POST /api/ai/transcribe') return transcribe(request, env);
  if (!env.CLAUDE_RELAY_TOKEN) return json({ error: 'AI is not set up on this server (the CLAUDE_RELAY_TOKEN secret is missing).' }, 503);

  let body: { prompt?: unknown; session?: unknown; system?: unknown; json_schema?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const { prompt, session, system, json_schema: schema } = body;
  if (typeof prompt !== 'string' || prompt.trim() === '') return json({ error: 'prompt is required' }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'That is too much text to send to AI.' }, 413);
  if (session !== undefined && session !== null && (typeof session !== 'string' || session === '' || session.length > MAX_SESSION_CHARS)) {
    return json({ error: 'session must be a string or null' }, 400);
  }
  if (system !== undefined && (typeof system !== 'string' || system.length > MAX_SYSTEM_CHARS)) return json({ error: 'system must be a short string' }, 400);
  if (schema !== undefined && (typeof schema !== 'object' || schema === null || Array.isArray(schema) || JSON.stringify(schema).length > MAX_SCHEMA_CHARS)) {
    return json({ error: 'json_schema must be a small object' }, 400);
  }

  const relayUrl = env.CLAUDE_RELAY_URL || DEFAULT_RELAY_URL;
  if (session === undefined) return answer(await callRelay(relayUrl, { prompt }, env.CLAUDE_RELAY_TOKEN, fetchFn), false);

  const chatUrl = env.CLAUDE_RELAY_CHAT_URL || relayUrl.replace(/\/complete$/, '/chat');
  // A system prompt and a schema only go with a new session; the relay refuses them on a later step.
  const starting = session === null;
  const payload = {
    session,
    prompt,
    ...(starting && typeof system === 'string' && system !== '' ? { system } : {}),
    ...(starting && schema !== undefined ? { json_schema: schema } : {}),
  };
  let chat = await callRelay(chatUrl, payload, env.CLAUDE_RELAY_TOKEN, fetchFn, SESSION_STATUSES);
  for (const ms of BUSY_RETRY_MS) {
    if (!('status' in chat) || chat.status !== 503) break;
    await wait(ms);
    chat = await callRelay(chatUrl, payload, env.CLAUDE_RELAY_TOKEN, fetchFn, SESSION_STATUSES);
  }
  return answer(chat, true);
}

/** The relay's text, a session status for the caller to handle, or an error response ready to send. */
type RelayResult = { reply: RelayReply } | { status: number; reply: RelayReply | null } | { failed: Response };

/** Statuses /v1/chat uses to say something about the session, passed on to be handled. */
const SESSION_STATUSES = [409, 410, 503];

/** POST to the relay; a reply the app can't use is turned into an error response here. */
async function callRelay(url: string, payload: object, token: string, fetchFn: typeof fetch, passOn: readonly number[] = []): Promise<RelayResult> {
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
  if (passOn.includes(res.status)) return { status: res.status, reply };
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
    return json({ error: 'AI is busy with other chats. Try again in a moment.' }, 503);
  }
  const { reply } = result;
  return json({
    text: reply.text,
    model: reply.model ?? null,
    durationMs: reply.duration_ms ?? null,
    ...(withSession ? { session: typeof reply.session === 'string' && reply.session !== '' ? reply.session : null } : {}),
    ...(reply.structured !== undefined && reply.structured !== null ? { structured: reply.structured } : {}),
  });
}

/**
 * A voice memo to text. The app sends base64 (the browser encodes it, so the
 * Worker only passes a string on and stays within its CPU time).
 */
async function transcribe(request: Request, env: AiEnv): Promise<Response> {
  if (!env.AI) return json({ error: 'Speech to text is not set up on this server (the AI binding is missing).' }, 503);
  const audio = (await request.text()).trim();
  if (audio === '') return json({ error: 'The recording is empty.' }, 400);
  if (audio.length > MAX_AUDIO_CHARS) return json({ error: 'That recording is too long.' }, 413);
  let result: unknown;
  try {
    result = await env.AI.run(WHISPER, { audio });
  } catch (error) {
    console.error('whisper failed', error);
    return json({ error: 'Could not turn the recording into text.' }, 502);
  }
  const text = (result as { text?: unknown } | null)?.text;
  if (typeof text !== 'string') {
    console.error('whisper gave no text', result);
    return json({ error: 'Could not turn the recording into text.' }, 502);
  }
  return json({ text: text.trim() });
}
