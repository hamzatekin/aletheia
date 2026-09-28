import { plainText } from '@/editor/markdown';
import type { TreeReader } from '@/model';

/** Enough of a subtree for a title; a longer note or outline is cut here. */
const MAX_NOTE_CHARS = 8_000;
const MAX_CHILD_LINES = 80;
const MAX_TITLE_CHARS = 120;

/** The node's children and deeper descendants as an indented list, cut after `MAX_CHILD_LINES`. */
function outlineText(tree: TreeReader, id: string): string {
  const lines: string[] = [];
  const walk = (parent: string, depth: number) => {
    for (const c of tree.children(parent)) {
      if (lines.length >= MAX_CHILD_LINES) return;
      const text = plainText(tree.get(c)?.content ?? '').trim();
      if (text !== '') lines.push(`${'  '.repeat(depth)}- ${text}`);
      walk(c, depth + 1);
    }
  };
  walk(id, 0);
  return lines.join('\n');
}

/** The prompt asking for a title for a node, or null when the node has nothing to title yet. */
export function titlePrompt(tree: TreeReader, id: string): string | null {
  const node = tree.get(id);
  if (!node) return null;
  const note = node.note.trim().slice(0, MAX_NOTE_CHARS);
  const children = outlineText(tree, id);
  if (note === '' && children === '') return null;
  const current = plainText(node.content).trim();
  return [
    'Suggest a short title for this item from an outliner (like WorkFlowy or Dynalist).',
    'Reply with the title only: at most 8 words, in the same language as the text, no quotes, no Markdown, no trailing period.',
    ...(current !== '' ? ['', `Current title: ${current}`] : []),
    ...(note !== '' ? ['', 'Note:', note] : []),
    ...(children !== '' ? ['', 'Items under it:', children] : []),
  ].join('\n');
}

/** One clean line from the model's answer: no "Title:", quotes, Markdown markers or trailing period. */
export function cleanTitle(text: string): string {
  let line = text.split('\n').find((l) => l.trim() !== '') ?? '';
  line = line.trim().replace(/^#+\s*/, '').replace(/^title\s*:\s*/i, '');
  for (let prev = ''; prev !== line; ) {
    prev = line;
    line = line.replace(/^(["'`*_“‘]+)(.*?)(["'`*_”’]+)$/, '$2').trim();
  }
  line = line.replace(/\.$/, '').trim();
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line;
}
