import { describe, expect, it } from 'vitest';
import { parseMarkdownOutline } from './import';
import { clipboardItems, itemsToMarkdown, rememberCopy } from './clipboard';
import type { OutlineItem } from './types';

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
