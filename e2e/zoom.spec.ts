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

test('the back arrow goes up one level, and the crumbs line up with the title', async ({ page }) => {
  await row(page, 'Write the outliner').getByRole('link', { name: 'Zoom in' }).click();
  await expect(title(page)).toHaveText('Write the outliner');
  const textX = (selector: string) =>
    page.locator(selector).first().evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().x;
    });
  expect(Math.abs((await textX('nav[aria-label=Breadcrumbs] a')) - (await textX('header[data-title] h1')))).toBeLessThan(1);

  const back = page.getByTestId('zoom-out');
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute('aria-label', 'Back to Projects');
  await back.click();
  await expect(title(page)).toHaveText('Projects');
  await expect(back).toHaveAttribute('aria-label', 'Back to Home');
  await back.click();
  await expect(page).toHaveURL('/');
  await expect(back).toHaveCount(0);
});

test('zooming in starts the new page at its top', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 400 });
  await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    for (let i = 1; i <= 30; i++) engine.execute({ type: 'createNode', id: `filler-${i}`, parentId: null, at: 'last', content: `Filler ${i}` });
  });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await row(page, 'Filler 30').getByRole('link', { name: 'Zoom in' }).click();
  await expect(title(page)).toHaveText('Filler 30');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
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

test('the top-bar button and Ctrl+Shift+. collapse and expand everything on the page', async ({ page }) => {
  const toggle = page.getByTestId('toggle-all');
  await expect(toggle).toHaveAttribute('aria-label', 'Collapse all');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'Expand all');
  await expect(page.locator('[data-node-id]', { hasText: 'Write the outliner' })).toHaveCount(0);
  await toggle.click();
  await expect(page.locator('[data-node-id]', { hasText: 'Drag and drop' })).toHaveCount(1);

  // Collapsing a nested node first still expands everything below it again.
  await page.keyboard.press('Control+Shift+Period');
  await expect(toggle).toHaveAttribute('aria-label', 'Expand all');
  await page.keyboard.press('Control+Shift+Period');
  await expect(page.locator('[data-node-id]', { hasText: 'Drag and drop' })).toHaveCount(1);
});

test('the node menu collapses and expands everything inside one node', async ({ page }) => {
  const projects = page.locator('[data-node-id]', { hasText: 'Projects' }).first();
  await projects.hover();
  await projects.getByTestId('drag-grip').click();
  await page.getByTestId('node-menu-collapse-all').click();
  await expect(page.locator('[data-node-id]', { hasText: 'Write the outliner' })).toHaveCount(0);
  // Other top-level nodes stay open.
  await expect(page.locator('[data-node-id]', { hasText: 'Learn to juggle' })).toHaveCount(1);
  await projects.hover();
  await projects.getByTestId('drag-grip').click();
  await page.getByTestId('node-menu-expand-all').click();
  await expect(page.locator('[data-node-id]', { hasText: 'Drag and drop' })).toHaveCount(1);
});
