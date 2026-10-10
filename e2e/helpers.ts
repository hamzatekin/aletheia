import { expect, type Locator, type Page } from '@playwright/test';

/** Nested outline of live nodes as content strings, e.g. ["A", ["B", ["B1"]]]. */
export type Spec = string | [string, Spec[]];

/**
 * Open the app. Most tests look inside notes, so they start with notes
 * expanded unless `collapsedNotes` asks for the app's default (collapsed).
 */
export async function gotoHome(page: Page, { collapsedNotes = false } = {}): Promise<void> {
  if (!collapsedNotes) {
    await page.addInitScript(() => {
      if (localStorage.getItem('aletheia:notes') === null) localStorage.setItem('aletheia:notes', JSON.stringify({ collapsedByDefault: false }));
    });
  }
  await page.goto('/');
  await page.locator('[data-testid=outline]').waitFor();
  // Text rewraps when the web font arrives, which moves rows; measure after that.
  await page.evaluate(async () => {
    await document.fonts.load('16px "Inter Variable"');
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

export function outline(page: Page, root: string | null = null): Promise<Spec[]> {
  return page.evaluate((root) => {
    const { engine } = (window as any).__aletheia;
    const walk = (pid: string | null): unknown[] =>
      engine.tree.children(pid).map((id: string) => {
        const n = engine.tree.get(id);
        const kids = walk(id);
        return kids.length > 0 ? [n.content, kids] : n.content;
      });
    const rootId = root === null ? null : [...engine.tree.all()].find((n: any) => n.content === root)?.id ?? null;
    return walk(rootId) as Spec[];
  }, root);
}

/** Content of the focused node, plus which field, or null. */
export function focused(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const { engine, ui } = (window as any).__aletheia;
    const f = ui.getState().focus;
    return f ? `${engine.tree.get(f.id).content}:${f.field}` : null;
  });
}

export function row(page: Page, text: string): Locator {
  return page.locator('[data-node-id]', { hasText: text }).first();
}

/** A node's stored fields, as the engine holds them. */
export type NodeFields = {
  id: string;
  parentId: string | null;
  content: string;
  note: string;
  collapsed: boolean;
  starredAt: number | null;
  deletedAt: number | null;
};

/** The first node in the tree whose content is exactly `text`, or undefined. */
export function nodeByText(page: Page, text: string): Promise<NodeFields | undefined> {
  return page.evaluate((text) => {
    const n = [...(window as any).__aletheia.engine.tree.all()].find((n: any) => n.content === text);
    return n && { id: n.id, parentId: n.parentId, content: n.content, note: n.note, collapsed: n.collapsed, starredAt: n.starredAt ?? null, deletedAt: n.deletedAt };
  }, text);
}

/** Hover a row and click its grip to open the node menu. */
export async function openNodeMenu(page: Page, text: string): Promise<void> {
  await row(page, text).hover();
  await row(page, text).locator('[data-testid=drag-grip]').click();
  await expect(page.getByTestId('node-menu')).toBeVisible();
}

/** Reload the page and wait for the outline to be back. */
export async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  await page.locator('[data-testid=outline]').waitFor();
}

/** Pretend sync is on (the AI proxy only answers devices with a sync key); the sync API itself is stubbed out. */
export async function syncOn(page: Page): Promise<string> {
  const key = 'k'.repeat(43);
  await page.route('**/api/sync/**', (route) => route.fulfill({ status: 503, json: { error: 'stub' } }));
  await page.evaluate((key) => (window as any).__aletheia.sync.state.setState({ key, status: 'idle' }), key);
  return key;
}

/** Click into a node's content to start editing it (caret at the click point, near the end). */
export async function edit(page: Page, text: string): Promise<void> {
  const content = row(page, text).locator('.node-content').first();
  const box = (await content.boundingBox())!;
  await page.mouse.click(box.x + box.width - 2, box.y + Math.min(12, box.height / 2));
  await expect(page.locator('.ProseMirror')).toBeFocused();
}

/** Put the caret at a ProseMirror position (1 = start of the text). */
export function setCaret(page: Page, pos: number | 'start' | 'end'): Promise<void> {
  return page.evaluate((pos) => {
    const { session } = (window as any).__aletheia;
    const size = session.editor.state.doc.content.size;
    const p = pos === 'start' ? 1 : pos === 'end' ? size - 1 : pos;
    session.editor.commands.setTextSelection(p);
  }, pos);
}

export function editorText(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__aletheia.session.editor.getText());
}

export function rowCount(page: Page): Promise<number> {
  return page.getAttribute('[data-testid=outline]', 'data-row-count').then((v) => Number(v));
}

/** Drag a node's bullet onto a row at a vertical fraction / horizontal offset. */
export async function dragBullet(page: Page, src: string, dst: string, yFrac: number, xOffset = 60): Promise<void> {
  const handle = (await row(page, src).getByRole('link', { name: 'Zoom in' }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 10, handle.y + 10, { steps: 3 });
  const target = (await row(page, dst).boundingBox())!;
  await page.mouse.move(target.x + xOffset, target.y + target.height * yFrac, { steps: 12 });
  await page.mouse.up();
}

/** Hold a finger on the locator (10px in from its left edge) past the app's long-press time, then lift it. */
export async function longPress(page: Page, target: Locator): Promise<void> {
  const box = (await target.boundingBox())!;
  const x = box.x + Math.min(10, box.width / 2);
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
