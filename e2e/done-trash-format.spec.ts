import { expect, test, type Page } from '@playwright/test';
import { edit, gotoHome, openNodeMenu, reloadApp, row } from './helpers';

// Wide enough that settings dock beside the page.
test.use({ viewport: { width: 1280, height: 800 } });
test.beforeEach(async ({ page }) => gotoHome(page));

const field = (page: Page, text: string, key: 'completedAt' | 'heading' | 'color' | 'deletedAt') =>
  page.evaluate(
    ([text, key]) => {
      const n = [...(window as any).__aletheia.engine.tree.all()].find((n: any) => n.content === text);
      return n ? (n[key!] ?? null) : undefined;
    },
    [text, key] as const,
  );

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
};

test('Ctrl+Enter completes the row being edited, Ctrl+O hides done rows and the caret moves on', async ({ page }) => {
  await edit(page, 'Learn to juggle');
  await page.keyboard.press('Control+Enter');
  await expect(row(page, 'Learn to juggle')).toHaveAttribute('data-done', 'true');
  expect(await field(page, 'Learn to juggle', 'completedAt')).toBeGreaterThan(0);
  await expect(row(page, 'Learn to juggle').locator('.row-text .node-content:not(.ProseMirror)')).toHaveCSS('text-decoration-line', 'line-through');

  // Again: not done.
  await page.keyboard.press('Control+Enter');
  await expect(row(page, 'Learn to juggle')).not.toHaveAttribute('data-done');
  await page.keyboard.press('Control+Enter');

  await page.keyboard.press('Control+o');
  await expect(row(page, 'Learn to juggle')).toHaveCount(0);
  await expect(row(page, 'Plant a tree')).toBeVisible();
  // Completing the row being edited while done rows are hidden moves the caret to the next one.
  await edit(page, 'Rendering and zoom');
  await page.keyboard.press('Control+Enter');
  await expect(row(page, 'Rendering and zoom')).toHaveCount(0);
  await expect(page.locator('[data-focused=content]')).toContainText('Editor and keyboard');

  // Hidden stays hidden after a reload; Settings shows them again.
  await page.waitForTimeout(600);
  await reloadApp(page);
  await expect(row(page, 'Learn to juggle')).toHaveCount(0);
  await openSettings(page);
  await page.getByLabel('Show completed').check();
  await expect(row(page, 'Learn to juggle')).toHaveAttribute('data-done', 'true');
  await expect(row(page, 'Rendering and zoom')).toHaveAttribute('data-done', 'true');
});

test('the node menu completes a row, and with rows selected Ctrl+Enter completes them all', async ({ page }) => {
  await openNodeMenu(page, 'Plant a tree');
  await page.getByTestId('node-menu-complete').click();
  await expect(row(page, 'Plant a tree')).toHaveAttribute('data-done', 'true');
  await openNodeMenu(page, 'Plant a tree');
  await expect(page.getByTestId('node-menu-complete')).toHaveText(/Mark not done/);
  await page.keyboard.press('Escape');

  await edit(page, 'Data model and commands');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Control+Enter');
  await expect(row(page, 'Data model and commands')).toHaveAttribute('data-done', 'true');
  await expect(row(page, 'Rendering and zoom')).toHaveAttribute('data-done', 'true');
  // All selected are done: Ctrl+Enter marks them not done.
  await page.keyboard.press('Control+Enter');
  await expect(row(page, 'Data model and commands')).not.toHaveAttribute('data-done');
  await expect(row(page, 'Rendering and zoom')).not.toHaveAttribute('data-done');
});

test('headings and color labels come from the node menu, and picking one again clears it', async ({ page }) => {
  const r = row(page, 'Projects');
  const before = (await r.locator('.row-text .node-content:not(.ProseMirror)').boundingBox())!.height;
  await openNodeMenu(page, 'Projects');
  await page.getByTestId('node-menu-h1').click();
  await expect(r).toHaveAttribute('data-heading', '1');
  expect((await r.locator('.row-text .node-content:not(.ProseMirror)').boundingBox())!.height).toBeGreaterThan(before * 1.3);
  await expect(r.locator('.row-text .node-content:not(.ProseMirror)')).toHaveCSS('font-weight', '700');
  await expect(r.locator('.row-text .node-content:not(.ProseMirror)')).toHaveCSS('font-size', '27px');
  // Editing it keeps the same size (the editor sits inside the row's text).
  await edit(page, 'Projects');
  await expect(page.locator('.ProseMirror')).toHaveCSS('font-size', '27px');
  await page.keyboard.press('Escape');

  await openNodeMenu(page, 'Projects');
  await expect(page.getByTestId('node-menu-h1')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('node-menu-color-green').click();
  await expect(r).toHaveAttribute('data-color', 'green');
  expect(await field(page, 'Projects', 'heading')).toBe(1);
  expect(await field(page, 'Projects', 'color')).toBe('green');
  await expect(r.locator('.row-text .node-content:not(.ProseMirror)')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  await page.waitForTimeout(600);
  await reloadApp(page);
  await expect(row(page, 'Projects')).toHaveAttribute('data-heading', '1');
  await openNodeMenu(page, 'Projects');
  await page.getByTestId('node-menu-h1').click();
  await openNodeMenu(page, 'Projects');
  await page.getByTestId('node-menu-color-green').click();
  await expect(row(page, 'Projects')).not.toHaveAttribute('data-heading');
  await expect(row(page, 'Projects')).not.toHaveAttribute('data-color');
});

test('Recently deleted lists what was deleted and restores it in place, with its children', async ({ page }) => {
  await openNodeMenu(page, 'Someday');
  await page.getByTestId('node-menu-delete').click();
  await expect(row(page, 'Someday')).toHaveCount(0);

  await openSettings(page);
  await page.getByTestId('trash-toggle').click();
  const item = page.getByTestId('trash-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Someday');
  await expect(item).toContainText('2 inside');
  await item.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByTestId('trash-empty')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Restored “Someday”.');
  await expect(row(page, 'Someday')).toBeVisible();
  await expect(row(page, 'Learn to juggle')).toBeVisible();
  expect(await field(page, 'Someday', 'deletedAt')).toBeNull();
});
