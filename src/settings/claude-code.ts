/**
 * Claude Code's /aletheia skill adds items through the Worker's /api/capture
 * with a capture key: a key that can only add items, made here with the sync
 * key, so the computer running Claude Code never holds the sync key. Its MCP
 * connection (/api/mcp) searches and reads the notes with a read key, which
 * can only read.
 */

/** Ask the server for a new capture or read key (it replaces the old one of that kind). */
export async function createKey(syncKey: string, kind: 'capture' | 'read', fetchFn: typeof fetch = (...args) => fetch(...args)): Promise<string> {
  const res = await fetchFn(`/api/sync/${kind}-key`, { method: 'POST', headers: { Authorization: `Bearer ${syncKey}` } });
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

/** The command that connects Claude Code (all projects) to the notes, replacing an earlier connection. */
export function mcpCommand(origin: string, key: string): string {
  return [
    'claude mcp remove --scope user aletheia >/dev/null 2>&1',
    `claude mcp add --transport http --scope user aletheia ${origin}/api/mcp --header "Authorization: Bearer ${key}"`,
  ].join('; ');
}
