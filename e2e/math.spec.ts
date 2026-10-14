import { expect, test, type Page } from '@playwright/test';
import { gotoHome, nodeByText, row } from './helpers';

test.beforeEach(async ({ page }) => gotoHome(page));

function setNote(page: Page, note: string): Promise<void> {
  return page.evaluate((note) => {
    const { engine } = (window as any).__aletheia;
    const node = [...engine.tree.all()].find((n: any) => n.content === 'Plant a tree');
    engine.execute({ type: 'updateNote', id: node.id, note });
  }, note);
}

const savedNote = async (page: Page) => (await nodeByText(page, 'Plant a tree'))?.note;

const MATH_NOTE = ['Energy is $E=mc^2$ and costs $5 or $10.', '', '$$', '\\sum_{i=1}^n x_i^2', '$$', '', 'Bad: $\\frac{1}$'].join('\n');

test('math in a note is typeset; money and broken formulas stay readable', async ({ page }) => {
  await setNote(page, MATH_NOTE);
  const note = row(page, 'Plant a tree').locator('.node-note');
  await expect(note.locator('.math-inline .katex').first()).toBeVisible();
  await expect(note.locator('.math-inline annotation').first()).toHaveText('E=mc^2');
  await expect(note.locator('.math-display .katex-display annotation')).toHaveText('\\sum_{i=1}^n x_i^2');
  await expect(note.locator('p').first()).toContainText('and costs $5 or $10.');
  await expect(note.locator('.katex-error')).toHaveText('\\frac{1}');
});

test('editing a line with math keeps the TeX exactly as written', async ({ page }) => {
  await setNote(page, MATH_NOTE);
  const note = row(page, 'Plant a tree').locator('.node-note');
  await expect(note.locator('.katex').first()).toBeVisible();
  await note.getByText('Bad:').click();
  const editor = page.locator('.ProseMirror[data-editor=note]');
  await expect(editor.locator('pre code.language-math')).toHaveText('\\sum_{i=1}^n x_i^2');
  await page.keyboard.press('End');
  await page.keyboard.type(' and $a_1 * b_2$');
  await page.keyboard.press('Escape');
  await expect.poll(() => savedNote(page)).toBe(MATH_NOTE.replace('Bad: $\\frac{1}$', 'Bad: $\\frac{1}$ and $a_1 * b_2$'));
  await expect(note.locator('.math-inline annotation').last()).toHaveText('a_1 * b_2');
});

test('editing a $$ block keeps it a formula', async ({ page }) => {
  await setNote(page, MATH_NOTE);
  await row(page, 'Plant a tree').locator('.node-note .math-display').click();
  await page.locator('.ProseMirror[data-editor=note] pre code.language-math').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' + 1');
  await page.keyboard.press('Escape');
  await expect.poll(() => savedNote(page)).toBe(MATH_NOTE.replace('$$\n\\sum_{i=1}^n x_i^2\n$$', '```math\n\\sum_{i=1}^n x_i^2 + 1\n```'));
  await expect(row(page, 'Plant a tree').locator('.node-note .math-display annotation')).toHaveText('\\sum_{i=1}^n x_i^2 + 1');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a wide formula scrolls inside the note, not the page', async ({ page }) => {
    await setNote(page, `$$\n${'a + '.repeat(80)}b\n$$`);
    const display = row(page, 'Plant a tree').locator('.node-note .math-display');
    await expect(display.locator('.katex')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    expect(await display.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
});
