import { expect, test, type Page } from '@playwright/test';
import { edit, gotoHome, outline, syncOn, type Spec } from './helpers';

/** Add a small outline at the top of Home. */
async function build(page: Page): Promise<void> {
  const spec: Spec[] = [
    ['Work', ['14 Oct', 'Suppliers']],
    ['Inbox', ['Lavazza', 'Liquidline', 'Call mum']],
  ];
  await page.evaluate((spec: any[]) => {
    const { engine } = (window as any).__aletheia;
    let n = 0;
    const add = (parentId: string | null, items: any[], top: boolean) => {
      let prev: string | null = null;
      for (const item of items) {
        const [content, kids] = typeof item === 'string' ? [item, []] : item;
        const id = `ag-${n++}`;
        engine.execute({ type: 'createNode', id, parentId, content, at: top ? (prev ? { after: prev } : 'first') : 'last' });
        prev = id;
        add(id, kids, false);
      }
    };
    add(null, spec, true);
  }, spec as any[]);
}

/** A fake AI: searches first, then makes "Coffee" under Work and moves the row it was asked from into it. */
async function stubAi(page: Page, prompts: string[]) {
  await page.route('**/api/ai/complete', async (route) => {
    const body = route.request().postDataJSON();
    prompts.push(body.prompt);
    const n = (text: string) => Number(new RegExp(`\\[(\\d+)\\] ${text}`).exec(prompts.join('\n'))?.[1]);
    const text = body.prompt.includes('Results:')
      ? JSON.stringify({
          answer: `Made Coffee under Work and moved Lavazza into it [${n('Lavazza')}].`,
          changes: [
            { create: { under: n('Work'), text: 'Coffee', as: 'c' } },
            { move: { row: n('Lavazza'), under: 'c' } },
          ],
        })
      : JSON.stringify({ read: [{ search: 'coffee' }] });
    await route.fulfill({ json: { text, model: 'm', durationMs: 5, session: 's1' } });
  });
}

test.beforeEach(async ({ page }) => gotoHome(page));

test('one AI chat for the app: it starts from the row you are on, acts, and keeps going as you move', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await build(page);
  await page.getByTestId('agent-button').click();
  const panel = page.getByTestId('agent-panel');
  await expect(panel).toContainText('Turn on sync in Settings to use AI on this device.');
  await expect(panel.getByTestId('agent-input')).toHaveCount(0);

  await syncOn(page);
  const prompts: string[] = [];
  await stubAi(page, prompts);
  await page.getByTestId('agent-button').click(); // close
  await page.getByTestId('agent-button').click(); // open again, now with AI
  await expect(panel.getByTestId('agent-here')).toHaveText('On: Home');
  await edit(page, 'Lavazza');
  await expect(panel.getByTestId('agent-here')).toHaveText('On: Lavazza');

  await panel.getByTestId('agent-input').fill('Make Coffee in Work and move this there');
  await page.keyboard.press('Enter');
  // What changed is folded to one line; the list opens on a tap.
  const changes = panel.getByTestId('agent-did');
  await expect(changes.locator('summary')).toHaveText('2 changesUndo');
  await expect(changes.getByText('Created “Coffee” in “Work”.')).toBeHidden();
  await changes.locator('summary').click();
  await expect(changes.getByText('Created “Coffee” in “Work”.')).toBeVisible();
  await expect(changes.getByText('Moved “Lavazza” to “Coffee”.')).toBeVisible();
  expect(prompts[0]).toContain('They are on this row:\n[1] Lavazza');
  // The second step sends only the search results: the relay keeps the session.
  expect(prompts[1]!.startsWith('Results:\nsearch "coffee":')).toBe(true);
  await expect.poll(() => outline(page, 'Work')).toEqual(['14 Oct', 'Suppliers', ['Coffee', ['Lavazza']]]);

  // Moving to another row keeps the chat.
  await edit(page, 'Call mum');
  await expect(panel.getByTestId('agent-here')).toHaveText('On: Call mum');
  await expect(panel.getByTestId('agent-answer')).toHaveCount(1);

  await panel.getByTestId('agent-did').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => outline(page, 'Inbox')).toEqual(['Lavazza', 'Liquidline', 'Call mum']);
  await expect.poll(() => outline(page, 'Work')).toEqual(['14 Oct', 'Suppliers']);

  // A citation jumps to its row.
  await panel.getByTestId('agent-answer').locator('a[href^="#cite-"]').click();
  await expect(page).toHaveURL(/\/n\/ag-\d+$/);

  await panel.getByTestId('agent-clear').click();
  await expect(panel.getByTestId('agent-answer')).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the chat is a sheet from the bottom with the box at the bottom', async ({ page }) => {
    await build(page);
    await syncOn(page);
    await page.getByTestId('agent-button').tap();
    const panel = page.getByTestId('agent-panel');
    await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = (await panel.boundingBox())!;
    expect(box.y + box.height).toBeCloseTo(844, 0);
    expect(box.width).toBe(390);
    const input = (await panel.getByTestId('agent-input').boundingBox())!;
    expect(input.y + input.height).toBeGreaterThan(780);
  });
});
