import { expect, test } from '@playwright/test';
import { gotoHome, syncOn } from './helpers';

const ID = 'a'.repeat(32);
const HTML = `<!doctype html><h1 id="h">Week 42</h1><p id="js"></p>
<script>
  document.getElementById('js').textContent = 'scripts run';
  try { localStorage.getItem('x'); document.title = 'storage open'; } catch { document.getElementById('js').textContent += ', storage blocked'; }
</script>`;

test('a page sent with a capture opens full screen, with scripts but without the app\'s storage', async ({ page }) => {
  await gotoHome(page);
  const key = await syncOn(page);
  let auth: string | null = null;
  await page.route(`**/api/pages/${ID}`, async (route) => {
    auth = await route.request().headerValue('authorization');
    await route.fulfill({ json: { title: 'Week 42 report', html: HTML, createdAt: 1 } });
  });
  // Client-side navigation keeps the stubbed sync state.
  await page.evaluate((id) => {
    history.pushState(null, '', `/p/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ID);
  await expect(page.getByTestId('page-title')).toHaveText('Week 42 report');
  const frame = page.frameLocator('[data-testid="page-frame"]');
  await expect(frame.locator('#h')).toHaveText('Week 42');
  await expect(frame.locator('#js')).toHaveText('scripts run, storage blocked');
  await expect(page.getByTestId('page-frame')).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
  expect(auth).toBe(`Bearer ${key}`);
  await expect(page).toHaveTitle('Week 42 report');
  await page.getByRole('link', { name: '← Aletheia' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('shows why a page could not be opened', async ({ page }) => {
  await gotoHome(page);
  await syncOn(page);
  await page.route(`**/api/pages/${ID}`, (route) => route.fulfill({ status: 404, json: { error: 'This page does not exist.' } }));
  await page.evaluate((id) => {
    history.pushState(null, '', `/p/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ID);
  await expect(page.getByRole('alert')).toHaveText('This page does not exist.');
});

test('asks for sync when it is off', async ({ page }) => {
  await page.goto(`/p/${ID}`);
  await expect(page.getByRole('alert')).toHaveText('This page opens only where sync is on. Turn it on in Settings.');
  await expect(page.getByTestId('page-frame')).toHaveCount(0);
});
