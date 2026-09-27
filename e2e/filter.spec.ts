import { expect, test } from '@playwright/test';
import { focused, gotoHome } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

/** Text of the rows on screen, in order. */
const rows = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid=outline] [data-node-id]')]
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      .map((r) => (r.querySelector('.node-content') as HTMLElement).innerText.trim()),
  );

test('Ctrl+F filters the page to matches and the parents that lead to them', async ({ page }) => {
  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('filter-input')).toBeFocused();
  await page.keyboard.type('drag');
  await expect.poll(() => rows(page)).toEqual(['Projects', 'Write the outliner', 'Drag and drop']);
  await expect(page.getByTestId('filter-count')).toHaveText('1 match');
  // The matching word is highlighted.
  expect(await page.evaluate(() => CSS.highlights.get('search')?.size)).toBe(1);

  await page.getByTestId('filter-input').fill('xyzzy');
  await expect(page.getByTestId('no-matches')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter-bar')).toHaveCount(0);
  await expect.poll(async () => (await rows(page)).length).toBeGreaterThan(10);
});

test('a match hides its children until opened; toggling does not change the outline', async ({ page }) => {
  await page.getByRole('button', { name: 'Search' }).click();
  await page.keyboard.type('someday');
  await expect.poll(() => rows(page)).toEqual(['Someday']);
  const someday = page.locator('[data-node-id]', { hasText: 'Someday' }).first();
  await expect(someday.locator('.bullet-collapsed')).toHaveCount(1);
  await someday.hover();
  await someday.getByRole('button', { name: 'Expand' }).click();
  await expect.poll(() => rows(page)).toEqual(['Someday', 'Learn to juggle', 'Plant a tree']);
  const collapsed = await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    return [...engine.tree.all()].find((n: any) => n.content === 'Someday').collapsed;
  });
  expect(collapsed).toBe(false);
});

test('Enter edits the first match, and edited rows stay while the search is on', async ({ page }) => {
  await page.keyboard.press('Control+f');
  await page.keyboard.type('juggle');
  await page.keyboard.press('Enter');
  await expect.poll(() => focused(page)).toBe('Learn to juggle:content');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Buy balls');
  await expect.poll(() => rows(page)).toEqual(['Someday', 'Learn to juggle', 'Buy balls']);
  // Arrow keys move through the filtered rows only.
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focused(page)).toBe('Learn to juggle:content');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focused(page)).toBe('Someday:content');
});

test('zooming leaves the search', async ({ page }) => {
  await page.keyboard.press('Control+f');
  await page.keyboard.type('drag');
  await page.locator('[data-node-id]', { hasText: 'Write the outliner' }).first().locator('a[aria-label="Zoom in"]').click();
  await expect(page.locator('h1')).toHaveText('Write the outliner');
  await expect(page.getByTestId('filter-bar')).toHaveCount(0);
});
