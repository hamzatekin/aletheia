import { expect, test, type Locator, type Page } from '@playwright/test';
import { focused, gotoHome, longPress, outline, row } from './helpers';

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

test('tapping a bullet zooms in, like everywhere else', async ({ page }) => {
  await gotoHome(page);
  await row(page, 'Projects').getByRole('link', { name: 'Zoom in' }).first().tap();
  await expect(page.locator('h1')).toHaveText('Projects');
  await expect(page.getByTestId('node-menu')).toHaveCount(0);
});

test('a finger on a bullet shows it pressed; lifting zooms in, sliding away lets go', async ({ page }) => {
  await gotoHome(page);
  const bullet = row(page, 'Projects').getByRole('link', { name: 'Zoom in' }).first();
  const box = (await bullet.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const ring = () => bullet.locator('.bullet-dot').evaluate((el) => getComputedStyle(el).boxShadow);

  // Slide off, as when scrolling: the press clears and nothing zooms.
  const idle = await ring();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await expect(bullet).toHaveAttribute('data-pressed', '');
  await expect.poll(ring).not.toBe(idle);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 40 }] });
  await expect(bullet).not.toHaveAttribute('data-pressed');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  await expect(page.locator('h1')).toHaveCount(0);
  await expect(bullet).not.toHaveAttribute('data-pressed');

  // A tap: pressed while down, then it zooms in.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await expect(bullet).toHaveAttribute('data-pressed', '');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('h1')).toHaveText('Projects');
});

test('a long press on a bullet opens its menu, with no Collapse', async ({ page }) => {
  await gotoHome(page);
  await longPress(page, row(page, 'Projects').getByRole('link', { name: 'Zoom in' }).first());
  const menu = page.getByTestId('node-menu');
  await expect(menu).toBeVisible();
  // Lifting the finger neither zooms in nor closes the menu.
  await page.waitForTimeout(300);
  await expect(menu).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('node-menu-collapse')).toHaveCount(0);
  await expect(page.getByTestId('node-menu-star')).toHaveCount(1);
  await expect(page.getByTestId('node-menu-collapse-all')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/menus-phone-bullet-menu.png' });
  await page.getByTestId('node-menu-zoom').tap();
  await expect(page.locator('h1')).toHaveText('Projects');
});

test('a long press on a bullet while editing closes the keyboard and opens the menu', async ({ page }) => {
  await gotoHome(page);
  await row(page, 'Learn to juggle').locator('.node-content').first().tap();
  await expect.poll(() => focused(page)).toBe('Learn to juggle:content');
  await longPress(page, row(page, 'Learn to juggle').getByRole('link', { name: 'Zoom in' }).first());
  await expect(page.getByTestId('node-menu')).toBeVisible();
  expect(await focused(page)).toBeNull();
  await page.getByTestId('node-menu-star').tap();
  await expect(page.getByTestId('node-menu')).toHaveCount(0);
  const starred = await page.evaluate(() => [...(window as any).__aletheia.engine.tree.all()].find((n: any) => n.content === 'Learn to juggle')?.starredAt);
  expect(starred).toEqual(expect.any(Number));
});

test('a tap outside the menu only closes it: the line or bullet under the finger is left alone', async ({ page }) => {
  await gotoHome(page);
  const bullet = (text: string) => row(page, text).getByRole('link', { name: 'Zoom in' }).first();
  // Tap where a finger would, on the backdrop over a row above the sheet.
  const tapOn = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  };
  await longPress(page, bullet('Learn to juggle'));
  await expect(page.getByTestId('node-menu')).toBeVisible();
  await tapOn(row(page, 'Welcome to').locator('.node-content').first());
  await expect(page.getByTestId('node-menu')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await focused(page)).toBeNull();

  await longPress(page, bullet('Learn to juggle'));
  await expect(page.getByTestId('node-menu')).toBeVisible();
  await tapOn(bullet('Welcome to'));
  await expect(page.getByTestId('node-menu')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/$/);
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

test('the top-right buttons sit side by side without overlapping, with sync on too', async ({ page }) => {
  await gotoHome(page);
  await page.route('**/api/sync/**', (route) => route.fulfill({ status: 503, json: { error: 'stub' } }));
  await page.evaluate(() => (window as any).__aletheia.sync.state.setState({ key: 'k'.repeat(43), status: 'idle' }));
  await expect(page.getByTestId('sync-indicator')).toBeVisible();
  const boxes = await page.locator('.top-icon').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
  expect(boxes.length).toBe(6);
  const sorted = boxes.sort((a, b) => a.left - b.left);
  for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.left).toBeGreaterThanOrEqual(sorted[i - 1]!.right);
});

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

test('text scrolls under a solid bar behind the top buttons, not through it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await gotoHome(page);
  const bar = page.getByTestId('top-bar');
  const box = (await bar.boundingBox())!;
  // At the top nothing is hidden: the first line starts below the bar.
  const first = (await page.locator('[data-node-id] .node-content').first().boundingBox())!;
  expect(first.y).toBeGreaterThanOrEqual(box.y + box.height);
  await page.evaluate(() => window.scrollBy(0, 150));
  await expect(bar).toHaveAttribute('data-scrolled', 'true');
  // Rows now under the bar are covered by it, and the bar is opaque.
  const hit = await page.evaluate(({ y }) => document.elementFromPoint(100, y)?.getAttribute('data-testid'), { y: box.height / 2 });
  expect(hit).toBe('top-bar');
  expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toMatch(/rgba\(.*, 0\)|transparent/);
});
