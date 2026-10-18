import { expect, test, type Page } from '@playwright/test';
import { edit, focused, gotoHome, reloadApp, row } from './helpers';

// An item and its note read as one block (Bear, Logseq): no box around the
// note, the arrows go through it, and an item with no name takes its note's
// first line.

/** Two items at the top of Home: Alpha with a two-paragraph note, then Beta. */
async function alphaBeta(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    engine.execute({ type: 'createNode', id: 'beta', parentId: null, at: 'first', content: 'Beta' });
    engine.execute({ type: 'createNode', id: 'alpha', parentId: null, at: 'first', content: 'Alpha', note: 'one\n\ntwo' });
  });
}

const alpha = (page: Page) => row(page, 'Alpha');
const note = (page: Page, id: string) => page.evaluate((id) => (window as any).__aletheia.engine.tree.get(id).note, id);

test('a note sits under its item with no box, at the same left edge', async ({ page }) => {
  await gotoHome(page);
  await alphaBeta(page);
  const alpha = row(page, 'Alpha');
  const card = alpha.locator('.note-card');
  expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await card.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('0px');
  const content = (await alpha.locator('.node-content').boundingBox())!;
  const text = (await alpha.locator('.node-note p').first().boundingBox())!;
  expect(Math.abs(text.x - content.x)).toBeLessThanOrEqual(1);
  expect(text.y - (content.y + content.height)).toBeLessThanOrEqual(3);
});

test('↓ goes from an item into its note, and ↑ from the next item back into it', async ({ page }) => {
  await gotoHome(page);
  await alphaBeta(page);
  await edit(page, 'Alpha');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focused(page)).toBe('Alpha:note');
  await page.keyboard.type('X');
  await expect.poll(() => note(page, 'alpha')).toBe('Xone\n\ntwo');
  // Down again to the note's last line, then out of it to the next item.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focused(page)).toBe('Beta:content');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focused(page)).toBe('Alpha:note');
  await page.keyboard.type('Y');
  await page.keyboard.press('Escape');
  await expect.poll(() => focused(page)).toBe('Alpha:content');
  expect(await note(page, 'alpha')).toBe('Xone\n\ntwoY');

  // A collapsed note: ↑ from the next item skips it, as it is hidden; ↓ from
  // its own item still goes in, since the item you're on shows its note.
  await page.keyboard.press('Escape');
  await alpha(page).hover();
  await alpha(page).getByTestId('note-toggle').click();
  await expect(alpha(page).locator('.node-note')).toHaveCount(0);
  await edit(page, 'Beta');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focused(page)).toBe('Alpha:content');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focused(page)).toBe('Alpha:note');
});

test('a note is hidden in the list, with a mark, and shows only while you are on its item', async ({ page }) => {
  await gotoHome(page, { collapsedNotes: true });
  await alphaBeta(page);
  const viewNote = alpha(page).locator('.node-note');
  const marker = alpha(page).getByTestId('note-marker');
  await expect(viewNote).toHaveCount(0);
  await expect(marker).toBeVisible();
  // The mark sits right after the item's text, on its line, as in Dynalist.
  const text = (await alpha(page).locator('.node-content > span').boundingBox())!;
  const mark = (await marker.boundingBox())!;
  expect(Math.round(mark.x - (text.x + text.width))).toBe(8);
  expect(Math.abs(mark.y + mark.height / 2 - (text.y + text.height / 2))).toBeLessThan(3);
  await expect(page.locator('[data-node-id="beta"] [data-testid=note-marker]')).toHaveCount(0);
  // On the item: the whole note slides open under its text, and the mark goes.
  await edit(page, 'Alpha');
  await expect(viewNote.locator('p')).toHaveText(['one', 'two']);
  await expect(marker).toHaveCount(0);
  expect(await alpha(page).locator('.note-card').evaluate((el) => getComputedStyle(el).animationName)).toBe('note-slide');
  // Editing the note and leaving hides it again: it doesn't stay open.
  await page.keyboard.press('Shift+Enter');
  await expect.poll(() => focused(page)).toBe('Alpha:note');
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect.poll(() => focused(page)).toBeNull();
  await expect(viewNote).toHaveCount(0);
  await expect(marker).toBeVisible();
  expect(await note(page, 'alpha')).toBe('one\n\ntwo!');
});

test('clicking between an item and its hidden note keeps the item highlighted and the note open, with the caret where you clicked', async ({ page }) => {
  await gotoHome(page, { collapsedNotes: true });
  await alphaBeta(page);
  await edit(page, 'Alpha');
  await expect(alpha(page).locator('.node-note p')).toHaveText(['one', 'two']);
  // Count every change to the row that leaves it without its note, or without its highlight.
  await alpha(page).evaluate((el) => {
    (window as any).noteGone = 0;
    (window as any).unhighlighted = 0;
    new MutationObserver(() => {
      if (!el.querySelector('.note-card')) (window as any).noteGone++;
      if (!el.matches('.row-focused') && !el.querySelector('.row-focused')) (window as any).unhighlighted++;
    }).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  const noteGone = () => page.evaluate(() => (window as any).noteGone);
  const unhighlighted = () => page.evaluate(() => (window as any).unhighlighted);
  // To the right of the note's last line: the caret goes to its end.
  await alpha(page).locator('.node-note p').nth(1).click();
  await expect.poll(() => focused(page)).toBe('Alpha:note');
  await page.keyboard.type('!');
  await expect.poll(() => note(page, 'alpha')).toBe('one\n\ntwo!');
  // And back up into the item's text.
  await alpha(page).locator('.node-content').click();
  await expect.poll(() => focused(page)).toBe('Alpha:content');
  expect(await noteGone()).toBe(0);
  expect(await unhighlighted()).toBe(0);
  // A note that is always shown doesn't slide when you get on its item.
  await alpha(page).getByTestId('note-toggle').click();
  await page.evaluate(() => (window as any).__aletheia.engine.flush());
  await reloadApp(page);
  await edit(page, 'Alpha');
  expect(await alpha(page).locator('.note-card').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('an item with no name takes its note\'s first line when the caret leaves it', async ({ page }) => {
  await gotoHome(page);
  await alphaBeta(page);
  await edit(page, 'Alpha');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Shift+Enter');
  await expect.poll(() => focused(page)).toBe(':note');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => {
    const n = (window as any).__aletheia.engine.tree.get('alpha');
    return [n.content, n.note];
  })).toEqual(['one', 'two']);
  await expect(row(page, 'one').locator('.node-content')).toHaveText('one');
});

test('old Inbox items named with their date take their note\'s first line, once', async ({ page }) => {
  await gotoHome(page);
  await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    engine.execute({ type: 'createNode', id: 'inbox', parentId: null, at: 'first', content: 'Inbox' });
    engine.execute({ type: 'createNode', id: 'old', parentId: 'inbox', content: 'x', note: "Lavazza\nThey're in house" });
    const at = new Date(engine.tree.get('old').createdAt);
    const dated = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
    engine.execute({ type: 'updateContent', id: 'old', content: dated });
    localStorage.removeItem('aletheia.liftedCaptureTitles');
    return engine.flush();
  });
  await reloadApp(page);
  const old = () => page.evaluate(() => {
    const n = (window as any).__aletheia.engine.tree.get('old');
    return [n.content, n.note];
  });
  await expect.poll(old).toEqual(['Lavazza', "They're in house"]);
  // Once per device: a later item named like a date stays as it is.
  const dated = await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    const at = new Date(engine.tree.get('old').createdAt);
    const content = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
    engine.execute({ type: 'updateContent', id: 'old', content });
    return engine.flush().then(() => content as string);
  });
  await reloadApp(page);
  expect(await old()).toEqual([dated, "They're in house"]);
});
