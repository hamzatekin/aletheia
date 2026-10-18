import { expect, test, type Page } from '@playwright/test';
import { edit, editorText, gotoHome, nodeByText, outline, row, setCaret } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

/** Set an item's stored text directly, as an import, paste or Claude Code capture does. */
async function setContent(page: Page, text: string, content: string): Promise<void> {
  const node = (await nodeByText(page, text))!;
  await page.evaluate(
    ({ id, content }) => (window as any).__aletheia.engine.execute({ type: 'updateContent', id, content }),
    { id: node.id, content },
  );
}

// An item's text is one line of inline Markdown. Text that would start a
// block in a note ("1. ", "- ", "# ", "> ") is plain text on an item, and
// must read the same while editing as it does in the list.
for (const prefix of ['1. ', '2) ', '- ', '+ ', '# ', '> ']) {
  test(`an item starting with "${prefix.trim()}" keeps it while editing`, async ({ page }) => {
    const text = `${prefix}Plant a tree`;
    await setContent(page, 'Plant a tree', text);
    await expect(row(page, text).locator('.node-content').first()).toHaveText(text);

    await edit(page, text);
    expect(await editorText(page)).toBe(text);
    await setCaret(page, 'end');
    await page.keyboard.type(' soon');
    await page.keyboard.press('Escape');
    await expect(row(page, `${text} soon`).locator('.node-content').first()).toHaveText(`${text} soon`);
  });
}

test('typing a number at the start is stored as typed, with no backslash', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await setCaret(page, 'start');
  await page.keyboard.type('1. ');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', '1. Plant a tree']);
  await page.keyboard.press('Escape');
  await edit(page, '1. Plant a tree');
  await setCaret(page, 'start');
  await page.keyboard.type('- # ');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', '- # 1. Plant a tree']);
});
