import { expect, test } from '@playwright/test';
import { edit, gotoHome, outline, row } from './helpers';

// Two tabs share one IndexedDB but each keeps the tree in memory.
test('an edit in one tab shows in the other, and the other does not save over it', async ({ page, context }) => {
  await gotoHome(page);
  const other = await context.newPage();
  await gotoHome(other);

  await edit(page, 'Plant a tree');
  await page.keyboard.type(' tomorrow');
  await page.keyboard.press('Escape');
  await expect.poll(() => outline(other, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree tomorrow']);

  // The other tab edits a different node; the first tab's edit survives a reload.
  await edit(other, 'Learn to juggle');
  await other.keyboard.type(' well');
  await other.keyboard.press('Escape');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle well', 'Plant a tree tomorrow']);
  await page.waitForTimeout(600);
  await page.reload();
  await page.locator('[data-testid=outline]').waitFor();
  expect(await outline(page, 'Someday')).toEqual(['Learn to juggle well', 'Plant a tree tomorrow']);
  await expect(row(other, 'Plant a tree tomorrow')).toBeVisible();
});
