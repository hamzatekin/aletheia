import { expect, test, type Page } from '@playwright/test';
import { edit, gotoHome, nodeByText, row } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

function setNote(page: Page, content: string, note: string): Promise<void> {
  return page.evaluate(
    ([content, note]) => {
      const { engine } = (window as any).__aletheia;
      const node = [...engine.tree.all()].find((n: any) => n.content === content);
      engine.execute({ type: 'updateNote', id: node.id, note });
    },
    [content, note] as const,
  );
}

test('"[] " in a note starts a checklist; Enter adds the next item, Tab nests it', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.press('Shift+Enter');
  const note = page.locator('.ProseMirror[data-editor=note]');
  await expect(note).toBeFocused();
  await page.keyboard.type('[] buy a sapling');
  await expect(note.locator("li[data-type='taskItem'] input[type=checkbox]")).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('dig a hole');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('find a spade');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.type('pick a spot');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nodeByText(page, 'Plant a tree'))?.note).toBe(
    '- [ ] buy a sapling\n- [ ] dig a hole\n  - [ ] find a spade\n- [ ] pick a spot',
  );
});

test('"[x] " makes a ticked item, and Enter on an empty item ends the list', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('[x] water it');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('then rake');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nodeByText(page, 'Plant a tree'))?.note).toBe('- [x] water it\n\nthen rake');
});

test('a rendered checklist ticks on click without opening the note, and the editor shows the same', async ({ page }) => {
  await setNote(page, 'Plant a tree', 'Steps\n\n- [ ] buy a sapling\n- [x] **dig** a hole\n  - [ ] find a spade');
  const plant = row(page, 'Plant a tree');
  const boxes = plant.locator(".node-note li[data-type='taskItem'] > label input");
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(1)).toBeChecked();
  await expect(plant.locator(".node-note li[data-checked='true'] > div > p").first()).toHaveCSS('text-decoration-line', 'line-through');

  await boxes.nth(0).click();
  await expect.poll(async () => (await nodeByText(page, 'Plant a tree'))?.note).toBe(
    'Steps\n\n- [x] buy a sapling\n- [x] **dig** a hole\n  - [ ] find a spade',
  );
  await expect(page.locator('[data-editor=note]')).toHaveCount(0);
  await plant.locator(".node-note li[data-type='taskItem'] > label").nth(1).click();
  await expect.poll(async () => (await nodeByText(page, 'Plant a tree'))?.note).toBe(
    'Steps\n\n- [x] buy a sapling\n- [ ] **dig** a hole\n  - [ ] find a spade',
  );

  // Opening the note keeps every box where it was, ticked or not.
  const place = () => boxes.evaluateAll((els) => els.map((el) => [Math.round(el.getBoundingClientRect().x), Math.round(el.getBoundingClientRect().y)]));
  const before = await place();
  await plant.locator('.node-note p').first().click();
  const editing = page.locator(".ProseMirror[data-editor=note] li[data-type='taskItem'] > label input");
  await expect(editing).toHaveCount(3);
  expect(await editing.evaluateAll((els) => els.map((el) => [Math.round(el.getBoundingClientRect().x), Math.round(el.getBoundingClientRect().y)]))).toEqual(before);
  expect(await editing.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked))).toEqual([true, false, false]);

  // Ticking in the editor saves too, and loading alone changes nothing.
  await editing.nth(2).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nodeByText(page, 'Plant a tree'))?.note).toBe(
    'Steps\n\n- [x] buy a sapling\n- [ ] **dig** a hole\n  - [x] find a spade',
  );
});

test('the "/" menu in a note makes a checklist', async ({ page }) => {
  await edit(page, 'Plant a tree');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('/check');
  await page.keyboard.press('Enter');
  await page.keyboard.type('water it');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nodeByText(page, 'Plant a tree'))?.note).toBe('- [ ] water it');
});

test('headings down to level 6 survive editing a note', async ({ page }) => {
  await setNote(page, 'Plant a tree', '#### Four\n\n###### Six');
  await row(page, 'Plant a tree').locator('.node-note h4').click();
  await expect(page.locator('.ProseMirror[data-editor=note] h6')).toHaveText('Six');
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nodeByText(page, 'Plant a tree'))?.note).toBe('#### Four!\n\n###### Six');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tapping a box ticks it without opening the note', async ({ page }) => {
    await setNote(page, 'Plant a tree', '- [ ] buy a sapling');
    const label = row(page, 'Plant a tree').locator(".node-note li[data-type='taskItem'] > label");
    const box = (await label.boundingBox())!;
    // The tap target is bigger than the box itself.
    expect(box.height).toBeGreaterThanOrEqual(30);
    await label.tap();
    await expect.poll(async () => (await nodeByText(page, 'Plant a tree'))?.note).toBe('- [x] buy a sapling');
    await expect(page.locator('[data-editor=note]')).toHaveCount(0);
  });
});
