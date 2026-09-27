import { expect, test, type Page } from '@playwright/test';
import { edit, focused, gotoHome, outline, row, setCaret } from './helpers';

const selected = (page: Page) => page.locator('[data-node-id][data-selected]');

async function clickText(page: Page, text: string, modifiers: ('Shift' | 'Control')[] = []): Promise<void> {
  const box = (await row(page, text).locator('.node-content').first().boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.down();
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('Shift+click selects a range of nodes; Ctrl+C copies them as indented text', async ({ page }) => {
  await gotoHome(page);
  await edit(page, 'Write the outliner');
  await clickText(page, 'Reading list', ['Shift']);
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  // Every visible row between the two: Write the outliner, its 4 children, Reading list.
  await expect(selected(page)).toHaveCount(6);

  await page.keyboard.press('Control+c');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe(
    [
      '- Write the outliner',
      '  - Data model and commands',
      '  - Rendering and zoom',
      '  - Editor and keyboard',
      '  - Drag and drop',
      '- Reading list',
      '  - *Thinking, Fast and Slow*',
      '  - [Workflowy](https://workflowy.com)',
    ].join('\n'),
  );
});

test('copied nodes paste back as nested nodes, into an empty node or below a selection', async ({ page }) => {
  await gotoHome(page);
  await edit(page, 'Write the outliner');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+c');

  // Below a selection: the copy lands right after the selected node, selected.
  await edit(page, 'Learn to juggle');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+v');
  await expect
    .poll(() => outline(page, 'Someday'))
    .toEqual([
      'Learn to juggle',
      ['Write the outliner', ['Data model and commands', 'Rendering and zoom', 'Editor and keyboard', 'Drag and drop']],
      'Plant a tree',
    ]);
  await expect(selected(page)).toHaveCount(5);

  // Into an empty node while editing: it becomes the copied node.
  await row(page, 'Plant a tree').scrollIntoViewIfNeeded();
  await edit(page, 'Plant a tree');
  await setCaret(page, 'end');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+v');
  await expect.poll(() => outline(page, 'Someday')).toHaveLength(4);
  const last = (await outline(page, 'Someday'))[3];
  expect(last).toEqual(['Write the outliner', ['Data model and commands', 'Rendering and zoom', 'Editor and keyboard', 'Drag and drop']]);
});

test('Ctrl+X cuts the selection and undo brings it back', async ({ page }) => {
  await gotoHome(page);
  await edit(page, 'Learn to juggle');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Control+x');
  await expect.poll(() => outline(page, 'Someday')).toEqual([]);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('- Learn to juggle\n- Plant a tree');
  await page.keyboard.press('Control+z');
  await expect.poll(() => outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree']);
});

test('Shift+Down at the end of a node selects nodes; Ctrl+A twice selects everything', async ({ page }) => {
  await gotoHome(page);
  await edit(page, 'Learn to juggle');
  await setCaret(page, 'end');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  await expect(selected(page)).toHaveCount(2);

  await edit(page, 'Plant a tree');
  await page.keyboard.press('Control+a'); // the text
  await expect(page.locator('.ProseMirror')).toHaveCount(1);
  await page.keyboard.press('Control+a'); // every node
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  const rows = Number(await page.getAttribute('[data-testid=outline]', 'data-row-count'));
  await expect(selected(page)).toHaveCount(rows);
});

test('Ctrl+click adds single nodes; Tab indents all of them', async ({ page }) => {
  await gotoHome(page);
  await edit(page, 'Rendering and zoom');
  await clickText(page, 'Drag and drop', ['Control']);
  await expect(selected(page)).toHaveCount(2);
  await page.keyboard.press('Tab');
  await expect
    .poll(() => outline(page, 'Write the outliner'))
    .toEqual([
      ['Data model and commands', ['Rendering and zoom']],
      ['Editor and keyboard', ['Drag and drop']],
    ]);
});

test('dragging the mouse across rows selects them', async ({ page }) => {
  await gotoHome(page);
  const from = (await row(page, 'Data model and commands').locator('.node-content').first().boundingBox())!;
  const to = (await row(page, 'Editor and keyboard').locator('.node-content').first().boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  await expect(selected(page)).toHaveCount(3);
  await page.keyboard.press('Backspace');
  await expect.poll(() => outline(page, 'Write the outliner')).toEqual(['Drag and drop']);
  expect(await focused(page)).toBeNull();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  async function longPress(page: Page, text: string) {
    const box = (await row(page, text).locator('.node-content').first().boundingBox())!;
    const x = box.x + 10;
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  test('a long press selects; taps add rows; the bar indents, copies, pastes and deletes', async ({ page }) => {
    await gotoHome(page);
    await longPress(page, 'Rendering and zoom');
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    await expect(page.locator('.ProseMirror')).toHaveCount(0);
    await row(page, 'Drag and drop').locator('.node-content').first().tap();
    await expect(selected(page)).toHaveCount(2);
    await expect(page.getByTestId('selection-count')).toContainText('2 selected');

    await page.getByTestId('selection-indent').tap();
    await expect
      .poll(() => outline(page, 'Write the outliner'))
      .toEqual([
        ['Data model and commands', ['Rendering and zoom']],
        ['Editor and keyboard', ['Drag and drop']],
      ]);

    await page.getByTestId('selection-copy').tap();
    await page.getByTestId('selection-paste').tap();
    await expect
      .poll(() => outline(page, 'Write the outliner'))
      .toEqual([
        ['Data model and commands', ['Rendering and zoom']],
        ['Editor and keyboard', ['Drag and drop', 'Rendering and zoom', 'Drag and drop']],
      ]);
    await expect(selected(page)).toHaveCount(2);

    await page.getByTestId('selection-delete').tap();
    await expect
      .poll(() => outline(page, 'Write the outliner'))
      .toEqual([
        ['Data model and commands', ['Rendering and zoom']],
        ['Editor and keyboard', ['Drag and drop']],
      ]);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });

  test('the node menu has Select, and Done leaves selection mode', async ({ page }) => {
    await gotoHome(page);
    await row(page, 'Plant a tree').locator('.node-content').first().tap();
    await page.getByTestId('toolbar-more').tap();
    await page.getByTestId('node-menu-select').tap();
    await expect(selected(page)).toHaveCount(1);
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    await page.screenshot({ path: 'test-results/multi-select-phone.png' });
    await page.getByTestId('selection-done').tap();
    await expect(selected(page)).toHaveCount(0);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });
});

test('dragging inside one row selects its text without editing it, and Ctrl+C copies that text', async ({ page }) => {
  await gotoHome(page);
  const box = (await row(page, 'Data model and commands').locator('.node-content').first().boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  await expect(selected(page)).toHaveCount(0);
  const text = await page.evaluate(() => document.getSelection()!.toString());
  expect(text.length).toBeGreaterThan(3);
  expect('Data model and commands'.startsWith(text)).toBe(true);
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);

  // A plain click still starts editing, and a double-click selects a word.
  await page.mouse.dblclick(box.x + 10, box.y + box.height / 2);
  await expect(page.locator('.ProseMirror')).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.getSelection()!.toString().trim())).toBe('Data');
});
