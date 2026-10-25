import { expect, test } from '@playwright/test';
import { gotoHome, outline, syncOn } from './helpers';

// A phone with Chromium's fake microphone (a steady beep) that needs no permission prompt.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

test.beforeEach(async ({ page }) => gotoHome(page));

test('the mic shows only where AI works', async ({ page }) => {
  await expect(page.getByTestId('add-to-inbox')).toBeVisible();
  await expect(page.getByTestId('voice-memo')).toHaveCount(0);
  await syncOn(page);
  await expect(page.getByTestId('voice-memo')).toBeVisible();
});

test('a voice memo is sent as WAV, tidied by AI and opened at the top of the Inbox', async ({ page }) => {
  const key = await syncOn(page);
  let audio: object | null = null;
  await page.route('**/api/ai/transcribe', async (route) => {
    const req = route.request();
    const wav = Buffer.from(req.postData()!, 'base64');
    audio = {
      auth: await req.headerValue('authorization'),
      type: await req.headerValue('content-type'),
      header: [wav.toString('latin1', 0, 4), wav.toString('latin1', 8, 12), wav.readUInt16LE(22), wav.readUInt32LE(24)],
    };
    await route.fulfill({ json: { text: 'um so remember to buy milk and eggs' } });
  });
  let prompt = '';
  await page.route('**/api/ai/complete', async (route) => {
    prompt = route.request().postDataJSON().prompt;
    await route.fulfill({ json: { text: 'Groceries\n\nBuy milk and eggs.', model: 'm', durationMs: 5 } });
  });

  await page.getByTestId('voice-memo').tap();
  await expect(page.getByTestId('voice-sheet')).toContainText('Listening 0:0');
  await page.waitForTimeout(700);
  await page.getByTestId('voice-done').tap();

  await expect(page.getByTestId('voice-sheet')).toHaveCount(0);
  await expect(page).toHaveURL(/\/n\/[\w-]+$/);
  await expect(page.locator('h1').first()).toHaveText('Groceries');
  // Mono WAV at 16 kHz, whatever the phone recorded in.
  expect(audio).toEqual({ auth: `Bearer ${key}`, type: 'text/plain', header: ['RIFF', 'WAVE', 1, 16_000] });
  expect(prompt.endsWith('Memo:\num so remember to buy milk and eggs')).toBe(true);
  const note = await page.evaluate(() => {
    const { engine } = (window as any).__aletheia;
    return [...engine.tree.all()].find((n: any) => n.content === 'Groceries')?.note;
  });
  expect(note).toBe('Buy milk and eggs.');
  await gotoHome(page);
  expect((await outline(page, 'Inbox'))[0]).toBe('Groceries');
});

test('Cancel adds nothing, and a failed upload can be tried again', async ({ page }) => {
  await syncOn(page);
  let calls = 0;
  await page.route('**/api/ai/transcribe', (route) =>
    ++calls === 1 ? route.fulfill({ status: 502, json: { error: 'Could not turn the recording into text.' } }) : route.fulfill({ json: { text: 'call the dentist' } }),
  );
  await page.route('**/api/ai/complete', (route) => route.fulfill({ status: 503, json: { error: 'busy' } }));

  await page.getByTestId('voice-memo').tap();
  await page.getByTestId('voice-cancel').tap();
  await expect(page.getByTestId('voice-sheet')).toHaveCount(0);
  expect(calls).toBe(0);

  await page.getByTestId('voice-memo').tap();
  await page.waitForTimeout(500);
  await page.getByTestId('voice-done').tap();
  await expect(page.getByTestId('voice-error')).toHaveText('Could not turn the recording into text.');
  await page.getByTestId('voice-retry').tap();
  // AI couldn't tidy it, so the memo keeps its own words.
  await expect(page.locator('h1').first()).toHaveText('call the dentist');
  expect(calls).toBe(2);
});
