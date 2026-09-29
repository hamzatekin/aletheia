import { expect, test, type Page } from '@playwright/test';
import { gotoHome, outline, row } from './helpers';

const KEY = 'k'.repeat(43);

/** Pretend sync is on (the AI proxy only answers devices with a sync key); the sync API itself is stubbed out. */
async function syncOn(page: Page) {
  await page.route('**/api/sync/**', (route) => route.fulfill({ status: 503, json: { error: 'stub' } }));
  await page.evaluate((key) => (window as any).__aletheia.sync.state.setState({ key, status: 'idle' }), KEY);
}

type Spec = string | [string, Spec[]];

/** Add a small, realistic outline at the top of Home; returns each row's id by its text. */
async function build(page: Page): Promise<Record<string, string>> {
  const spec: Spec[] = [
    ['Aletheia launch', ['Pick a price', 'Write the landing page', 'Ask Deniz about the logo']],
    ['Ideas', ['Pricing: free tier plus $4 a month', 'Landing page should show the phone app', 'Dark theme for night reading']],
    ['Meetings', [['Call with Deniz', ['Logo: two colours, simple', 'Launch in November']]]],
  ];
  // Loosely typed: the recursive Spec is too deep for evaluate's argument type.
  return page.evaluate((spec: any[]) => {
    const { engine } = (window as any).__aletheia;
    const ids: Record<string, string> = {};
    let n = 0;
    const add = (parentId: string | null, items: any[], top: boolean) => {
      let prev: string | null = null;
      for (const item of items) {
        const [content, kids] = typeof item === 'string' ? [item, []] : item;
        const id = `rel-${n++}`;
        ids[content] = id;
        engine.execute({ type: 'createNode', id, parentId, content, at: top ? (prev ? { after: prev } : 'first') : 'last' });
        prev = id;
        add(id, kids, false);
      }
    };
    add(null, spec, true);
    return ids;
  }, spec as any[]);
}

async function zoom(page: Page, id: string) {
  await page.evaluate((id) => {
    history.pushState({}, '', `/n/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  await expect(page.locator('[data-testid=outline]')).toBeVisible();
}

/** The AI proxy: picks related rows by meaning, and answers the chat. */
async function stubAi(page: Page) {
  await page.route('**/api/ai/complete', async (route) => {
    const prompt: string = route.request().postDataJSON().prompt;
    if (prompt.includes('Reply with JSON only')) {
      const row = (text: string) => Number(new RegExp(`\\[(\\d+)\\] ${text}`).exec(prompt)?.[1]);
      const text = JSON.stringify({
        related: [
          { row: row('Pricing: free tier'), why: 'The price you need to pick' },
          { row: row('Dark theme'), why: 'A feature to mention on the page', duplicate: false },
        ],
      });
      return route.fulfill({ json: { text, model: 'm', durationMs: 5 } });
    }
    const text = 'Here is a plan:\n- Settle on $4 a month [1]\n- Ask Deniz for the logo draft [3]\n- Write the page around the phone app [2]';
    return route.fulfill({ json: { text, model: 'm', durationMs: 5 } });
  });
}

test.beforeEach(async ({ page }) => gotoHome(page));

test('lists rows elsewhere about the zoomed item, and AI adds rows by meaning with a reason', async ({ page }) => {
  const ids = await build(page);
  await zoom(page, ids['Aletheia launch']!);
  await expect(page.getByTestId('related-count')).toBeVisible();
  await page.getByTestId('related-button').click();
  const panel = page.getByTestId('related-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('related-target')).toHaveText('to Aletheia launch');
  await expect(panel.getByTestId('related-item').filter({ hasText: 'Landing page should show the phone app' })).toBeVisible();
  // Without sync only text matches: no chat.
  await expect(panel.getByTestId('related-input')).toHaveCount(0);
  await expect(panel.getByTestId('related-item').filter({ hasText: 'Groceries' })).toHaveCount(0);

  // Peek at a row without leaving.
  await page.evaluate((id) => (window as any).__aletheia.engine.execute({ type: 'updateNote', id, note: 'Screenshots of the Android app' }), ids['Landing page should show the phone app']!);
  await panel.getByTestId('related-item').filter({ hasText: 'Landing page should show the phone app' }).locator('[aria-expanded]').click();
  await expect(panel.getByTestId('related-peek')).toContainText('Screenshots of the Android app');

  await syncOn(page);
  await stubAi(page);
  await panel.getByRole('button', { name: 'Hide related' }).click();
  await page.getByTestId('related-button').click(); // open again: AI looks now
  const dark = panel.getByTestId('related-item').filter({ hasText: 'Dark theme for night reading' });
  await expect(dark).toContainText('A feature to mention on the page');
  await expect(panel.getByTestId('related-item').first()).toContainText('Pricing: free tier plus $4 a month');
  // Rows AI did not pick only share words: tucked away, one tap to show.
  const landing = panel.getByTestId('related-item').filter({ hasText: 'Landing page should show the phone app' });
  await expect(landing).toHaveCount(0);
  await panel.getByTestId('related-more').click();
  await expect(landing).toBeVisible();
  await expect(page.getByTestId('related-count')).toHaveCount(0); // hidden while open
});

test('asks AI for next steps and adds them under the item, with Undo', async ({ page }) => {
  const ids = await build(page);
  await syncOn(page);
  await stubAi(page);
  await zoom(page, ids['Aletheia launch']!);
  await page.getByTestId('related-button').click();
  const panel = page.getByTestId('related-panel');
  await expect(panel.getByTestId('related-item').first()).toContainText('Pricing');
  await panel.getByTestId('related-quick').filter({ hasText: 'Next steps' }).click();
  const answer = panel.getByTestId('related-answer');
  await expect(answer).toContainText('Settle on $4 a month');
  // Citations are jumps to the rows, named after them.
  await expect(answer.locator('a[href^="#cite-"]').first()).toContainText('Pricing: free tier');

  await answer.getByRole('button', { name: 'Add to outline' }).click();
  await expect
    .poll(() => outline(page, 'Aletheia launch'))
    .toEqual(['Pick a price', 'Write the landing page', 'Ask Deniz about the logo', 'Settle on $4 a month', 'Ask Deniz for the logo draft', 'Write the page around the phone app']);
  await answer.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => outline(page, 'Aletheia launch')).toEqual(['Pick a price', 'Write the landing page', 'Ask Deniz about the logo']);

  // A typed question works the same way.
  await panel.getByTestId('related-input').fill('What is left?');
  await page.keyboard.press('Enter');
  await expect(panel.getByTestId('related-answer')).toHaveCount(2);
});

test('Move here puts a related row under the item, and Undo puts it back', async ({ page }) => {
  const ids = await build(page);
  await zoom(page, ids['Aletheia launch']!);
  await page.getByTestId('related-button').click();
  const item = page.getByTestId('related-item').filter({ hasText: 'Landing page should show the phone app' });
  await item.getByRole('button', { name: 'Move here' }).click();
  await expect.poll(() => outline(page, 'Aletheia launch')).toContain('Landing page should show the phone app');
  await expect(row(page, 'Landing page should show the phone app')).toBeVisible();
  await item.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => outline(page, 'Ideas')).toEqual(['Pricing: free tier plus $4 a month', 'Landing page should show the phone app', 'Dark theme for night reading']);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Show related in the bullet menu opens a sheet about that row; Go there zooms in', async ({ page }) => {
    const ids = await build(page);
    await row(page, 'Aletheia launch').getByTestId('bullet-menu').first().tap();
    await page.getByTestId('node-menu-related').tap();
    const panel = page.getByTestId('related-panel');
    await expect(panel.getByTestId('related-target')).toHaveText('to Aletheia launch');
    await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = (await panel.boundingBox())!;
    expect(box.y + box.height).toBeCloseTo(844, 0);
    expect(box.width).toBe(390);
    await panel.getByTestId('related-item').filter({ hasText: 'Landing page should show the phone app' }).getByRole('button', { name: 'Go there' }).tap();
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(`/n/${ids['Landing page should show the phone app']}`);
  });
});
