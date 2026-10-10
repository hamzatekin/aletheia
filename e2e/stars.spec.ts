import { expect, test } from '@playwright/test';
import { gotoHome, openNodeMenu, reloadApp, row } from './helpers';

// Wide enough that the sidebar stays open beside the page.
test.use({ viewport: { width: 1280, height: 800 } });
test.beforeEach(async ({ page }) => gotoHome(page));

test('star a page from its title; it is listed in the sidebar and unstars from there', async ({ page }) => {
  await row(page, 'Reading list').locator('a[aria-label="Zoom in"]').click();
  await expect(page.locator('h1')).toHaveText('Reading list');
  await page.locator('header[data-title]').hover();
  await page.getByTestId('page-star').click();
  await expect(page.getByTestId('page-star')).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/');
  await page.locator('[data-testid=outline]').waitFor();
  if ((await page.getByTestId('outline-sidebar').count()) === 0) await page.getByRole('button', { name: 'Show outline' }).click();
  await expect(page.getByTestId('starred-item')).toHaveText(['Reading list']);
  await page.getByTestId('starred-item').click();
  await expect(page.locator('h1')).toHaveText('Reading list');

  await page.getByRole('button', { name: 'Unstar Reading list' }).click();
  await expect(page.getByTestId('starred-list')).toHaveCount(0);
  await expect(page.getByTestId('page-star')).toHaveAttribute('aria-pressed', 'false');
});

test('the node menu stars a node, and undo takes it back', async ({ page }) => {
  await openNodeMenu(page, 'Someday');
  await page.getByTestId('node-menu-star').click();
  if ((await page.getByTestId('outline-sidebar').count()) === 0) await page.getByRole('button', { name: 'Show outline' }).click();
  await expect(page.getByTestId('starred-item')).toHaveText(['Someday']);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('starred-list')).toHaveCount(0);
});

test('stars survive a reload', async ({ page }) => {
  await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    const id = [...engine.tree.all()].find((n: any) => n.content === 'Projects').id;
    engine.execute({ type: 'toggleStar', id, starred: true });
  });
  await page.waitForTimeout(600);
  await reloadApp(page);
  if ((await page.getByTestId('outline-sidebar').count()) === 0) await page.getByRole('button', { name: 'Show outline' }).click();
  await expect(page.getByTestId('starred-item')).toHaveText(['Projects']);
});
