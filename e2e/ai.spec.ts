import { expect, test } from '@playwright/test';
import { edit, gotoHome, openNodeMenu, outline, row, syncOn } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

test('AI actions are hidden while sync is off', async ({ page }) => {
  await openNodeMenu(page, 'Someday');
  await expect(page.getByTestId('node-menu-ai-title')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await edit(page, 'Plant a tree');
  await page.keyboard.type('/suggest');
  await expect(page.getByTestId('slash-item')).toHaveCount(0);
});

test('Suggest title in the row menu renames the row from what is under it, with Undo', async ({ page }) => {
  const key = await syncOn(page);
  let sent: { auth: string | null; prompt: string } | null = null;
  await page.route('**/api/ai/complete', async (route) => {
    const req = route.request();
    sent = { auth: await req.headerValue('authorization'), prompt: req.postDataJSON().prompt };
    await route.fulfill({ json: { text: '"Weekend projects."', model: 'm', durationMs: 5 } });
  });
  await openNodeMenu(page, 'Someday');
  await page.getByTestId('node-menu-ai-title').click();
  await expect.poll(() => outline(page, 'Weekend projects')).toEqual(['Learn to juggle', 'Plant a tree']);
  expect(sent!.auth).toBe(`Bearer ${key}`);
  expect(sent!.prompt).toContain('- Learn to juggle');
  await expect(page.getByTestId('ai-notice')).toContainText('Title suggested');
  await page.getByTestId('ai-notice-action').click();
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree']);
  await expect(page.getByTestId('ai-notice')).toHaveCount(0);
});

test('the slash command shows why AI failed and leaves the row alone', async ({ page }) => {
  await syncOn(page);
  await page.route('**/api/ai/complete', (route) =>
    route.fulfill({ status: 503, json: { error: 'AI is not set up on this server (the CLAUDE_RELAY_TOKEN secret is missing).' } }),
  );
  await edit(page, 'Someday');
  await page.keyboard.type('/suggest');
  await expect(page.getByTestId('slash-item')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ai-notice')).toContainText('CLAUDE_RELAY_TOKEN');
  await expect(row(page, 'Someday')).toBeVisible();
});
