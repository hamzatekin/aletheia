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

test('settings dock on the right like the outline and keep the page usable', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const panel = page.getByTestId('settings-panel');
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(Math.round(box.x + box.width)).toBe(1280);
  expect(box.height).toBe(800);
  // The top-right buttons move over beside the panel.
  const gear = (await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox())!;
  expect(gear.x + gear.width).toBeLessThanOrEqual(box.x);
  // Clicking the page leaves it open, so changes can be watched live.
  await page.locator('.row-text', { hasText: 'Plant a tree' }).first().click();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('outline-sidebar')).toBeVisible();
  await panel.getByRole('button', { name: 'Hide settings' }).click();
  await expect(panel).toBeHidden();
});
