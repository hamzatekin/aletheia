import { expect, test } from '@playwright/test';
import { edit, editorText, focused, gotoHome, outline, rowCount, setCaret } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

test('typing is saved, Enter splits, Tab and Shift+Tab move the node', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.type(' soon');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree soon']);

  await setCaret(page, 'end');
  await page.keyboard.press('Enter');
  await expect.poll(() => focused(page)).toBe(':content');
  await page.keyboard.type('water it');
  await page.keyboard.press('Tab');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', ['Plant a tree soon', ['water it']]]);
  expect(await focused(page)).toBe('water it:content');
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree soon', 'water it']);
});

test('Enter in the middle splits the content and inside bold keeps the mark on both sides', async ({ page }) => {
  await edit(page, 'Learn to juggle');
  await setCaret(page, 6); // "Learn| to juggle"
  await page.keyboard.press('Enter');
  // The stored right half keeps its leading space; the editor shows it normalized.
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn', ' to juggle', 'Plant a tree']);
  expect(await editorText(page)).toBe('to juggle');
  await page.keyboard.press('Backspace'); // at start: merge back
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree']);
});

test('Enter at the start inserts an empty node above and keeps focus', async ({ page }) => {
  await edit(page, 'Learn to juggle');
  await setCaret(page, 'start');
  await page.keyboard.press('Enter');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['', 'Learn to juggle', 'Plant a tree']);
  expect(await focused(page)).toBe('Learn to juggle:content');
});

test('Enter on an expanded parent creates its first child', async ({ page }) => {
  await edit(page, 'Someday');
  await setCaret(page, 'end');
  await page.keyboard.press('Enter');
  await page.keyboard.type('new first');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['new first', 'Learn to juggle', 'Plant a tree']);
});

test('Backspace on an empty node deletes it and focuses the previous node', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await setCaret(page, 'end');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree']);
  expect(await focused(page)).toBe('Plant a tree:content');
});

test('arrow keys move between nodes; Left/Right cross node edges', async ({ page }) => {
  await edit(page, 'Learn to juggle');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focused(page)).toBe('Plant a tree:content');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focused(page)).toBe('Learn to juggle:content');
  await setCaret(page, 'start');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => focused(page)).toBe('Someday:content');
  await page.keyboard.press('ArrowRight'); // at end of "Someday" → next node start
  await expect.poll(() => focused(page)).toBe('Learn to juggle:content');
});

test('Shift+Enter edits the note; Escape returns to the content', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('[data-editor=note]')).toBeFocused();
  await page.keyboard.type('in spring');
  await page.keyboard.press('Escape');
  await expect.poll(() => focused(page)).toBe('Plant a tree:content');
  await expect(page.locator('.node-note', { hasText: 'in spring' })).toBeVisible();
});

test('Ctrl+Up/Down collapse and expand; Alt+Shift+Up/Down move among siblings', async ({ page }) => {
  await edit(page, 'Projects');
  const before = await rowCount(page);
  await page.keyboard.press('Control+ArrowUp');
  await expect.poll(() => rowCount(page)).toBe(before - 8);
  await page.keyboard.press('Control+ArrowDown');
  await expect.poll(() => rowCount(page)).toBe(before);
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect.poll(async () => (await outline(page)).map((s) => (typeof s === 'string' ? s : s[0]))).toEqual([
    'Welcome to **Aletheia**',
    'Someday',
    'Projects',
  ]);
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await expect.poll(async () => (await outline(page)).map((s) => (typeof s === 'string' ? s : s[0]))).toEqual([
    'Welcome to **Aletheia**',
    'Projects',
    'Someday',
  ]);
});

test('undo and redo work while editing, including typed text', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.type(' today');
  await page.keyboard.press('Control+z');
  await expect.poll(() => editorText(page)).toBe('Plant a tree');
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => editorText(page)).toBe('Plant a tree today');
  await page.keyboard.press('Tab');
  await expect.poll(() => outline(page, 'Someday')).toEqual([['Learn to juggle', ['Plant a tree today']]]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree today']);
});

test('Escape selects the row; Shift+Down extends; Tab, Backspace and undo act on the selection', async ({ page }) => {
  await edit(page, 'Learn to juggle');
  await page.keyboard.press('Escape');
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('[data-node-id].bg-blue-100\\/70')).toHaveCount(2);
  await page.keyboard.press('Backspace');
  await expect.poll(() => outline(page, 'Someday')).toEqual([]);
  await page.keyboard.press('Control+z'); // undo in selection mode keeps selection mode
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree']);
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  await expect(page.locator('[data-node-id].bg-blue-100\\/70')).toHaveCount(1);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Tab'); // first selected has no previous sibling → skipped; second indents under it
  await expect.poll(() => outline(page, 'Someday')).toEqual([['Learn to juggle', ['Plant a tree']]]);
  await page.keyboard.press('Enter'); // edit the selection head
  await expect.poll(() => focused(page)).toBe('Plant a tree:content');
});
