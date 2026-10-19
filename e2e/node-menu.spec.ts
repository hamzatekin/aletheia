import { expect, test } from '@playwright/test';
import { edit, gotoHome, openNodeMenu, outline, row } from './helpers';

// Tall enough that the whole sample outline, under Home's title, fits on screen with room for a menu below.
test.use({ viewport: { width: 900, height: 820 } });

test.beforeEach(async ({ page }) => gotoHome(page));

test('the grip opens a menu whose actions apply to that node', async ({ page }) => {
  await openNodeMenu(page, 'Learn to juggle');
  const menu = page.locator('[data-testid=node-menu]');
  const box = (await menu.boundingBox())!;
  const onTop = await page.evaluate(
    ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid=node-menu]'),
    { x: box.x + 20, y: box.y + 12 },
  );
  expect(onTop).toBe(true);
  await page.locator('[data-testid=node-menu-down]').click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Plant a tree', 'Learn to juggle']);

  await openNodeMenu(page, 'Learn to juggle');
  await page.locator('[data-testid=node-menu-duplicate]').click();
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Plant a tree', 'Learn to juggle', 'Learn to juggle']);

  await openNodeMenu(page, 'Plant a tree');
  await page.locator('[data-testid=node-menu-delete]').click();
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Learn to juggle']);
});

test('Escape and outside clicks close the grip menu', async ({ page }) => {
  await openNodeMenu(page, 'Plant a tree');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=node-menu]')).toHaveCount(0);
  await row(page, 'Plant a tree').locator('[data-testid=drag-grip]').click();
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

test('only the hovered row shows its grip, right beside its own bullet', async ({ page }) => {
  const x = async (text: string, sel: string) => (await row(page, text).locator(sel).first().boundingBox())!;
  const shown = (text: string) => row(page, text).locator('[data-testid=drag-grip]').evaluate((el) => getComputedStyle(el).opacity);
  await edit(page, 'Projects');
  await page.mouse.move(450, 5);
  await expect.poll(() => shown('Projects')).toBe('1');

  // A leaf's grip sits next to its bullet; a parent's leaves room for its arrow, as in Dynalist.
  await row(page, 'Data model').locator('.row-text').hover();
  const grip = await x('Data model', '[data-testid=drag-grip]');
  const bullet = await x('Data model', '.bullet-dot');
  expect(bullet.x - (grip.x + grip.width)).toBeLessThan(12);
  const parentGrip = await x('Write the outliner', '[data-testid=drag-grip]');
  const arrow = await x('Write the outliner', '[aria-label=Collapse]');
  expect(Math.abs(parentGrip.x + parentGrip.width - arrow.x)).toBeLessThanOrEqual(2);

  // The focused row's grip steps aside while another row is hovered.
  await expect.poll(() => shown('Data model')).toBe('1');
  await expect.poll(() => shown('Projects')).toBe('0');
});
