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

test('Backspace on an empty node with children deletes it and moves the children up', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await setCaret(page, 'end');
  await page.keyboard.press('Enter');
  await page.keyboard.type('water it');
  await page.keyboard.press('Tab');
  await edit(page, 'Plant a tree');
  await setCaret(page, 'end');
  for (let i = 0; i < 'Plant a tree'.length; i++) await page.keyboard.press('Backspace');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', ['', ['water it']]]);
  await page.keyboard.press('Backspace');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'water it']);
  expect(await focused(page)).toBe('Learn to juggle:content');
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
  await expect(page.locator('[data-node-id][data-selected]')).toHaveCount(2);
  await page.keyboard.press('Backspace');
  await expect.poll(() => outline(page, 'Someday')).toEqual([]);
  await page.keyboard.press('Control+z'); // undo in selection mode keeps selection mode
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree']);
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  await expect(page.locator('[data-node-id][data-selected]')).toHaveCount(1);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Tab'); // first selected has no previous sibling → skipped; second indents under it
  await expect.poll(() => outline(page, 'Someday')).toEqual([['Learn to juggle', ['Plant a tree']]]);
  await page.keyboard.press('Enter'); // edit the selection head
  await expect.poll(() => focused(page)).toBe('Plant a tree:content');
});

test('notes are edited rendered: Markdown shortcuts format as you type and save as Markdown', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.press('Shift+Enter');
  const note = page.locator('[data-editor=note]');
  await expect(note).toBeFocused();
  await page.keyboard.type('## Plan');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- dig a **hole** ');
  await expect(note.locator('h2')).toHaveText('Plan');
  await expect(note.locator('li strong')).toHaveText('hole');
  await page.keyboard.press('Escape');
  await expect.poll(() => focused(page)).toBe('Plant a tree:content');
  const stored = await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    return [...engine.tree.all()].find((n: any) => n.content === 'Plant a tree')?.note;
  });
  expect(stored).toBe('## Plan\n\n- dig a **hole**');
});

test('the note toggle switches between rendered and raw Markdown', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('some **bold**');
  const toggle = page.locator('[data-node-id]', { hasText: 'Plant a tree' }).first().locator('[data-testid=note-mode-toggle]');
  await expect(toggle).toHaveAttribute('title', 'Rendered. Click to edit as Markdown');
  await toggle.click();
  const raw = page.locator('textarea[data-editor=note]');
  await expect(raw).toBeFocused();
  await expect(raw).toHaveValue('some **bold**');
  await page.keyboard.type(' and *more*');
  await expect(toggle).toHaveAttribute('title', 'Markdown. Click to edit rendered');
  await toggle.click();
  const rich = page.locator('.ProseMirror[data-editor=note]');
  await expect(rich.locator('em')).toHaveText('more');
  // The choice sticks for the next note.
  await page.keyboard.press('Escape');
  await edit(page, 'Learn to juggle');
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('.ProseMirror[data-editor=note]')).toBeFocused();
});

test('a note collapses to its first line and expands again', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('first line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second line');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const row = page.locator('[data-node-id]', { hasText: 'Plant a tree' }).first();
  await row.hover();
  await row.locator('[data-testid=note-toggle]').click();
  await expect(row.locator('.node-note')).toHaveText('first line …');
  await page.reload();
  await expect(page.locator('[data-node-id]', { hasText: 'Plant a tree' }).first().locator('.node-note')).toHaveText('first line …');
  await page.locator('[data-node-id]', { hasText: 'Plant a tree' }).first().locator('[data-testid=note-toggle]').click();
  await expect(page.locator('[data-node-id]', { hasText: 'Plant a tree' }).first().locator('.node-note p')).toHaveCount(2);
});

test('a note starts right under its node, and opening or leaving it moves nothing', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('first paragraph');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');
  await page.keyboard.type('some code');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const listId = await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    const node = [...engine.tree.all()].find((n: any) => n.content !== 'Plant a tree' && n.note === '' && n.content !== '');
    engine.execute({ type: 'updateNote', id: node.id, note: '- one item\n- another item' });
    return node.id as string;
  });
  const row = page.locator('[data-node-id]', { hasText: 'Plant a tree' }).first();
  const viewNote = row.locator('.node-note');
  const before = (await viewNote.boundingBox())!;
  const header = (await row.locator('.note-header').boundingBox())!;
  // The note starts right under its node's text, level with the mode icon.
  const content = (await row.locator('.node-content').boundingBox())!;
  expect(before.y - (content.y + content.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(header.y - before.y)).toBeLessThanOrEqual(2);
  // A note with a list moves nothing either.
  const listRow = page.locator(`[data-node-id="${listId}"]`);
  const listBefore = (await listRow.locator('.node-note').boundingBox())!;
  await listRow.locator('.node-note li').last().click();
  await expect(page.locator('.ProseMirror[data-editor=note]')).toBeFocused();
  const listAfter = (await page.locator('.ProseMirror[data-editor=note]').boundingBox())!;
  expect(Math.abs(listAfter.y - listBefore.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(listAfter.height - listBefore.height)).toBeLessThanOrEqual(2);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await viewNote.locator('p').click();
  const editNote = page.locator('.ProseMirror[data-editor=note]');
  await expect(editNote).toBeFocused();
  const after = (await editNote.boundingBox())!;
  const headerAfter = (await row.locator('.note-header').boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(headerAfter.y - header.y)).toBeLessThanOrEqual(1);
});

test('opening a long note or switching its mode never scrolls the page', async ({ page }) => {
  const long = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n\n');
  await page.evaluate((note) => {
    const { engine } = (window as any).__aletheia;
    const node = [...engine.tree.all()].find((n: any) => n.content === 'Learn to juggle');
    engine.execute({ type: 'updateNote', id: node.id, note });
  }, long);
  const row = page.locator('[data-node-id]', { hasText: 'Learn to juggle' }).first();
  // Header in view at the top, the rest of the long note running off the bottom.
  await row.locator('.note-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const line = row.locator('.node-note p', { hasText: /^line 8$/ });
  const before = await page.evaluate(() => window.scrollY);
  await line.click();
  await expect(page.locator('.ProseMirror[data-editor=note]')).toBeFocused();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  // The caret landed on the clicked line, not at the end of the note.
  expect(await page.evaluate(() => window.getSelection()!.anchorNode!.textContent)).toBe('line 8');

  const toggle = row.locator('[data-testid=note-mode-toggle]');
  await toggle.click();
  await expect(page.locator('textarea[data-editor=note]')).toBeFocused();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await toggle.click();
  await expect(page.locator('.ProseMirror[data-editor=note]')).toBeFocused();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});
