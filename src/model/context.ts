import { ancestorIds, type TreeReader } from './tree';

/** One bullet line of an outline at `depth`. */
export function bulletLine(content: string, depth: number): string {
  return `${'  '.repeat(depth)}- ${content}`;
}

/** A note as an indented paragraph beneath its bullet. */
export function noteBlock(note: string, depth: number): string {
  const pad = '  '.repeat(depth + 1);
  return note
    .split('\n')
    .map((line) => (line === '' ? '' : pad + line))
    .join('\n');
}

/**
 * Pure text context for one node, for on-demand AI features (never called
 * automatically): ancestor path, content, note, and direct children.
 */
export function nodeContextText(tree: TreeReader, id: string): string {
  const node = tree.get(id);
  if (!node) return '';
  const path = ancestorIds(tree, id)
    .reverse()
    .map((a) => tree.get(a)?.content ?? '')
    .filter((c) => c !== '');
  const lines: string[] = [];
  if (path.length > 0) lines.push(`Path: ${path.join(' > ')}`, '');
  lines.push(bulletLine(node.content, 0));
  if (node.note !== '') lines.push(noteBlock(node.note, 0));
  for (const child of tree.children(id)) lines.push(bulletLine(tree.get(child)?.content ?? '', 1));
  return lines.join('\n');
}
