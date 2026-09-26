import { expect, test } from '@playwright/test';
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

test('a WorkFlowy ``` code block with a box table keeps its lines', async ({ page }) => {
  const table = ['┌───────┬───────┬───────┐', '│ Run   │ Cost  │ Turns │', '├───────┼───────┼───────┤', '│ First │ $0.13 │ 4     │', '└───────┴───────┴───────┘'];
  const text = ['Run results', '```', ...table, '```'].join('&#10;');
  const opml = `<opml version="2.0"><head><ownerEmail>me@example.com</ownerEmail></head><body><outline text="${text}" /></body></opml>`;
  await edit(page, 'Plant a tree');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.type('/workflowy');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'w.opml', mimeType: 'text/xml', buffer: Buffer.from(opml) });
  const imported = page.locator('[data-node-id]', { hasText: 'Run results' }).last();
  await expect(imported.locator('.node-content')).toHaveText('Run results');
  await expect(imported.locator('.node-note pre code')).toHaveText(table.join('\n'));
  await page.mouse.click(5, 650);
  await imported.screenshot({ path: 'test-results/workflowy-fence-table.png' });
});
