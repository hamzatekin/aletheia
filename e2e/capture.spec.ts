import { expect, test } from '@playwright/test';
import { focused, gotoHome, outline } from './helpers';

test('sharing a page to the app adds a titled link at the top of the Inbox', async ({ page }) => {
  await gotoHome(page);
  await page.goto('/share?title=Mirrors%20in%20Workflowy&text=https%3A%2F%2Fblog.workflowy.com%2Fmirrors');
  await expect(page.locator('h1')).toHaveText('Inbox');
  await expect(page).toHaveURL(/\/n\//);
  await expect(page.locator('[data-testid=outline] a[href="https://blog.workflowy.com/mirrors"]')).toHaveText('Mirrors in Workflowy');
  expect((await outline(page))[0]).toEqual(['Inbox', ['[Mirrors in Workflowy](https://blog.workflowy.com/mirrors)']]);

  // Reloading the Inbox does not add it again; a second share goes on top.
  await page.reload();
  await page.locator('[data-testid=outline]').waitFor();
  await page.goto('/share?text=Buy%20bread');
  await expect(page.locator('h1')).toHaveText('Inbox');
  expect((await outline(page))[0]).toEqual(['Inbox', ['Buy bread', '[Mirrors in Workflowy](https://blog.workflowy.com/mirrors)']]);
});

test('the Add to Inbox shortcut opens a new empty item to type into', async ({ page }) => {
  await gotoHome(page);
  await page.goto('/capture');
  await expect(page.locator('h1')).toHaveText('Inbox');
  await expect.poll(() => focused(page)).toBe(':content');
  await page.keyboard.type('Call the dentist');
  await page.keyboard.press('Escape');
  expect((await outline(page))[0]).toEqual(['Inbox', ['Call the dentist']]);
});

test('the manifest offers the share target and the shortcut', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.share_target).toMatchObject({ action: '/share', method: 'GET' });
  expect(manifest.shortcuts[0].url).toBe('/capture');
});
