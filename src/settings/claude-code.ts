/**
 * Claude Code's /aletheia skill adds items through the Worker's /api/capture
 * with a capture key: a key that can only add items, made here with the sync
 * key, so the computer running Claude Code never holds the sync key.
 */

/** Ask the server for a new capture key (it replaces the old one). */
export async function createCaptureKey(syncKey: string, fetchFn: typeof fetch = (...args) => fetch(...args)): Promise<string> {
  const res = await fetchFn('/api/sync/capture-key', { method: 'POST', headers: { Authorization: `Bearer ${syncKey}` } });
  let body: { key?: string; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // not JSON; handled below
  }
  if (!res.ok || typeof body.key !== 'string') throw new Error(body.error ?? `Sync server error (${res.status})`);
  return body.key;
}

/**
 * The shell command that sets up a computer: curl's config with the address,
 * the key and the time zone (which picks today's date), readable only by the
 * user, and the skill itself, downloaded from this site.
 */
export function setupCommand(origin: string, key: string, timeZone: string): string {
  const config = [`url = "${origin}/api/capture"`, `header = "Authorization: Bearer ${key}"`, `form-string = "tz=${timeZone}"`];
  return [
    'mkdir -p ~/.config/aletheia ~/.claude/skills/aletheia',
    `(umask 077; printf '%s\\n' ${config.map((line) => `'${line}'`).join(' ')} > ~/.config/aletheia/capture.curlrc)`,
    `curl -fsSL ${origin}/claude-code/SKILL.md -o ~/.claude/skills/aletheia/SKILL.md`,
    `echo 'Done. Run /aletheia in Claude Code.'`,
  ].join(' && ');
}
