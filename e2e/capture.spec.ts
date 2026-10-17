import { expect, test, type Page } from '@playwright/test';
import { edit, focused, gotoHome, nodeByText, outline, reloadApp, row } from './helpers';

test('sharing a page to the app adds a titled link at the top of the Inbox', async ({ page }) => {
  await gotoHome(page);
  await page.goto('/share?title=Mirrors%20in%20Workflowy&text=https%3A%2F%2Fblog.workflowy.com%2Fmirrors');
  await expect(page.locator('h1')).toHaveText('Inbox');
  await expect(page).toHaveURL(/\/n\//);
  await expect(page.locator('[data-testid=outline] a[href="https://blog.workflowy.com/mirrors"]')).toHaveText('Mirrors in Workflowy');
  expect((await outline(page))[0]).toEqual(['Inbox', ['[Mirrors in Workflowy](https://blog.workflowy.com/mirrors)']]);

  // Reloading the Inbox does not add it again; a second share goes on top.
  await reloadApp(page);
  await page.goto('/share?text=Buy%20bread');
  await expect(page.locator('h1')).toHaveText('Inbox');
  expect((await outline(page))[0]).toEqual(['Inbox', ['Buy bread', '[Mirrors in Workflowy](https://blog.workflowy.com/mirrors)']]);
});

// Quick adds start nameless, with the caret in their text; the Inbox shows when they were added.
const AT = new Date(2026, 9, 12, 13, 54);

/** The Inbox's items as [text, note], top first. */
function inboxItems(page: Page): Promise<[string, string][]> {
  return page.evaluate(() => {
    const { tree } = (window as any).__aletheia.engine;
    const inbox = tree.children(null).find((id: string) => tree.get(id).content === 'Inbox');
    return tree.children(inbox).map((id: string) => [tree.get(id).content, tree.get(id).note]);
  });
}

/** A quick add has zoomed into a new nameless Inbox item, with the caret in its text. */
async function inNewItem(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toContainText('Inbox');
  await expect(page.locator('h1.page-title, .page-title')).toHaveText('');
  await expect.poll(() => focused(page)).toBe(':content');
  await expect(page.locator('.page-title.ProseMirror, .page-title .ProseMirror')).toBeFocused();
}

test('the Add to Inbox shortcut zooms into a new Inbox item, to type it and then its note', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await gotoHome(page);
  await page.goto('/capture');
  await inNewItem(page);
  await page.keyboard.type('Ask about the crown');
  // Shift+Enter goes on into its note.
  await page.keyboard.press('Shift+Enter');
  await expect.poll(() => focused(page)).toBe('Ask about the crown:note');
  await expect(page.locator('.ProseMirror[data-editor=note]')).toBeFocused();
  await page.keyboard.type('before Friday');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('h1')).toHaveText('Ask about the crown');
  expect(await inboxItems(page)).toEqual([['Ask about the crown', 'before Friday']]);
  // Done editing: the line to click for the first item under it comes back,
  // without the "start writing" words, since the page has a title and a note.
  await expect(page.getByTestId('empty-outline')).toHaveText('');
  // The Inbox shows when it was added, at the right.
  await page.goto('/');
  await expect(row(page, 'Ask about the crown').getByTestId('added-at')).toHaveText('Oct 12, 1:54 PM');
  await expect(row(page, 'Projects').getByTestId('added-at')).toHaveCount(0);
});

test('on a computer the + at the top and Ctrl+Alt+N add an Inbox item and zoom into it', async ({ page }) => {
  await page.clock.setFixedTime(AT);
  await gotoHome(page);
  // Phones have the round + instead.
  await expect(page.getByTestId('add-to-inbox')).toHaveCount(0);
  await page.getByTestId('add-to-inbox-top').click();
  await inNewItem(page);
  await page.keyboard.type('Book flights');
  await page.keyboard.press('Escape');

  // The shortcut works while editing another line too.
  await page.goto('/');
  await edit(page, 'Projects');
  await page.keyboard.press('Control+Alt+n');
  await inNewItem(page);
  await page.keyboard.type('Renew passport');
  await page.keyboard.press('Escape');
  expect(await inboxItems(page)).toEqual([
    ['Renew passport', ''],
    ['Book flights', ''],
  ]);
  // The line being edited is left as it was.
  expect((await nodeByText(page, 'Projects'))?.deletedAt).toBeNull();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the + button adds an item to the Inbox and zooms into it, to type it', async ({ page }) => {
    await page.clock.setFixedTime(AT);
    await gotoHome(page);
    const plus = page.getByTestId('add-to-inbox');
    // Record what takes the focus: the tap must focus a field itself, or the phone keeps its keyboard closed.
    await page.evaluate(() => {
      (window as any).focusLog = [];
      document.addEventListener('focusin', (e) => {
        const el = e.target as HTMLElement;
        (window as any).focusLog.push(el.dataset.testid ?? (el.closest('.page-title') || el.classList.contains('page-title') ? 'title editor' : el.tagName));
      });
    });
    await plus.tap();
    await expect(page).toHaveURL(/\/n\//);
    await inNewItem(page);
    // (The dev server's strict mode mounts the title editor twice; a production build focuses it once.)
    expect([...new Set(await page.evaluate(() => (window as any).focusLog))]).toEqual(['keyboard-holder', 'title editor']);
    await expect(page.getByTestId('keyboard-holder')).toHaveCount(0);
    // The editing bar takes the bottom of the screen while typing; the top + is for computers.
    await expect(plus).toHaveCount(0);
    await expect(page.getByTestId('add-to-inbox-top')).toHaveCount(0);
    await page.keyboard.type('Buy milk');
    // The bar's note button goes on into its note.
    await page.getByTestId('toolbar-note').tap();
    await expect.poll(() => focused(page)).toBe('Buy milk:note');
    // The store says "note" a moment before the note's editor has the caret; typing earlier loses keys.
    await expect(page.locator('.ProseMirror[data-editor=note]')).toBeFocused();
    await page.keyboard.type('2 litres');
    await page.getByTestId('toolbar-done').tap();
    await expect(page.locator('h1')).toHaveText('Buy milk');

    // A second tap from inside it still goes to the Inbox, on top.
    await plus.tap();
    await inNewItem(page);
    await page.keyboard.type('Water the plants');
    await page.getByTestId('toolbar-done').tap();
    expect(await inboxItems(page)).toEqual([
      ['Water the plants', ''],
      ['Buy milk', '2 litres'],
    ]);
  });
});

test('the manifest offers the share target and the shortcut', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.share_target).toMatchObject({ action: '/share', method: 'GET' });
  expect(manifest.shortcuts[0].url).toBe('/capture');
});
