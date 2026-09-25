import { bulletLine, noteBlock, type Node, type TreeReader } from '@/model';

/** Nested Markdown bullets under `rootId` (the root itself is not included). */
export function exportMarkdown(tree: TreeReader, rootId: string | null): string {
  const lines: string[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const id of tree.children(parentId)) {
      const node = tree.get(id)!;
      lines.push(bulletLine(node.content, depth));
      if (node.note !== '') lines.push(noteBlock(node.note, depth));
      walk(id, depth + 1);
    }
  };
  walk(rootId, 0);
  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

function xmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
}

/** OPML 2.0; notes go in the `_note` attribute as Workflowy does. */
export function exportOpml(tree: TreeReader, rootId: string | null, title = 'Aletheia'): string {
  const out: string[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const pad = '  '.repeat(depth + 2);
    for (const id of tree.children(parentId)) {
      const node = tree.get(id)!;
      const kids = tree.children(id);
      const note = node.note !== '' ? ` _note="${xmlAttr(node.note)}"` : '';
      if (kids.length === 0) out.push(`${pad}<outline text="${xmlAttr(node.content)}"${note}/>`);
      else {
        out.push(`${pad}<outline text="${xmlAttr(node.content)}"${note}>`);
        walk(id, depth + 1);
        out.push(`${pad}</outline>`);
      }
    }
  };
  walk(rootId, 0);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `  <head><title>${xmlAttr(title)}</title></head>`,
    '  <body>',
    ...out,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}

export interface Backup {
  format: 'aletheia-backup';
  version: 1;
  exportedAt: number;
  nodes: Node[];
}

/** Full JSON backup of every node, including soft-deleted ones. */
export function exportJson(tree: TreeReader, now = Date.now()): string {
  const backup: Backup = { format: 'aletheia-backup', version: 1, exportedAt: now, nodes: [...tree.all()] };
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(text: string): Node[] {
  const data = JSON.parse(text) as Partial<Backup>;
  if (data.format !== 'aletheia-backup' || !Array.isArray(data.nodes)) throw new Error('not an Aletheia backup');
  return data.nodes;
}
