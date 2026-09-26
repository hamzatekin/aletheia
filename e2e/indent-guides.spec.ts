import { expect, test, type Page } from '@playwright/test';
import { gotoHome, row } from './helpers';

/** x of each indent guide in a row, and of the bullet centers of its ancestors. */
async function guideXs(page: Page, text: string): Promise<number[]> {
  return row(page, text)
    .locator('.indent-guide')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
}

async function bulletCenter(page: Page, text: string): Promise<number> {
  const box = (await row(page, text).locator('.bullet-dot').first().boundingBox())!;
  return Math.round(box.x + box.width / 2);
}

test('indent guides run down from each open parent bullet through its children', async ({ page }) => {
  await gotoHome(page);
  expect(await guideXs(page, 'Projects')).toEqual([]);
  expect(await guideXs(page, 'Write the outliner')).toEqual([await bulletCenter(page, 'Projects')]);
  expect(await guideXs(page, 'Drag and drop')).toEqual([
    await bulletCenter(page, 'Projects'),
    await bulletCenter(page, 'Write the outliner'),
  ]);
  // Guides fill the whole row, so consecutive children draw one unbroken line.
  const a = (await row(page, 'Data model').locator('.indent-guide').last().boundingBox())!;
  const b = (await row(page, 'Rendering and zoom').locator('.indent-guide').last().boundingBox())!;
  expect(Math.abs(a.y + a.height - b.y)).toBeLessThan(1);
});

test('indent guides line up with bullets on a phone too', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await gotoHome(page);
  expect(await guideXs(page, 'Drag and drop')).toEqual([
    await bulletCenter(page, 'Projects'),
    await bulletCenter(page, 'Write the outliner'),
  ]);
  await context.close();
});
