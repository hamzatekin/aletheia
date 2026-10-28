import { expect, test, type Page } from '@playwright/test';
import { focused, gotoHome, nodeByText, row } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

function setNote(page: Page, note: string, item = 'Plant a tree'): Promise<void> {
  return page.evaluate(([note, item]) => {
    const { engine } = (window as any).__aletheia;
    const node = [...engine.tree.all()].find((n: any) => n.content === item);
    engine.execute({ type: 'updateNote', id: node.id, note });
  }, [note, item]);
}

const savedNote = async (page: Page) => (await nodeByText(page, 'Plant a tree'))?.note;

// The kind of answer Claude Code writes.
const AGENT_NOTE = [
  '## Summary',
  '',
  'Fixed in `src/app.ts`, see https://example.com/docs',
  '',
  '1. Renamed `foo_bar` [1]',
  '2. Press Ctrl+C',
  '',
  '| File | Lines |',
  '|------|------:|',
  '| `b.ts` | -3 |',
  '',
  '```ts',
  'const sum = 1 + 2; // three',
  '```',
  '',
  '![diagram](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)',
  '',
  'A <Component> in prose.',
].join('\n');

test('a note from an agent renders its Markdown', async ({ page }) => {
  await setNote(page, AGENT_NOTE);
  const note = row(page, 'Plant a tree').locator('.node-note');
  await expect(note.locator('a[href="https://example.com/docs"]')).toHaveAttribute('target', '_blank');
  await expect(note.locator('li').first()).toHaveText('Renamed foo_bar [1]');
  await expect(note.locator('th').nth(1)).toHaveCSS('text-align', 'right');
  await expect(note.locator('pre code')).toHaveText('const sum = 1 + 2; // three');
  await expect(note.locator('img[alt=diagram]')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(note).toContainText('A <Component> in prose.');
});

test('HTML in a note shows as text and cannot run script', async ({ page }) => {
  await setNote(page, '<img src="x" onerror="window.__pwned = 1">\n\n<p style="position:fixed;inset:0">cover</p>\n\n<a href="javascript:alert(1)">bad</a>');
  const note = row(page, 'Plant a tree').locator('.node-note');
  await expect(note.locator('p')).toHaveText(['<img src="x" onerror="window.__pwned = 1">', '<p style="position:fixed;inset:0">cover</p>', '<a href="javascript:alert(1)">bad</a>']);
  await expect(note.locator('img, [style], a')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
});

test('editing one part of an agent note leaves every other part exactly as it was', async ({ page }) => {
  await setNote(page, AGENT_NOTE);
  await row(page, 'Plant a tree').locator('.node-note h2').click();
  const editor = page.locator('.ProseMirror[data-editor=note]');
  await expect(editor.locator('img[alt=diagram]')).toHaveCount(1);
  await page.keyboard.press('End');
  await page.keyboard.type(' today');
  await page.keyboard.press('Escape');
  await expect.poll(() => savedNote(page)).toBe(AGENT_NOTE.replace('## Summary', '## Summary today'));
});

test('editing inside a list or a table keeps the rest of it as written', async ({ page }) => {
  await setNote(page, AGENT_NOTE);
  const note = row(page, 'Plant a tree').locator('.node-note');
  // In the list: "[1]" stays as typed.
  await note.getByText('Renamed').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' now');
  await page.keyboard.press('Escape');
  await expect.poll(() => savedNote(page)).toContain('1. Renamed `foo_bar` [1] now\n2. Press Ctrl+C\n');

  // In the table: the column stays right-aligned and "-3" is not escaped.
  await note.locator('td').nth(1).click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  await expect.poll(() => savedNote(page)).toContain('| File | Lines |\n| --- | ---: |\n| `b.ts` | -3! |');

  // The image never changed.
  expect(await savedNote(page)).toContain('![diagram](data:image/gif;base64,');
});

/** Clicks into the table's first header cell and waits for the editor to take the caret there. */
async function clickFirstHeader(page: Page, { start = false } = {}): Promise<void> {
  await page.locator('.ProseMirror[data-editor=note] th').first().click();
  if (start) await page.keyboard.press('Home');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { state } = (document.querySelector('.ProseMirror[data-editor=note]') as any).editor;
        return state.selection.$from.parent.type.name === 'paragraph' && state.selection.$from.node(-1).type.name === 'tableHeader' && state.selection.from === 4;
      }),
    )
    .toBe(true);
}

const TABLE_NOTE = ['| Saved ranking | Rows |', '| --- | ---: |', '| National | 11,167 |', '| By location | 126,300 |'].join('\n');

test('Enter at the start of a table or in its last row adds a line above or below it', async ({ page }) => {
  await setNote(page, TABLE_NOTE);
  const note = row(page, 'Plant a tree').locator('.node-note');
  await note.getByText('126,300').click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Below');
  await expect.poll(() => savedNote(page)).toBe(`${TABLE_NOTE}\n\nBelow`);

  await clickFirstHeader(page, { start: true });
  await page.keyboard.press('Enter');
  await page.keyboard.type('Above');
  await page.keyboard.press('Escape');
  await expect.poll(() => savedNote(page)).toBe(`Above\n\n${TABLE_NOTE}\n\nBelow`);
});

test('the arrow keys step out of a table onto a new line', async ({ page }) => {
  await setNote(page, TABLE_NOTE);
  const note = row(page, 'Plant a tree').locator('.node-note');
  await note.getByText('126,300').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.ProseMirror[data-editor=note] .ProseMirror-gapcursor')).toHaveCount(1);
  await page.keyboard.type('Below');
  await expect.poll(() => savedNote(page)).toBe(`${TABLE_NOTE}\n\nBelow`);

  await clickFirstHeader(page, { start: true });
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('Above');
  await expect.poll(() => savedNote(page)).toBe(`Above\n\n${TABLE_NOTE}\n\nBelow`);
});

test('from the gap beside a table that opens or ends the note, the arrow keys leave the note', async ({ page }) => {
  await setNote(page, TABLE_NOTE, 'Learn to juggle');
  await row(page, 'Learn to juggle').locator('.node-note').getByText('126,300').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.ProseMirror[data-editor=note] .ProseMirror-gapcursor')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focused(page)).toBe('Plant a tree:content');

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focused(page)).toBe('Learn to juggle:note');
  await clickFirstHeader(page, { start: true });
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.ProseMirror[data-editor=note] .ProseMirror-gapcursor')).toHaveCount(1);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focused(page)).toBe('Learn to juggle:content');
  expect((await nodeByText(page, 'Learn to juggle'))?.note).toBe(TABLE_NOTE);
});
