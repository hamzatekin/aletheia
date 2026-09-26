import { expect, test } from '@playwright/test';
import { gotoHome } from './helpers';

test.use({ viewport: { width: 1280, height: 800 } });

test('settings change the look live and survive a reload', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sepia' }).click();
  await page.getByLabel('Font size').fill('22');
  const row = page.locator('.row-text').first();
  await expect(row).toHaveCSS('font-size', '22px');
  await page.reload();
  await page.locator('[data-testid=outline]').waitFor();
  await expect(page.locator('.row-text').first()).toHaveCSS('font-size', '22px');
  await expect(page.locator('.book-page')).toHaveCSS('background-color', 'rgb(245, 236, 217)');
});

test('outline sidebar zooms into a node and can be hidden', async ({ page }) => {
  await gotoHome(page);
  const sidebar = page.getByTestId('outline-sidebar');
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/n\//);
  await expect(page.locator('h1.page-title')).toHaveText('Projects');
  await page.keyboard.press('Control+\\');
  await expect(sidebar).toBeHidden();
  await page.getByRole('button', { name: 'Show outline' }).click();
  await expect(sidebar).toBeVisible();
});
