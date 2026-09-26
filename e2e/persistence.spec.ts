import { expect, test } from '@playwright/test';
import { edit, gotoHome, outline, row, rowCount } from './helpers';

test('edits, structure and collapse state survive a reload', async ({ page }) => {
  await gotoHome(page);
  await edit(page, 'Plant a tree');
  await page.keyboard.type(' tomorrow');
  await page.keyboard.press('Tab');
  await row(page, 'Welcome').hover();
  await row(page, 'Welcome').getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect.poll(() => rowCount(page)).toBe(13);
  await page.waitForTimeout(600); // idle-delay save
  await page.reload();
  await page.locator('[data-testid=outline]').waitFor();
  await expect.poll(() => rowCount(page)).toBe(13);
  expect(await outline(page, 'Someday')).toEqual([['Learn to juggle', ['Plant a tree tomorrow']]]);
});
