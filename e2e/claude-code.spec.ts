import { expect, test } from '@playwright/test';
import { gotoHome, syncOn } from './helpers';

test.use({ viewport: { width: 1280, height: 800 }, timezoneId: 'Europe/Istanbul' });

test('with sync on, Settings makes a capture key and shows the command that sets up Claude Code', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('claude-code')).toHaveCount(0);

  const key = await syncOn(page);
  let auth: string | null = null;
  await page.route('**/api/sync/capture-key', async (route) => {
    auth = await route.request().headerValue('authorization');
    await route.fulfill({ json: { key: 'alc_test-key' } });
  });
  const section = page.getByTestId('claude-code');
  await section.getByRole('button', { name: 'Set up Claude Code' }).click();
  const origin = new URL(page.url()).origin;
  await expect(section.getByLabel('Setup command')).toHaveValue(
    'mkdir -p ~/.config/aletheia ~/.claude/skills/aletheia && ' +
      `(umask 077; printf '%s\\n' 'url = "${origin}/api/capture"' 'header = "Authorization: Bearer alc_test-key"' 'form-string = "tz=Europe/Istanbul"' > ~/.config/aletheia/capture.curlrc) && ` +
      `curl -fsSL ${origin}/claude-code/SKILL.md -o ~/.claude/skills/aletheia/SKILL.md && ` +
      "echo 'Done. Run /aletheia in Claude Code.'",
  );
  expect(auth).toBe(`Bearer ${key}`);
});

test('Settings makes a read key and shows the command that lets Claude Code read the notes', async ({ page }) => {
  await gotoHome(page);
  const key = await syncOn(page);
  let auth: string | null = null;
  await page.route('**/api/sync/read-key', async (route) => {
    auth = await route.request().headerValue('authorization');
    await route.fulfill({ json: { key: 'alr_test-key' } });
  });
  await page.getByRole('button', { name: 'Settings' }).click();
  const section = page.getByTestId('claude-code-mcp');
  await section.getByRole('button', { name: 'Connect to your notes' }).click();
  const origin = new URL(page.url()).origin;
  await expect(section.getByLabel('Connect command')).toHaveValue(
    'claude mcp remove --scope user aletheia >/dev/null 2>&1; ' +
      `claude mcp add --transport http --scope user aletheia ${origin}/api/mcp --header "Authorization: Bearer alr_test-key"`,
  );
  expect(auth).toBe(`Bearer ${key}`);
  // The capture setup is untouched.
  await expect(page.getByTestId('claude-code').getByRole('button', { name: 'Set up Claude Code' })).toBeVisible();
});

test('shows why the key could not be made', async ({ page }) => {
  await gotoHome(page);
  await syncOn(page);
  await page.route('**/api/sync/capture-key', (route) => route.fulfill({ status: 404, json: { error: 'no sync space for this key' } }));
  await page.getByRole('button', { name: 'Settings' }).click();
  const section = page.getByTestId('claude-code');
  await section.getByRole('button', { name: 'Set up Claude Code' }).click();
  await expect(section.getByRole('alert')).toHaveText('no sync space for this key');
  await expect(section.getByLabel('Setup command')).toHaveCount(0);
});

test('the skill file is served next to the app', async ({ request }) => {
  const res = await request.get('/claude-code/SKILL.md');
  expect(res.ok()).toBe(true);
  expect(await res.text()).toMatch(/^---\nname: aletheia\n/);
});
