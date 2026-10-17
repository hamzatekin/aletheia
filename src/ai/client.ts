/** Ask the Worker's AI proxy (`/api/ai/complete`) for a completion. */
export type Complete = (key: string, prompt: string) => Promise<string>;

/** Shown when AI is asked for on a device without sync (the proxy only answers sync keys). */
export const AI_NEEDS_SYNC = 'Turn on sync in Settings to use AI on this device.';

/** The AI proxy or the network failed; `message` is fit to show. */
export class AiError extends Error {}

/** Longer than the Worker's relay timeout, so its clearer error arrives first. */
const CLIENT_TIMEOUT_MS = 100_000;

export function httpComplete(base = '', fetchFn: typeof fetch = (...args) => fetch(...args)): Complete {
  return async (key, prompt) => {
    let res: Response;
    try {
      res = await fetchFn(`${base}/api/ai/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
    } catch {
      throw new AiError(navigator.onLine === false ? 'You are offline.' : 'Could not reach the server.');
    }
    let body: { text?: unknown; error?: unknown } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // not JSON; keep the generic message below
    }
    if (!res.ok || typeof body.text !== 'string') {
      throw new AiError(typeof body.error === 'string' ? body.error : `AI is unavailable right now (${res.status}).`);
    }
    return body.text;
  };
}

/**
 * One step of a conversation with AI. `session` null starts one, with
 * `system` as its system prompt and `schema` as the shape every reply must
 * have (both ignored for a later step); the reply's session is null when the
 * relay keeps none, and then each step must carry the whole conversation.
 * `structured` is the reply held to the schema, when the relay could.
 */
export type Step = (
  key: string,
  prompt: string,
  session: string | null,
  system: string,
  schema: object,
) => Promise<{ text: string; session: string | null; structured?: unknown }>;

/** The relay forgot the session (it idled out or restarted): start again with the whole conversation. */
export class SessionExpired extends AiError {}

export function httpStep(base = '', fetchFn: typeof fetch = (...args) => fetch(...args)): Step {
  return async (key, prompt, session, system, schema) => {
    let res: Response;
    try {
      res = await fetchFn(`${base}/api/ai/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(session === null ? { prompt, session, system, json_schema: schema } : { prompt, session }),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
    } catch {
      throw new AiError(navigator.onLine === false ? 'You are offline.' : 'Could not reach the server.');
    }
    let body: { text?: unknown; session?: unknown; structured?: unknown; error?: unknown } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // not JSON; keep the generic message below
    }
    if (res.status === 410) throw new SessionExpired('The AI session ended.');
    if (!res.ok || typeof body.text !== 'string') {
      throw new AiError(typeof body.error === 'string' ? body.error : `AI is unavailable right now (${res.status}).`);
    }
    return { text: body.text, session: typeof body.session === 'string' ? body.session : null, ...(body.structured !== undefined ? { structured: body.structured } : {}) };
  };
}
