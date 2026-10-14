import { createDocument, type Editor } from '@tiptap/core';
import markdownIt from 'markdown-it';
import type { MarkdownStorage } from 'tiptap-markdown';
import { markdownOptions } from './markdown';
import { math } from './math';
import { taskLists } from './task-list';

/**
 * The rendered note editor turns Markdown into formatted text and writes it
 * back, which rewrites what it can't hold: an image vanished, "[1]" became
 * "\[1\]", a GitHub alert or <details> lost its lines, a table its
 * alignment. So a note is saved block by block: every top-level block the
 * user didn't change keeps its source exactly, and only edited blocks are
 * written out by the editor.
 */

/** Same block structure as the editor sees (it parses with these options). */
const blockParser = markdownIt(markdownOptions).use(taskLists).use(math, { render: 'source' });

/** A top-level block of a note: its source lines [from, to). */
export interface SourceBlock {
  from: number;
  to: number;
}

/**
 * The note's top-level blocks, each running to the next one (so lines no
 * block owns, like link definitions, stay with the block above), without
 * the blank lines that follow it.
 */
export function sourceBlocks(note: string): SourceBlock[] {
  const lines = note.split('\n');
  const starts = blockParser
    .parse(note, {})
    .filter((t) => t.level === 0 && t.nesting !== -1 && t.map)
    .map((t) => t.map![0]);
  return starts.map((start, i) => {
    let to = starts[i + 1] ?? lines.length;
    while (to > start && lines[to - 1]!.trim() === '') to--;
    return { from: i === 0 ? 0 : start, to };
  });
}

/**
 * The note to save: `current` holds the editor's own Markdown for each of its
 * top-level blocks, `normalized` the editor's Markdown for each source block
 * as loaded. Blocks matching a loaded one (in order) keep their source, runs
 * of them with the lines between; the rest are the editor's. Null when no
 * block survived, so the editor's whole document is the answer.
 */
export function keepSource(note: string, blocks: SourceBlock[], normalized: string[], current: string[]): string | null {
  const match = matchInOrder(normalized, current);
  if (!match.some((j) => j !== null)) return null;
  const lines = note.split('\n');
  const out: string[] = [];
  for (let i = 0; i < current.length; i++) {
    const j = match[i];
    if (j === null || j === undefined) {
      if (current[i] !== '') out.push(current[i]!); // an empty paragraph adds nothing
      continue;
    }
    // Extend over following blocks that are still the next source blocks.
    let k = j;
    while (i + 1 < current.length && match[i + 1] === k + 1) {
      i++;
      k++;
    }
    out.push(lines.slice(blocks[j]!.from, blocks[k]!.to).join('\n'));
  }
  return out.join('\n\n');
}

/** For each item of `b`, the index of the item of `a` it pairs with in a longest common subsequence, or null. */
function matchInOrder(a: string[], b: string[]): (number | null)[] {
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const match = new Array<number | null>(m).fill(null);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) match[j++] = i++;
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i++;
    else j++;
  }
  return match;
}

interface Serializer {
  serialize(content: unknown): string;
}
interface Parser {
  parse(content: string): string;
}

function storage(editor: Editor): MarkdownStorage & { serializer: Serializer; parser: Parser } {
  return (editor.storage as unknown as { markdown: MarkdownStorage & { serializer: Serializer; parser: Parser } }).markdown;
}

const trimEnd = (md: string) => md.replace(/\s+$/, '');

/** What the editor makes of a note it loaded: per source block, its Markdown after a round trip through the editor. */
export interface LoadedNote {
  note: string;
  blocks: SourceBlock[];
  normalized: string[];
}

export function loadedNote(editor: Editor, note: string): LoadedNote {
  const { parser, serializer } = storage(editor);
  const lines = note.split('\n');
  const blocks = sourceBlocks(note);
  const normalized = blocks.map((b) => trimEnd(serializer.serialize(createDocument(parser.parse(lines.slice(b.from, b.to).join('\n')), editor.schema))));
  return { note, blocks, normalized };
}

/** The editor's note as Markdown, keeping the source of every block it hasn't changed since `loaded`. */
export function noteMarkdown(editor: Editor, loaded: LoadedNote | null): string {
  const { serializer } = storage(editor);
  const whole = trimEnd(storage(editor).getMarkdown());
  if (!loaded || loaded.blocks.length === 0) return whole;
  const current: string[] = [];
  editor.state.doc.forEach((child) => current.push(trimEnd(serializer.serialize(editor.schema.topNodeType.create(null, child)))));
  return keepSource(loaded.note, loaded.blocks, loaded.normalized, current) ?? whole;
}
