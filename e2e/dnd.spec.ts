import { expect, test } from '@playwright/test';
import { dragBullet, gotoHome, outline } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

test('dragging a bullet reorders, nests, and is undoable', async ({ page }) => {
  await dragBullet(page, 'Plant a tree', 'Learn to juggle', 0.15);
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Plant a tree', 'Learn to juggle']);

  await dragBullet(page, 'Someday', 'Projects', 0.8); // expanded row: lower part = first child
  await expect.poll(async () => (await outline(page, 'Projects')).map((s) => (typeof s === 'string' ? s : s[0]))).toEqual([
    'Someday',
    'Write the outliner',
    'Reading list',
  ]);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree']);
  await expect.poll(async () => (await outline(page)).length).toBe(3);
});

test('a node cannot be dropped into its own subtree', async ({ page }) => {
  const before = await outline(page);
  await dragBullet(page, 'Projects', 'Write the outliner', 0.5);
  expect(await outline(page)).toEqual(before);
});
