import { expect, test } from '@playwright/test';
import { edit, focused, gotoHome, outline, rowCount } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

test('Ctrl+K search zooms to the parent and focuses the hit', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search').fill('drag drop');
  await expect(page.locator('[data-testid=search-hit]')).toHaveCount(1);
  await expect(page.locator('[data-testid=search-hit]').first()).toContainText('Projects › Write the outliner');
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toHaveText('Write the outliner');
  await expect.poll(() => focused(page)).toBe('Drag and drop:content');
});

test('search follows edits and Escape closes the palette', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.type(' xylophone');
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search').fill('xylo');
  await expect(page.locator('[data-testid=search-hit]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=search-palette]')).toHaveCount(0);
});

test('the slash menu filters commands and runs the selected one', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.type('/');
  await expect(page.locator('[data-testid=slash-menu]')).toBeVisible();
  await page.keyboard.type('collapse');
  await expect(page.locator('[data-testid=slash-item]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect.poll(() => rowCount(page)).toBe(3);
  await expect(page.locator('[data-testid=slash-menu]')).toHaveCount(0);
  // The query text was removed and focus moved to the visible ancestor.
  expect(await focused(page)).toBe('Someday:content');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree']);
  await page.keyboard.type('/expand');
  await page.keyboard.press('Enter');
  await expect.poll(() => rowCount(page)).toBe(16);
});

test('multi-line paste creates nested nodes as one undo step', async ({ page }) => {
  await edit(page, 'Learn to juggle');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '- alpha\n  - alpha child\n- beta');
    document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', ['alpha', ['alpha child']], 'beta', 'Plant a tree']);
  await page.keyboard.press('Control+z');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree']);
});

test('typing a URL does not open the slash menu and Enter still splits', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.type(' see https://example.com/a/b');
  await expect(page.locator('[data-testid=slash-menu]')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.keyboard.type('next');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree see https://example.com/a/b', 'next']);
});

test('Enter with an unmatched slash query splits instead of doing nothing', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.type(' 1/2');
  await page.keyboard.press('Enter');
  await page.keyboard.type('next');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree 1/2', 'next']);
});

test('typed Markdown link syntax becomes a link', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.type(' [docs](https://example.com)');
  await expect(page.locator('.ProseMirror a[href="https://example.com"]')).toHaveText('docs');
  await page.keyboard.press('Escape');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree [docs](https://example.com)']);
});

test('the slash menu sits above the rows below it', async ({ page }) => {
  await edit(page, 'Learn to juggle');
  await page.keyboard.type(' /');
  const menu = page.locator('[data-testid=slash-menu]');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const onTop = await page.evaluate(
    ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid=slash-menu]'),
    { x: box.x + 20, y: box.y + 12 },
  );
  expect(onTop).toBe(true);
});

test('a "/" inserted without a key event (mobile keyboards, other layouts) opens the menu', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.insertText(' /');
  await expect(page.locator('[data-testid=slash-menu]')).toBeVisible();
});
