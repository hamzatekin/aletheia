/** Ask the Worker's AI proxy (`/api/ai/complete`) for a completion. */
export type Complete = (key: string, prompt: string) => Promise<string>;

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
