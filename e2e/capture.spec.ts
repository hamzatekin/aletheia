import { expect, test } from '@playwright/test';
import { edit, focused, gotoHome, outline, reloadApp } from './helpers';

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

test('the Add to Inbox shortcut zooms into a new empty Inbox item to type into', async ({ page }) => {
  await gotoHome(page);
  await page.goto('/capture');
  await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toContainText('Inbox');
  await expect.poll(() => focused(page)).toBe(':content');
  await expect(page.locator('.ProseMirror')).toBeFocused();
  await page.keyboard.type('Call the dentist');
  await page.keyboard.press('Escape');
  await expect(page.locator('h1')).toHaveText('Call the dentist');
  expect((await outline(page))[0]).toEqual(['Inbox', ['Call the dentist']]);
});

test('on a computer the + at the top and Ctrl+Alt+N add an Inbox item and zoom into it', async ({ page }) => {
  await gotoHome(page);
  // Phones have the round + instead.
  await expect(page.getByTestId('add-to-inbox')).toHaveCount(0);
  await page.getByTestId('add-to-inbox-top').click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toContainText('Inbox');
  await expect(page.locator('.ProseMirror')).toBeFocused();
  await page.keyboard.type('Book flights');
  await page.keyboard.press('Escape');
  await expect(page.locator('h1')).toHaveText('Book flights');

  // The shortcut works while editing another line too.
  await page.goto('/');
  await edit(page, 'Plant a tree');
  await page.keyboard.press('Control+Alt+n');
  await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toContainText('Inbox');
  await expect.poll(() => focused(page)).toBe(':content');
  await expect(page.locator('.ProseMirror')).toBeFocused();
  await page.keyboard.type('Renew passport');
  await page.keyboard.press('Escape');
  expect((await outline(page))[0]).toEqual(['Inbox', ['Renew passport', 'Book flights']]);
  expect(JSON.stringify(await outline(page))).toContain('Plant a tree');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the + button adds an item to the Inbox and zooms into it', async ({ page }) => {
    await gotoHome(page);
    const plus = page.getByTestId('add-to-inbox');
    await plus.tap();
    await expect(page).toHaveURL(/\/n\//);
    await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toContainText('Inbox');
    await expect.poll(() => focused(page)).toBe(':content');
    await expect(page.locator('.ProseMirror')).toBeFocused();
    // The editing bar takes the bottom of the screen while typing; the top + is for computers.
    await expect(plus).toHaveCount(0);
    await expect(page.getByTestId('add-to-inbox-top')).toHaveCount(0);
    await page.keyboard.type('Buy milk');
    await page.getByTestId('toolbar-done').tap();
    await expect(page.locator('h1')).toHaveText('Buy milk');

    // A second tap from inside it still goes to the Inbox, on top.
    await plus.tap();
    await expect(page.locator('.ProseMirror')).toBeFocused();
    await page.keyboard.type('Water the plants');
    await page.getByTestId('toolbar-done').tap();
    expect((await outline(page))[0]).toEqual(['Inbox', ['Water the plants', 'Buy milk']]);
  });
});

test('the manifest offers the share target and the shortcut', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.share_target).toMatchObject({ action: '/share', method: 'GET' });
  expect(manifest.shortcuts[0].url).toBe('/capture');
});
