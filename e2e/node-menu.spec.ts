import { expect, test } from '@playwright/test';
import { gotoHome, outline, row } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

const grip = (page: import('@playwright/test').Page, text: string) => row(page, text).locator('[data-testid=drag-grip]');

test('the grip opens a menu whose actions apply to that node', async ({ page }) => {
  await row(page, 'Learn to juggle').hover();
  await grip(page, 'Learn to juggle').click();
  const menu = page.locator('[data-testid=node-menu]');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const onTop = await page.evaluate(
    ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid=node-menu]'),
    { x: box.x + 20, y: box.y + 12 },
  );
  expect(onTop).toBe(true);
  await page.locator('[data-testid=node-menu-down]').click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Plant a tree', 'Learn to juggle']);

  await row(page, 'Learn to juggle').hover();
  await grip(page, 'Learn to juggle').click();
  await page.locator('[data-testid=node-menu-duplicate]').click();
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Plant a tree', 'Learn to juggle', 'Learn to juggle']);

  await row(page, 'Plant a tree').hover();
  await grip(page, 'Plant a tree').click();
  await page.locator('[data-testid=node-menu-delete]').click();
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Learn to juggle']);
});

test('Escape and outside clicks close the grip menu', async ({ page }) => {
  await row(page, 'Plant a tree').hover();
  await grip(page, 'Plant a tree').click();
  await expect(page.locator('[data-testid=node-menu]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=node-menu]')).toHaveCount(0);
  await grip(page, 'Plant a tree').click();
  await page.mouse.click(5, 650);
  await expect(page.locator('[data-testid=node-menu]')).toHaveCount(0);
});

test('Delete on an empty node keeps its children in its place', async ({ page }) => {
  const id = await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    const n = [...engine.tree.all()].find((x: any) => x.content === 'Plant a tree');
    engine.execute({ type: 'createNode', id: 'kid-1', parentId: n.id, content: 'water it' });
    engine.execute({ type: 'updateContent', id: n.id, content: '' });
    return n.id as string;
  });
  const empty = page.locator(`[data-node-id="${id}"]`).first();
  await empty.hover();
  await empty.locator('[data-testid=drag-grip]').first().click();
  await page.locator('[data-testid=node-menu-delete]').click();
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'water it']);
});
