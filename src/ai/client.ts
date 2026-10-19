/** Ask the Worker's AI proxy (`/api/ai/complete`) for a completion. */
export type Complete = (key: string, prompt: string) => Promise<string>;

/** Shown when AI is asked for on a device without sync (the proxy only answers sync keys). */
export const AI_NEEDS_SYNC = 'Turn on sync in Settings to use AI on this device.';

/** The AI proxy or the network failed; `message` is fit to show. */
export class AiError extends Error {}

/** Longer than the Worker's relay timeout, so its clearer error arrives first. */
const CLIENT_TIMEOUT_MS = 100_000;

type Fetch = typeof fetch;
const realFetch: Fetch = (...args) => fetch(...args);

/** POST to the AI proxy; network failures become an AiError fit to show. */
async function post<T>(fetchFn: Fetch, key: string, payload: object): Promise<{ res: Response; body: Partial<T> & { error?: unknown } }> {
  let res: Response;
  try {
    res = await fetchFn('/api/ai/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
  } catch {
    throw new AiError(navigator.onLine === false ? 'You are offline.' : 'Could not reach the server.');
  }
  let body: Partial<T> & { error?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // not JSON; keep the generic message below
  }
  return { res, body };
}

/** The proxy's error, or a generic one with the status. */
function failed(res: Response, body: { error?: unknown }): AiError {
  return new AiError(typeof body.error === 'string' ? body.error : `AI is unavailable right now (${res.status}).`);
}

export function httpComplete(): Complete {
  return async (key, prompt) => {
    const { res, body } = await post<{ text: unknown }>(realFetch, key, { prompt });
    if (!res.ok || typeof body.text !== 'string') throw failed(res, body);
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

export function httpStep(fetchFn: Fetch = realFetch): Step {
  return async (key, prompt, session, system, schema) => {
    const payload = session === null ? { prompt, session, system, json_schema: schema } : { prompt, session };
    const { res, body } = await post<{ text: unknown; session: unknown; structured: unknown }>(fetchFn, key, payload);
    if (res.status === 410) throw new SessionExpired('The AI session ended.');
    if (!res.ok || typeof body.text !== 'string') throw failed(res, body);
    return { text: body.text, session: typeof body.session === 'string' ? body.session : null, ...(body.structured !== undefined ? { structured: body.structured } : {}) };
  };
}
