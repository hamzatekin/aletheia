import { newId } from './ids';
import type { Node } from './node';
import { ordersBetween } from './order';

type Item = string | [string, Item[]] | { content: string; note?: string; children?: Item[] };

const SAMPLE: Item[] = [
  {
    content: 'Welcome to **Aletheia**',
    note: 'A keyboard-first outliner. Every line is a node; every node can hold children.',
    children: [
      'Press `Enter` to add a node, `Tab` / `Shift+Tab` to indent and outdent',
      'Click a bullet to zoom in; use breadcrumbs or `Ctrl/⌘+,` to zoom out',
      '`Shift+Enter` opens a note; `/` opens the command menu',
    ],
  },
  [
    'Projects',
    [
      ['Write the outliner', ['Data model and commands', 'Rendering and zoom', 'Editor and keyboard', 'Drag and drop']],
      ['Reading list', ['*Thinking, Fast and Slow*', '[Workflowy](https://workflowy.com)']],
    ],
  ],
  ['Someday', ['Learn to juggle', 'Plant a tree']],
];

/** Build the sample tree written on first run. Pure; no persistence. */
export function seedNodes(now = Date.now()): Node[] {
  const out: Node[] = [];
  const add = (parentId: string | null, items: Item[]): void => {
    const orders = ordersBetween(null, null, items.length);
    items.forEach((item, i) => {
      const spec = typeof item === 'string' ? { content: item } : Array.isArray(item) ? { content: item[0], children: item[1] } : item;
      const id = newId();
      out.push({
        id,
        parentId,
        order: orders[i]!,
        content: spec.content,
        note: spec.note ?? '',
        collapsed: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      if (spec.children) add(id, spec.children);
    });
  };
  add(null, SAMPLE);
  return out;
}
