import { describe, expect, it } from 'vitest';
import { createKey, mcpCommand, setupCommand } from './claude-code';

describe('setupCommand', () => {
  it('writes curl config with the address, key and time zone, then installs the skill', () => {
    expect(setupCommand('https://notes.test', 'alc_abc-_1', 'Europe/Istanbul')).toBe(
      'mkdir -p ~/.config/aletheia ~/.claude/skills/aletheia && ' +
        `(umask 077; printf '%s\\n' 'url = "https://notes.test/api/capture"' 'header = "Authorization: Bearer alc_abc-_1"' 'form-string = "tz=Europe/Istanbul"' > ~/.config/aletheia/capture.curlrc) && ` +
        'curl -fsSL https://notes.test/claude-code/SKILL.md -o ~/.claude/skills/aletheia/SKILL.md && ' +
        "echo 'Done. Run /aletheia in Claude Code.'",
    );
  });
});

describe('mcpCommand', () => {
  it('replaces any earlier aletheia server, for all projects, with the read key as a header', () => {
    expect(mcpCommand('https://notes.test', 'alr_abc')).toBe(
      'claude mcp remove --scope user aletheia >/dev/null 2>&1; ' +
        'claude mcp add --transport http --scope user aletheia https://notes.test/api/mcp --header "Authorization: Bearer alr_abc"',
    );
  });
});

describe('createKey', () => {
  it('posts with the sync key and returns the new key', async () => {
    let seen: [string, RequestInit | undefined] | null = null;
    const key = await createKey('sync-key', 'capture', async (url, init) => {
      seen = [String(url), init];
      return Response.json({ key: 'alc_new' });
    });
    expect(key).toBe('alc_new');
    expect(seen).toEqual(['/api/sync/capture-key', { method: 'POST', headers: { Authorization: 'Bearer sync-key' } }]);
    await createKey('sync-key', 'read', async (url, init) => {
      seen = [String(url), init];
      return Response.json({ key: 'alr_new' });
    });
    expect(seen).toEqual(['/api/sync/read-key', { method: 'POST', headers: { Authorization: 'Bearer sync-key' } }]);
  });

  it('throws the server error, or the status when there is none', async () => {
    await expect(createKey('k', 'capture', async () => Response.json({ error: 'no sync space for this key' }, { status: 404 }))).rejects.toThrow('no sync space for this key');
    await expect(createKey('k', 'capture', async () => new Response('oops', { status: 502 }))).rejects.toThrow('Sync server error (502)');
    await expect(createKey('k', 'capture', async () => Response.json({}))).rejects.toThrow('Sync server error (200)');
  });
});
