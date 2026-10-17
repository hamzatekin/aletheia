import { expect, test, type Page } from '@playwright/test';
import { gotoHome, openNodeMenu, outline, row } from './helpers';

/** Open the sandbox the way the user does: Settings → Open sandbox. */
async function openSandbox(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Open sandbox' }).click();
  await page.waitForURL('**/sandbox');
  await page.getByTestId('sandbox-header').waitFor();
}

/** Type a first item into the empty sandbox, with `child` under it if given. */
async function addFirstItem(page: Page, text: string, child?: string): Promise<void> {
  await page.getByTestId('empty-outline').dispatchEvent('mousedown');
  await expect(page.locator('.ProseMirror')).toBeFocused();
  await page.keyboard.type(text);
  if (child) {
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type(child);
  }
  await page.keyboard.press('Escape');
}

test.beforeEach(async ({ page }) => gotoHome(page));

test('the sandbox starts blank and keeps its items apart from the notes', async ({ page }) => {
  const notes = await outline(page);
  await openSandbox(page);
  await expect(page).toHaveTitle('Sandbox');
  await expect(page.getByTestId('empty-outline')).toBeVisible();
  await addFirstItem(page, 'Try AI here');
  await expect.poll(() => outline(page)).toEqual(['Try AI here']);

  await page.reload();
  await page.getByTestId('outline').waitFor();
  await expect.poll(() => outline(page)).toEqual(['Try AI here']);

  await page.getByRole('link', { name: 'Back to my notes' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await page.getByTestId('outline').waitFor();
  expect(await outline(page)).toEqual(notes);
  await expect(page.getByTestId('sandbox-header')).toHaveCount(0);
});

test('zooming in the sandbox stays under /sandbox, with Sandbox in the breadcrumbs', async ({ page }) => {
  await openSandbox(page);
  await addFirstItem(page, 'Experiment');
  await row(page, 'Experiment').getByRole('link', { name: 'Zoom in' }).click();
  await page.waitForURL(/\/sandbox\/n\//);
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumbs' });
  await expect(crumbs.getByRole('link', { name: 'Sandbox' })).toBeVisible();
  await crumbs.getByRole('link', { name: 'Sandbox' }).click();
  await page.waitForURL((url) => url.pathname === '/sandbox');
  await expect(page.getByTestId('sandbox-header')).toBeVisible();
});

test('the sandbox never syncs, but AI there uses the notes’ sync key', async ({ page }) => {
  const key = 'k'.repeat(43);
  // Sync is on for the real notes: the key is saved in their database.
  await page.evaluate(
    (key) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('aletheia');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('meta', 'readwrite');
          tx.objectStore('meta').put({ key: 'syncKey', value: key });
          tx.oncomplete = () => (open.result.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      }),
    key,
  );
  const syncCalls: string[] = [];
  await page.route('**/api/sync/**', (route) => {
    syncCalls.push(route.request().url());
    return route.fulfill({ status: 503, json: { error: 'stub' } });
  });
  let auth: string | null = null;
  await page.route('**/api/ai/complete', async (route) => {
    auth = await route.request().headerValue('authorization');
    await route.fulfill({ json: { text: 'Ideas', model: 'm', durationMs: 5 } });
  });
  await openSandbox(page);
  syncCalls.length = 0;
  await addFirstItem(page, 'Something', 'Learn to juggle');
  await openNodeMenu(page, 'Something');
  await page.getByTestId('node-menu-ai-title').click();
  await expect.poll(() => auth).toBe(`Bearer ${key}`);
  await expect.poll(() => outline(page)).toEqual([['Ideas', ['Learn to juggle']]]);
  await expect(page.getByTestId('sync-indicator')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('sync-section')).toHaveCount(0);
  expect(syncCalls).toEqual([]);
});

test('typing in the sandbox leaves a tab of the notes open beside it alone', async ({ page, context }) => {
  const notes = await outline(page);
  const sandbox = await context.newPage();
  await sandbox.goto('/sandbox');
  await sandbox.getByTestId('sandbox-header').waitFor();
  await addFirstItem(sandbox, 'Sandbox only');
  await expect.poll(() => outline(sandbox)).toEqual(['Sandbox only']);
  // Tabs of one database pass each saved change along at once; give a stray message time to land.
  await page.waitForTimeout(300);
  expect(await outline(page)).toEqual(notes);
});
