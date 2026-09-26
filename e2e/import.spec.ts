import { expect, test, type Page } from '@playwright/test';
import { edit, gotoHome, outline } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

test('a WorkFlowy OPML export imports with formatting, notes and completed items', async ({ page }) => {
  const opml = [
    '<?xml version="1.0"?>',
    '<opml version="2.0"><head><ownerEmail>me@example.com</ownerEmail></head><body>',
    '<outline text="&lt;b&gt;Reading&lt;/b&gt; list" _note="from R&amp;amp;D">',
    '<outline text="Dune" _complete="true" />',
    '<outline text="see &lt;a href=&quot;https://example.com&quot;&gt;site&lt;/a&gt;" />',
    '<outline text="&lt;code&gt;Review summary&#10;&#10;1. Firms with no settings&#10;- The send check&lt;/code&gt;" />',
    '</outline>',
    '</body></opml>',
  ].join('\n');
  await edit(page, 'Plant a tree');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.type('/workflowy');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'workflowy.opml', mimeType: 'text/xml', buffer: Buffer.from(opml) });
  await expect.poll(() => outline(page, 'Plant a tree')).toEqual([
    ['**Reading** list', ['~~Dune~~', 'see [site](https://example.com)', 'Review summary']],
  ]);
  const note = await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    return [...engine.tree.all()].find((n: any) => n.content === '**Reading** list')?.note;
  });
  expect(note).toBe('from R&D');
  await expect(page.locator('[data-node-id]', { hasText: 'Reading list' }).locator('strong').first()).toHaveText('Reading');
});

test('a WorkFlowy code block becomes a code block in the note', async ({ page }) => {
  const opml = '<opml version="2.0"><head><ownerEmail>me@example.com</ownerEmail></head><body>'
    + '<outline text="&lt;code&gt;Review summary&#10;&#10;1. Firms with no settings&#10;- The send check&lt;/code&gt;" />'
    + '</body></opml>';
  await edit(page, 'Plant a tree');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.type('/workflowy');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'w.opml', mimeType: 'text/xml', buffer: Buffer.from(opml) });
  const imported = page.locator('[data-node-id]', { hasText: 'Review summary' }).last();
  await expect(imported.locator('.node-note pre code')).toHaveText('Review summary\n\n1. Firms with no settings\n- The send check');
  await page.mouse.click(5, 650);
  await imported.screenshot({ path: 'test-results/workflowy-code-block.png' });
});

async function importOpml(page: Page, opml: string) {
  await edit(page, 'Plant a tree');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.type('/workflowy');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'w.opml', mimeType: 'text/xml', buffer: Buffer.from(opml) });
}

const answer = [
  '⏺ Here is how the options compare, from the easiest to the most work.',
  '',
  '  ┌──────────────┬───────────────────────────────────────┬────────────┐',
  '  │ Option       │ What it means                         │ Effort     │',
  '  ├──────────────┼───────────────────────────────────────┼────────────┤',
  '  │ Wider page   │ Raise the page width in Settings so   │ None       │',
  '  │              │ long lines have room                  │            │',
  '  ├──────────────┼───────────────────────────────────────┼────────────┤',
  '  │ Real tables  │ Terminal tables become Markdown       │ Small      │',
  '  │              │ tables whose cells wrap to fit        │            │',
  '  └──────────────┴───────────────────────────────────────┴────────────┘',
  '',
  '  1. Tables stay readable at any page width and never scroll sideways.',
  '  2. Paragraphs reflow instead of keeping the terminal line breaks.',
];

test('Claude Code output pasted into a WorkFlowy code block imports as readable Markdown', async ({ page }) => {
  const text = ['Compare options', '```', ...answer, '```'].join('&#10;');
  await importOpml(page, `<opml version="2.0"><head><ownerEmail>me@example.com</ownerEmail></head><body><outline text="${text}" /></body></opml>`);
  const imported = page.locator('[data-node-id]', { hasText: 'Compare options' }).last();
  await expect(imported.locator('.node-content')).toHaveText('Compare options');
  const note = imported.locator('.node-note');
  await expect(note.locator('pre')).toHaveCount(0);
  await expect(note.locator('table th')).toHaveText(['Option', 'What it means', 'Effort']);
  await expect(note.locator('table td').nth(1)).toHaveText('Raise the page width in Settings so long lines have room');
  await expect(note.locator('ol li')).toHaveCount(2);
  const table = note.locator('table');
  expect(await table.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await note.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.mouse.click(5, 650);
  await imported.screenshot({ path: 'test-results/terminal-output-note.png' });

  // The rendered editor shows the same table, and editing a cell keeps it a Markdown table.
  const cell = note.locator('table td').first();
  const box = (await cell.boundingBox())!;
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
  const editor = page.locator('.ProseMirror[data-editor=note]');
  await expect(editor).toBeFocused();
  await expect(editor.locator('table th')).toHaveText(['Option', 'What it means', 'Effort']);
  expect(await editor.locator('table').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.keyboard.press('End');
  await page.keyboard.type(' | wide');
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => [...(window as any).__aletheia.engine.tree.all()].find((n: any) => n.content === 'Compare options')?.note))
    .toContain('| Wider page \\| wide | Raise the page width in Settings so long lines have room | None |');
});

test('terminal output pasted into a note turns into Markdown', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.press('Shift+Enter');
  const editor = page.locator('.ProseMirror[data-editor=note]');
  await expect(editor).toBeFocused();
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, answer.join('\n'));
  await expect(editor.locator('table th')).toHaveText(['Option', 'What it means', 'Effort']);
  await expect(editor.locator('p').first()).toHaveText('Here is how the options compare, from the easiest to the most work.');
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => [...(window as any).__aletheia.engine.tree.all()].find((n: any) => n.content === 'Plant a tree')?.note))
    .toContain('| Option | What it means | Effort |\n| --- | --- | --- |');
});

test('Format terminal output fixes notes imported before', async ({ page }) => {
  await edit(page, 'Plant a tree');
  const id = await page.evaluate((block) => {
    const { engine } = (window as any).__aletheia;
    const node = [...engine.tree.all()].find((n: any) => n.content === 'Plant a tree');
    engine.execute({ type: 'updateNote', id: node.id, note: block });
    return node.id;
  }, ['```', ...answer, '```'].join('\n'));
  const row = page.locator(`[data-node-id="${id}"]`);
  await expect(row.locator('.node-note pre')).toHaveCount(1);
  await row.hover();
  await row.getByTestId('drag-grip').click();
  await page.getByTestId('node-menu-terminal').click();
  await expect(row.locator('.node-note table th')).toHaveText(['Option', 'What it means', 'Effort']);
  await expect(row.locator('.node-note pre')).toHaveCount(0);
  await row.hover();
  await row.getByTestId('drag-grip').click();
  await expect(page.getByTestId('node-menu-terminal')).toHaveCount(0);
});

test('long, indented code wraps inside its code block instead of scrolling sideways', async ({ page }) => {
  const long = 'Money and messages (most serious) 1. Firms with no saved settings are treated as OFF, so the client gets no receipt and the firm is left out of billing.';
  const text = ['```', `  const message = &quot;${long}&quot;;`, `    return message; // ${long}`, '  }', '```'].join('&#10;');
  await importOpml(page, `<opml version="2.0"><head><ownerEmail>me@example.com</ownerEmail></head><body><outline text="${text}" /></body></opml>`);
  const imported = page.locator('[data-node-id]', { hasText: 'Money and messages' }).last();
  const pre = imported.locator('.node-note pre');
  await expect(pre.locator('code')).toHaveText(`const message = "${long}";\n  return message; // ${long}\n}`);
  expect(await pre.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.mouse.click(5, 650);
  await imported.screenshot({ path: 'test-results/workflowy-long-code.png' });

  // Editing it keeps the wrap, with the caret where the click landed rather than at the far end.
  const box = (await pre.boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + 14);
  const editor = page.locator('.ProseMirror[data-editor=note]');
  await expect(editor).toBeFocused();
  const editPre = editor.locator('pre');
  expect(await editPre.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const caret = await page.evaluate(() => {
    const sel = window.getSelection()!;
    return sel.anchorNode!.textContent!.slice(0, sel.anchorOffset).length;
  });
  expect(caret).toBeLessThan(20);
});
