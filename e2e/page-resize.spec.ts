import { expect, test } from '@playwright/test';
import { gotoHome } from './helpers';

test.use({ viewport: { width: 1400, height: 800 } });

test('dragging the page edge changes its width, double-click resets it', async ({ page }) => {
  await gotoHome(page);
  const sheet = page.locator('main.book-page');
  const before = (await sheet.boundingBox())!.width;
  const handle = page.getByTestId('page-resize-right');
  const box = (await handle.boundingBox())!;
  const y = box.y + 200;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.width)).toBe(Math.round(before) + 120);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aletheia:settings')!).pageWidth)).toBe(840);
  await page.getByTestId('page-resize-left').dblclick();
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.width)).toBe(Math.round(before));
});
