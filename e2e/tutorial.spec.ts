import { expect, test } from '@playwright/test';
import { edit, gotoHome } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

test('the ? button opens the tutorial with tabs, Escape closes it', async ({ page }) => {
  await page.getByRole('button', { name: 'Tutorial', exact: true }).click();
  const dialog = page.getByTestId('tutorial');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Markdown' }).click();
  await expect(dialog.getByRole('heading', { name: 'Markdown' })).toBeVisible();
  await expect(dialog).toContainText('~~strike~~');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('Ctrl+/ and the /tutorial command open it while editing', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.press('Control+/');
  await expect(page.getByTestId('tutorial')).toBeVisible();
  await page.keyboard.press('Escape');
  await edit(page, 'Plant a tree');
  await page.keyboard.type(' /tutorial');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tutorial')).toBeVisible();
});
