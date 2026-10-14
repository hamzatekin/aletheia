import { describe, expect, it } from 'vitest';
import { createCaptureKey, setupCommand } from './claude-code';

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

describe('createCaptureKey', () => {
  it('posts with the sync key and returns the new key', async () => {
    let seen: [string, RequestInit | undefined] | null = null;
    const key = await createCaptureKey('sync-key', async (url, init) => {
      seen = [String(url), init];
      return Response.json({ key: 'alc_new' });
    });
    expect(key).toBe('alc_new');
    expect(seen).toEqual(['/api/sync/capture-key', { method: 'POST', headers: { Authorization: 'Bearer sync-key' } }]);
  });

  it('throws the server error, or the status when there is none', async () => {
    await expect(createCaptureKey('k', async () => Response.json({ error: 'no sync space for this key' }, { status: 404 }))).rejects.toThrow('no sync space for this key');
    await expect(createCaptureKey('k', async () => new Response('oops', { status: 502 }))).rejects.toThrow('Sync server error (502)');
    await expect(createCaptureKey('k', async () => Response.json({}))).rejects.toThrow('Sync server error (200)');
  });
});
