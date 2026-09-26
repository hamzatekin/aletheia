import { expect, test, type Page } from '@playwright/test';
import { focused, gotoHome, outline, row } from './helpers';

// A phone: touch screen, no hover, no Tab key.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** The element a finger would hit at the center of the locator's box. */
async function hitAtCenter(page: Page, selector: string): Promise<boolean> {
  const box = (await page.locator(selector).first().boundingBox())!;
  return page.evaluate(
    ({ x, y, selector }) => !!document.elementFromPoint(x, y)?.closest(selector),
    { x: box.x + box.width / 2, y: box.y + box.height / 2, selector },
  );
}

test('collapsed nodes show a visible arrow that expands them with a tap', async ({ page }) => {
  await gotoHome(page);
  await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    const n = [...engine.tree.all()].find((n: any) => n.content === 'Projects');
    engine.execute({ type: 'toggleCollapse', id: n.id, collapsed: true });
  });
  const toggle = row(page, 'Projects').getByRole('button', { name: 'Expand' });
  await expect(toggle).toHaveCSS('opacity', '1');
  expect(await hitAtCenter(page, '[data-node-id] button[aria-label=Expand]')).toBe(true);
  await toggle.tap();
  await expect(row(page, 'Write the outliner')).toBeVisible();
  await expect(row(page, 'Projects').getByRole('button', { name: 'Collapse' })).toHaveCSS('opacity', '1');
});

test('the toolbar above the keyboard indents, outdents and moves while editing', async ({ page }) => {
  await gotoHome(page);
  await expect(page.getByTestId('mobile-toolbar')).toHaveCount(0);
  await row(page, 'Plant a tree').locator('.node-content').first().tap();
  await expect(page.getByTestId('mobile-toolbar')).toBeVisible();

  await page.getByTestId('toolbar-indent').tap();
  expect(await outline(page, 'Someday')).toEqual([['Learn to juggle', ['Plant a tree']]]);
  await expect(page.locator('.ProseMirror')).toBeFocused();
  expect(await focused(page)).toBe('Plant a tree:content');

  await page.getByTestId('toolbar-outdent').tap();
  await page.getByTestId('toolbar-move-up').tap();
  expect(await outline(page, 'Someday')).toEqual(['Plant a tree', 'Learn to juggle']);
  await expect(page.locator('.ProseMirror')).toBeFocused();

  await page.getByTestId('toolbar-undo').tap();
  expect(await outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree']);

  await page.getByTestId('toolbar-note').tap();
  expect(await focused(page)).toBe('Plant a tree:note');
  await page.getByTestId('toolbar-note').tap();
  expect(await focused(page)).toBe('Plant a tree:content');

  await page.getByTestId('toolbar-done').tap();
  expect(await focused(page)).toBeNull();
  await expect(page.getByTestId('mobile-toolbar')).toHaveCount(0);
});

test('the node menu opens as a bottom sheet from the toolbar', async ({ page }) => {
  await gotoHome(page);
  await expect(page.getByTestId('drag-grip').first()).toBeHidden();
  await row(page, 'Learn to juggle').locator('.node-content').first().tap();
  await page.getByTestId('toolbar-more').tap();
  const menu = page.getByTestId('node-menu');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.round(box.y + box.height)).toBe(844);
  expect(await hitAtCenter(page, '[data-testid=node-menu-delete]')).toBe(true);
  await page.getByTestId('node-menu-delete').tap();
  expect(await outline(page, 'Someday')).toEqual(['Plant a tree']);
  await expect(menu).toHaveCount(0);
});

test('search has a button, since phones have no Ctrl+K', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('button', { name: 'Find' }).tap();
  await expect(page.getByTestId('search-palette')).toBeVisible();
});
