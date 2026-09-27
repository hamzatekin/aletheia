import { renderBlock, renderInline } from '@/editor/render';
import { bulletLine, noteBlock, type TreeReader } from '@/model';
import type { OutlineItem } from './types';

/**
 * Copied nodes travel in three forms, like WorkFlowy's and Dynalist's:
 * indented "- " bullets as plain text (for any text field), a nested list as
 * HTML (for docs and mail), and the items themselves under a private type,
 * so pasting back into the outline recreates the nodes exactly.
 */
export const CLIP_TYPE = 'application/x-aletheia-nodes';

/** The subtrees of `ids`, in the given order. */
export function subtreeItems(tree: TreeReader, ids: readonly string[]): OutlineItem[] {
  return ids.flatMap((id) => {
    const n = tree.get(id);
    if (!n || n.deletedAt !== null) return [];
    return [{ content: n.content, note: n.note, children: subtreeItems(tree, tree.children(id)) }];
  });
}

export function itemsToMarkdown(items: OutlineItem[]): string {
  const lines: string[] = [];
  const walk = (list: OutlineItem[], depth: number) => {
    for (const item of list) {
      lines.push(bulletLine(item.content, depth));
      if (item.note !== '') lines.push(noteBlock(item.note, depth));
      walk(item.children, depth + 1);
    }
  };
  walk(items, 0);
  return lines.join('\n');
}

export function itemsToHtml(items: OutlineItem[]): string {
  const list = (items: OutlineItem[]): string =>
    `<ul>${items
      .map((i) => `<li>${renderInline(i.content)}${i.note !== '' ? renderBlock(i.note) : ''}${i.children.length > 0 ? list(i.children) : ''}</li>`)
      .join('')}</ul>`;
  return list(items);
}

function isItems(value: unknown): value is OutlineItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) => typeof v === 'object' && v !== null && typeof v.content === 'string' && typeof v.note === 'string' && isItems(v.children),
    )
  );
}

/**
 * The last copy made here. The system clipboard can only carry plain text on
 * some paths (the phone's Copy button), so a paste whose text matches this
 * one gets the nodes back from here.
 */
let last: { text: string; items: OutlineItem[] } | null = null;

const normalize = (text: string) => text.replace(/\r\n?/g, '\n').trim();

export function rememberCopy(items: OutlineItem[]): string {
  const text = itemsToMarkdown(items);
  last = { text: normalize(text), items };
  return text;
}

/** Put the items on a clipboard event's data. Returns the plain text. */
export function writeClipboardData(data: DataTransfer, items: OutlineItem[]): string {
  const text = rememberCopy(items);
  data.setData('text/plain', text);
  data.setData('text/html', itemsToHtml(items));
  data.setData(CLIP_TYPE, JSON.stringify(items));
  return text;
}

/** Copied nodes behind pasted data, if it came from this app. */
export function clipboardItems(text: string, json?: string | null): OutlineItem[] | null {
  if (json) {
    try {
      const parsed: unknown = JSON.parse(json);
      if (isItems(parsed) && parsed.length > 0) return parsed;
    } catch {
      // Not ours after all; fall back to the text.
    }
  }
  if (last && text !== '' && normalize(text) === last.text) return last.items;
  return null;
}

/** Copy from a button, where there is no clipboard event to write to. */
export async function writeClipboard(items: OutlineItem[]): Promise<void> {
  const text = rememberCopy(items);
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([itemsToHtml(items)], { type: 'text/html' }),
        }),
      ]);
    } else {
      await navigator.clipboard?.writeText(text);
    }
  } catch {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // No clipboard access: pasting here still works from the copy kept above.
    }
  }
}

/** Read for a Paste button. Falls back to the last copy made here when the clipboard can't be read. */
export async function readClipboardText(): Promise<string> {
  try {
    const text = await navigator.clipboard?.readText();
    if (text) return text;
  } catch {
    // Permission denied or unsupported.
  }
  return last?.text ?? '';
}
