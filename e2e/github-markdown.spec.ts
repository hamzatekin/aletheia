import { expect, test, type Page } from '@playwright/test';
import { gotoHome, nodeByText, row } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

function setNote(page: Page, note: string): Promise<void> {
  return page.evaluate((note) => {
    const { engine } = (window as any).__aletheia;
    const node = [...engine.tree.all()].find((n: any) => n.content === 'Plant a tree');
    engine.execute({ type: 'updateNote', id: node.id, note });
  }, note);
}

const savedNote = async (page: Page) => (await nodeByText(page, 'Plant a tree'))?.note;

// The kind of answer Claude Code writes, with GitHub's extras.
const AGENT_NOTE = [
  '## Summary',
  '',
  'Fixed in `src/app.ts`, see https://example.com/docs :tada:',
  '',
  '> [!WARNING]',
  '> This deletes `node_modules`.',
  '',
  '1. Renamed `foo_bar` [1]',
  '2. Press <kbd>Ctrl</kbd>+<kbd>C</kbd>',
  '',
  '| File | Lines |',
  '|------|------:|',
  '| `b.ts` | -3<br>+4 |',
  '',
  '```ts',
  'const sum = 1 + 2; // three',
  '```',
  '',
  '![diagram](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)',
  '',
  '<details>',
  '<summary>Full log</summary>',
  '',
  'Some log text.',
  '',
  '</details>',
  '',
  'Footnote[^1] and <Component> in prose.',
  '',
  '[^1]: The footnote.',
].join('\n');

test('a note from an agent renders as on GitHub', async ({ page }) => {
  await setNote(page, AGENT_NOTE);
  const note = row(page, 'Plant a tree').locator('.node-note');
  await expect(note.locator('a[href="https://example.com/docs"]')).toHaveAttribute('target', '_blank');
  await expect(note).toContainText('🎉');
  await expect(note.locator('blockquote.markdown-alert-warning .markdown-alert-title')).toHaveText('Warning');
  await expect(note.locator('li').first()).toHaveText('Renamed foo_bar [1]');
  await expect(note.locator('kbd')).toHaveText(['Ctrl', 'C']);
  await expect(note.locator('th').nth(1)).toHaveCSS('text-align', 'right');
  await expect(note.locator('td br')).toHaveCount(1);
  await expect(note.locator('pre code .hljs-keyword')).toHaveText('const');
  await expect(note.locator('img[alt=diagram]')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(note.locator('details summary')).toHaveText('Full log');
  await expect(note.locator('.footnote-ref a')).toHaveText('[1]');
  await expect(note.locator('.footnotes li')).toContainText('The footnote.');
  await expect(note).toContainText('<Component> in prose.');
});

test('HTML in a note cannot run script or restyle the page', async ({ page }) => {
  await setNote(page, '<img src="x" onerror="window.__pwned = 1">\n\n<p style="position:fixed;inset:0" class="fixed inset-0">cover</p>\n\n<a href="javascript:alert(1)">bad</a>');
  const note = row(page, 'Plant a tree').locator('.node-note');
  await expect(note.locator('p', { hasText: 'cover' })).toHaveCount(1);
  expect(await note.innerHTML()).not.toMatch(/onerror|style=|fixed|javascript:/);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
});

test('editing one part of an agent note leaves every other part exactly as it was', async ({ page }) => {
  await setNote(page, AGENT_NOTE);
  await row(page, 'Plant a tree').locator('.node-note h2').click();
  const editor = page.locator('.ProseMirror[data-editor=note]');
  await expect(editor.locator('img[alt=diagram]')).toHaveCount(1);
  await expect(editor.locator('blockquote.markdown-alert-warning .markdown-alert-title')).toHaveText('[!WARNING]');
  await expect(editor.locator('pre code .hljs-keyword')).toHaveText('const');
  await page.keyboard.press('End');
  await page.keyboard.type(' today');
  await page.keyboard.press('Escape');
  await expect.poll(() => savedNote(page)).toBe(AGENT_NOTE.replace('## Summary', '## Summary today'));
});

test('editing inside GitHub extras keeps them working', async ({ page }) => {
  await setNote(page, AGENT_NOTE);
  const note = row(page, 'Plant a tree').locator('.node-note');
  // In the alert: the marker stays (it may share the line), the brackets stay bare.
  await note.getByText('This deletes').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Twice');
  await page.keyboard.press('Escape');
  await expect.poll(() => savedNote(page)).toContain('> [!WARNING] This deletes `node_modules`. Twice\n');
  await expect(note.locator('blockquote.markdown-alert-warning')).toContainText('Twice');

  // In the list: "[1]" stays as typed, and so does the HTML.
  await note.getByText('Renamed').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' now');
  await page.keyboard.press('Escape');
  await expect.poll(() => savedNote(page)).toContain('1. Renamed `foo_bar` [1] now\n2. Press <kbd>Ctrl</kbd>+<kbd>C</kbd>\n');

  // In the table: the column stays right-aligned and "-3" is not escaped.
  await note.locator('td').nth(1).click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  await expect.poll(() => savedNote(page)).toContain('| File | Lines |\n| --- | ---: |\n| `b.ts` | -3<br>+4! |');
  await expect(note.locator('td br')).toHaveCount(1);

  // The image, the details and the footnote never changed.
  const saved = (await savedNote(page))!;
  for (const part of ['![diagram](data:image/gif;base64,', '<details>\n<summary>Full log</summary>', '[^1]: The footnote.']) expect(saved).toContain(part);
});
