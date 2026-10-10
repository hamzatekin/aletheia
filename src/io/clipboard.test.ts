import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '@/test/helpers';
import { parseMarkdownOutline } from './import';
import { CLIP_TYPE, clipboardItems, itemsToMarkdown, readClipboardText, rememberCopy, subtreeItems, writeClipboard, writeClipboardData } from './clipboard';
import type { OutlineItem } from './types';

// The real renderers need a DOM (DOMPurify); these show where each part goes.
vi.mock('@/editor/render', () => ({
  renderInline: (content: string) => `[${content}]`,
  renderBlock: (note: string) => `<p>${note}</p>`,
}));

const items: OutlineItem[] = [
  { content: 'A', note: 'first line\nsecond line', children: [{ content: 'A1', note: '', children: [] }] },
  { content: 'B', note: '', children: [] },
];

describe('clipboard', () => {
  it('writes indented bullets that parse back to the same nodes', () => {
    const text = itemsToMarkdown(items);
    expect(text).toBe('- A\n  first line\n  second line\n  - A1\n- B');
    expect(parseMarkdownOutline(text)).toEqual(items);
  });

  it('reads nodes from the private type, or from the last copy when only text came through', () => {
    expect(clipboardItems('whatever', JSON.stringify(items))).toEqual(items);
    expect(clipboardItems('- A', '{"not":"ours"}')).toBeNull();
    const text = rememberCopy(items);
    expect(clipboardItems(text.replace(/\n/g, '\r\n') + '\n')).toBe(items);
    expect(clipboardItems('- something else')).toBeNull();
  });
});

describe('clipboard data', () => {
  it('copies live subtrees only, in the order given', () => {
    const f = fixture([['A', ['A1', 'A2']], 'B']);
    f.engine.execute({ type: 'updateNote', id: f.ids.A1!, note: 'n' });
    f.engine.execute({ type: 'deleteSubtree', id: f.ids.A2! });
    expect(subtreeItems(f.engine.tree, [f.ids.B!, 'missing', f.ids.A!, f.ids.A2!])).toEqual([
      { content: 'B', note: '', children: [] },
      { content: 'A', note: '', children: [{ content: 'A1', note: 'n', children: [] }] },
    ]);
  });

  it('writes plain text, a nested HTML list and the items under the private type', () => {
    const data = new Map<string, string>();
    const text = writeClipboardData({ setData: (type: string, value: string) => data.set(type, value) } as unknown as DataTransfer, items);
    expect(text).toBe('- A\n  first line\n  second line\n  - A1\n- B');
    expect(CLIP_TYPE).toBe('application/x-aletheia-nodes');
    expect([...data.keys()]).toEqual(['text/plain', 'text/html', CLIP_TYPE]);
    expect(data.get('text/plain')).toBe(text);
    expect(JSON.parse(data.get(CLIP_TYPE)!)).toEqual(items);
    expect(data.get('text/html')).toBe('<ul><li>[A]<p>first line\nsecond line</p><ul><li>[A1]</li></ul></li><li>[B]</li></ul>');
  });

  it('only takes well-formed, non-empty item lists from the private type', () => {
    rememberCopy([{ content: 'other', note: '', children: [] }]);
    const bad = [
      '[]',
      '{"content":"a","note":"","children":[]}',
      '[null]',
      '["a"]',
      '[{"content":1,"note":"","children":[]}]',
      '[{"content":"a","note":2,"children":[]}]',
      '[{"content":"a","note":"","children":{}}]',
      '[{"content":"a","note":"","children":[{"content":"b"}]}]',
    ];
    for (const json of bad) expect(clipboardItems('- x', json)).toBeNull();
    expect(clipboardItems('- x', '')).toBeNull();
    expect(clipboardItems('- x', null)).toBeNull();
    const nested = [{ content: 'a', note: '', children: [{ content: 'b', note: 'n', children: [] }] }];
    expect(clipboardItems('', JSON.stringify(nested))).toEqual(nested);
  });

  it('matches the last copy by text, ignoring line endings and outer space, but not empty text', () => {
    const copied = [{ content: 'one', note: '', children: [] }, { content: 'two', note: '', children: [] }];
    rememberCopy(copied);
    expect(clipboardItems('  - one\r- two  ')).toBe(copied);
    expect(clipboardItems('- one\n- two\n- three')).toBeNull();
    rememberCopy([{ content: '', note: '', children: [] }]);
    expect(clipboardItems('')).toBeNull();
  });
});

describe('clipboard buttons', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('copies rich data where the browser can, else plain text, and keeps the copy for pasting here', async () => {
    const written: unknown[] = [];
    vi.stubGlobal('ClipboardItem', class {
      constructor(readonly parts: Record<string, Blob>) {}
    });
    vi.stubGlobal('navigator', { clipboard: { write: async (list: unknown[]) => written.push(...list), writeText: async (t: string) => written.push(t) } });
    await writeClipboard(items);
    expect(written).toHaveLength(1);
    const parts = (written[0] as { parts: Record<string, Blob> }).parts;
    expect(Object.keys(parts)).toEqual(['text/plain', 'text/html']);
    expect(await parts['text/plain']!.text()).toBe(itemsToMarkdown(items));
    expect(parts['text/plain']!.type).toBe('text/plain');
    expect(parts['text/html']!.type).toBe('text/html');
    expect(await parts['text/html']!.text()).toBe('<ul><li>[A]<p>first line\nsecond line</p><ul><li>[A1]</li></ul></li><li>[B]</li></ul>');
    expect(clipboardItems(itemsToMarkdown(items))).toBe(items);
  });

  it('falls back to writeText without ClipboardItem or when the rich write fails', async () => {
    const texts: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (t: string) => texts.push(t) } });
    await writeClipboard(items);
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('navigator', {
      clipboard: {
        write: async () => {
          throw new Error('denied');
        },
        writeText: async (t: string) => texts.push(t),
      },
    });
    await writeClipboard(items);
    expect(texts).toEqual([itemsToMarkdown(items), itemsToMarkdown(items)]);
  });

  it('survives having no clipboard at all', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    });
    await expect(writeClipboard(items)).resolves.toBeUndefined();
    vi.stubGlobal('navigator', {});
    await expect(writeClipboard(items)).resolves.toBeUndefined();
  });

  it('pastes from the clipboard, else from the last copy made here', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: async () => 'from clipboard' } });
    expect(await readClipboardText()).toBe('from clipboard');
    rememberCopy(items);
    vi.stubGlobal('navigator', { clipboard: { readText: async () => '' } });
    expect(await readClipboardText()).toBe(itemsToMarkdown(items));
    vi.stubGlobal('navigator', {
      clipboard: {
        readText: async () => {
          throw new Error('denied');
        },
      },
    });
    expect(await readClipboardText()).toBe(itemsToMarkdown(items));
    vi.stubGlobal('navigator', {});
    expect(await readClipboardText()).toBe(itemsToMarkdown(items));
  });
});
