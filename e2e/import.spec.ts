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
    '</outline>',
    '</body></opml>',
  ].join('\n');
  await edit(page, 'Plant a tree');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.type('/workflowy');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'workflowy.opml', mimeType: 'text/xml', buffer: Buffer.from(opml) });
  await expect.poll(() => outline(page, 'Plant a tree')).toEqual([
    ['**Reading** list', ['~~Dune~~', 'see [site](https://example.com)']],
  ]);
  const note = await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    return [...engine.tree.all()].find((n: any) => n.content === '**Reading** list')?.note;
  });
  expect(note).toBe('from R&D');
  await expect(page.locator('[data-node-id]', { hasText: 'Reading list' }).locator('strong').first()).toHaveText('Reading');
});
