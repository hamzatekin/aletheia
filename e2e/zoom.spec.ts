import { expect, test, type Page } from '@playwright/test';
import { edit, focused, gotoHome, outline, row, rowCount } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

/** The zoom title, whether static or being edited. */
const title = (page: Page) => page.locator('header[data-title]');

test('bullet zooms in, breadcrumbs and back zoom out, title is editable', async ({ page }) => {
  await row(page, 'Write the outliner').getByRole('link', { name: 'Zoom in' }).click();
  await expect(page).toHaveURL(/\/n\//);
  await expect(title(page)).toHaveText('Write the outliner');
  await expect(page).toHaveTitle('Write the outliner');
  await expect.poll(() => rowCount(page)).toBe(4);
  await expect(page.locator('nav[aria-label=Breadcrumbs]')).toContainText('Home');
  await expect(page.locator('nav[aria-label=Breadcrumbs]')).toContainText('Projects');

  await title(page).click();
  await page.keyboard.type('!');
  await expect.poll(() => outline(page, 'Projects')).toContainEqual(['Write the outliner!', expect.anything()]);

  await page.locator('nav[aria-label=Breadcrumbs] a', { hasText: 'Projects' }).click();
  await expect(title(page)).toHaveText('Projects');
  await page.goBack();
  await expect(title(page)).toHaveText('Write the outliner!');
  await page.locator('nav[aria-label=Breadcrumbs] a', { hasText: 'Home' }).click();
  await expect(page).toHaveURL('/');
});

test('Ctrl+. zooms into the focused node and Ctrl+, zooms out', async ({ page }) => {
  await edit(page, 'Reading list');
  await page.keyboard.press('Control+.');
  await expect(title(page)).toHaveText('Reading list');
  expect(await focused(page)).toBe('Reading list:content');
  await page.keyboard.press('Control+,');
  await expect(title(page)).toHaveText('Projects');
  await page.keyboard.press('Control+,');
  await expect(page).toHaveURL('/');
});

test('an empty zoomed page offers to create the first node; unknown ids show not found', async ({ page }) => {
  await row(page, 'Plant a tree').getByRole('link', { name: 'Zoom in' }).click();
  await page.locator('[data-testid=empty-outline]').click();
  await page.keyboard.type('a child');
  await expect.poll(() => outline(page, 'Plant a tree')).toEqual(['a child']);
  await page.goto('/n/nope');
  await expect(page.locator('main')).toContainText('This node does not exist');
});
