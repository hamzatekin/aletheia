import { expect, test, type Locator, type Page } from '@playwright/test';
import { focused, gotoHome, outline, row } from './helpers';

// A phone: touch screen, no hover, no Tab key.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** The element a finger would hit at the center of the locator's box. */
async function hitAtCenter(page: Page, selector: string): Promise<boolean> {
  const box = (await page.locator(selector).first().boundingBox())!;
  return page.evaluate(
    ({ x, y, selector }) => !!document.elementFromPoint(x, y)?.closest(selector),
    { x: box.x + box.width / 2, y: box.y + box.height / 2, selector },
  );
}

test('on a phone the collapse arrow sits at the right end of the line and expands with a tap', async ({ page }) => {
  await gotoHome(page);
  await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    const n = [...engine.tree.all()].find((n: any) => n.content === 'Projects');
    engine.execute({ type: 'toggleCollapse', id: n.id, collapsed: true });
  });
  const projects = row(page, 'Projects');
  const toggle = projects.getByRole('button', { name: 'Expand' });
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveCSS('opacity', '1');
  const box = (await toggle.boundingBox())!;
  const text = (await projects.locator('.node-content').first().boundingBox())!;
  expect(box.x).toBeGreaterThan(text.x + text.width - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(await hitAtCenter(page, '[data-node-id] button[aria-label=Expand]')).toBe(true);
  await toggle.tap();
  await expect(row(page, 'Write the outliner')).toBeVisible();
  await expect(projects.getByRole('button', { name: 'Collapse' })).toHaveCount(1);
  // Leaf nodes get no arrow.
  await expect(row(page, 'Plant a tree').getByRole('button', { name: /Expand|Collapse/ })).toHaveCount(0);
});

test('the toolbar above the keyboard indents, outdents and moves while editing', async ({ page }) => {
  await gotoHome(page);
  await expect(page.getByTestId('mobile-toolbar')).toHaveCount(0);
  await row(page, 'Plant a tree').locator('.node-content').first().tap();
  await expect(page.getByTestId('mobile-toolbar')).toBeVisible();

  await page.getByTestId('toolbar-indent').tap();
  expect(await outline(page, 'Someday')).toEqual([['Learn to juggle', ['Plant a tree']]]);
  await expect(page.locator('.ProseMirror')).toBeFocused();
  expect(await focused(page)).toBe('Plant a tree:content');

  await page.getByTestId('toolbar-outdent').tap();
  await page.getByTestId('toolbar-move-up').tap();
  expect(await outline(page, 'Someday')).toEqual(['Plant a tree', 'Learn to juggle']);
  await expect(page.locator('.ProseMirror')).toBeFocused();

  await page.getByTestId('toolbar-undo').tap();
  expect(await outline(page, 'Someday')).toEqual(['Learn to juggle', 'Plant a tree']);

  await page.getByTestId('toolbar-note').tap();
  expect(await focused(page)).toBe('Plant a tree:note');
  await page.getByTestId('toolbar-note').tap();
  expect(await focused(page)).toBe('Plant a tree:content');

  await page.getByTestId('toolbar-done').tap();
  expect(await focused(page)).toBeNull();
  await expect(page.getByTestId('mobile-toolbar')).toHaveCount(0);
});

test('the node menu opens as a bottom sheet from the toolbar', async ({ page }) => {
  await gotoHome(page);
  await expect(page.getByTestId('drag-grip').first()).toBeHidden();
  await row(page, 'Learn to juggle').locator('.node-content').first().tap();
  await page.getByTestId('toolbar-more').tap();
  const menu = page.getByTestId('node-menu');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.round(box.y + box.height)).toBe(844);
  expect(await hitAtCenter(page, '[data-testid=node-menu-delete]')).toBe(true);
  await page.getByTestId('node-menu-delete').tap();
  expect(await outline(page, 'Someday')).toEqual(['Plant a tree']);
  await expect(menu).toHaveCount(0);
});

test('search has a button, since phones have no Ctrl+F', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('button', { name: 'Search' }).tap();
  await expect(page.getByTestId('filter-input')).toBeFocused();
});

test('phones use the full width and keep breadcrumbs on one scrolling line', async ({ page }) => {
  await gotoHome(page);
  const id = await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    let parent: string | null = null;
    for (const name of ['A long first ancestor', 'A second long ancestor', 'Third ancestor here', 'Fourth one', 'Deep page']) {
      const id = crypto.randomUUID();
      engine.execute({ type: 'createNode', id, parentId: parent, at: 'last' });
      engine.execute({ type: 'updateContent', id, content: name });
      parent = id;
    }
    const child = crypto.randomUUID();
    engine.execute({ type: 'createNode', id: child, parentId: parent, at: 'last' });
    engine.execute({ type: 'updateContent', id: child, content: 'Child row' });
    history.pushState({}, '', `/n/${parent}`);
    dispatchEvent(new PopStateEvent('popstate'));
    return parent;
  });
  await expect(page.locator('h1')).toHaveText('Deep page');
  expect(id).toBeTruthy();

  const nav = page.getByRole('navigation', { name: 'Breadcrumbs' });
  const { height, scrollWidth, clientWidth, scrollLeft } = await nav.evaluate((n) => ({
    height: n.getBoundingClientRect().height,
    scrollWidth: n.scrollWidth,
    clientWidth: n.clientWidth,
    scrollLeft: n.scrollLeft,
  }));
  expect(height).toBeLessThan(40);
  expect(scrollWidth).toBeGreaterThan(clientWidth);
  // Scrolled to the end, so the nearest parent shows.
  expect(scrollLeft + clientWidth).toBeGreaterThanOrEqual(scrollWidth - 1);
  await expect(nav).toHaveAttribute('data-overflow-left', 'true');

  // The bullet sits near the left edge and text starts soon after it.
  const bullet = (await row(page, 'Child row').getByRole('link', { name: 'Zoom in' }).boundingBox())!;
  expect(bullet.x).toBeLessThan(16);
  const text = (await row(page, 'Child row').locator('.node-content').first().boundingBox())!;
  expect(text.x).toBeLessThan(36);
});

test('the collapse-all button works with a tap', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('button', { name: 'Collapse all' }).tap();
  await expect(row(page, 'Write the outliner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand all' }).tap();
  await expect(row(page, 'Drag and drop')).toBeVisible();
});

/** Waits for a drawer's slide-in to finish so its box is final. */
async function settled(locator: Locator) {
  await locator.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

test('the open outline drawer covers the top-right buttons', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('button', { name: 'Show outline' }).tap();
  const sidebar = page.getByTestId('outline-sidebar');
  await settled(sidebar);
  // The collapse-all button sits where the drawer is; a tap there lands on the drawer.
  const box = (await page.getByTestId('toggle-all').boundingBox())!;
  const drawer = (await sidebar.boundingBox())!;
  expect(box.x).toBeLessThan(drawer.x + drawer.width);
  const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid=outline-sidebar]'), {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  expect(hit).toBe(true);
});

test('settings open as a drawer from the right and close on a tap outside', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('button', { name: 'Settings' }).tap();
  const panel = page.getByTestId('settings-panel');
  await settled(panel);
  const box = (await panel.boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.height).toBe(844);
  expect(Math.round(box.x + box.width)).toBe(390);
  // The top-right buttons are under the drawer, not on top of it.
  expect(await hitAtCenter(page, '[data-testid=settings-panel]')).toBe(true);
  const gear = (await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox())!;
  const onGear = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid=settings-panel]'), {
    x: gear.x + gear.width / 2,
    y: gear.y + gear.height / 2,
  });
  expect(onGear).toBe(true);
  await page.touchscreen.tap(20, 400);
  await expect(panel).toBeHidden();
});

test('page settings that do nothing on a phone are hidden, and a tapped bullet keeps no halo', async ({ page }) => {
  await gotoHome(page);
  await page.getByLabel('Settings').first().tap();
  await expect(page.getByText('Font size')).toBeVisible();
  await expect(page.getByText('Page width')).toBeHidden();
  await expect(page.getByText('Book page')).toBeHidden();
  await page.getByLabel('Hide settings').tap();
  // Tap-to-hover leaves :hover on the bullet; the hover halo must not show on touch.
  const dot = row(page, 'Plant a tree').locator('.bullet-dot').first();
  await dot.hover();
  await expect(dot).toHaveCSS('box-shadow', 'none');
});
