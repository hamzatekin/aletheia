import type { Command, Engine, Outcome } from '@/commands';
import { newId } from '@/model';
import { looksLikeTerminalProse, terminalToMarkdown } from './terminal';
import type { OutlineItem } from './types';
import { codeTitle, extractFencedBlocks, extractWorkflowyCodeBlocks, fencedBlock, looksLikeWorkflowyHtml, workflowyHtmlToMarkdown } from './workflowy';

const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === '\t' ? 4 : 1;
  return w;
}

/**
 * Parse nested Markdown bullets. Bullet depth follows indentation; any
 * non-bullet line between bullets becomes (part of) the note of the bullet
 * above it. Plain text without bullets becomes one item per line.
 */
export function parseMarkdownOutline(text: string): OutlineItem[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const roots: OutlineItem[] = [];
  // Stack of open items with the indent column they were declared at.
  const stack: { item: OutlineItem; indent: number }[] = [];
  const hasBullets = lines.some((l) => BULLET.test(l));
  let noteLines: string[] | null = null;

  const flushNote = () => {
    const top = stack[stack.length - 1];
    if (top && noteLines) top.item.note = noteLines.join('\n').replace(/\n+$/, '');
    noteLines = null;
  };

  for (const raw of lines) {
    const m = hasBullets ? BULLET.exec(raw) : null;
    if (m) {
      flushNote();
      const indent = indentWidth(m[1]!);
      const item: OutlineItem = { content: m[2]!.trim(), note: '', children: [] };
      while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
      const parent = stack[stack.length - 1];
      (parent ? parent.item.children : roots).push(item);
      stack.push({ item, indent });
      continue;
    }
    if (!hasBullets) {
      const content = raw.trim();
      if (content !== '') roots.push({ content, note: '', children: [] });
      continue;
    }
    if (stack.length === 0) continue; // text before the first bullet is dropped
    const line = raw.trim() === '' ? '' : raw.replace(/^\s+/, '');
    if (noteLines === null) {
      if (line === '') continue;
      noteLines = [];
    }
    noteLines.push(line);
  }
  flushNote();
  return roots;
}

/**
 * A code block moved into a note. Terminal answers pasted into a code block
 * just to keep their line breaks come back as the Markdown they were.
 */
export function noteBlock(code: string): string {
  return looksLikeTerminalProse(code) ? terminalToMarkdown(code) : fencedBlock(code);
}

/** An OPML `<outline>` as read from the file, before any conversion. */
export interface RawOutline {
  text: string;
  note: string;
  complete: boolean;
  children: RawOutline[];
}

/**
 * Raw outlines → items. WorkFlowy exports (spotted by `ownerEmail` in the
 * head, `_complete` flags or its HTML markup) get their HTML turned into
 * Markdown and completed items struck through; other OPML is taken as is.
 */
export function opmlItems(outlines: RawOutline[], fromWorkflowy = false): OutlineItem[] {
  const any = (list: RawOutline[]): boolean =>
    list.some((o) => o.complete || looksLikeWorkflowyHtml(o.text) || looksLikeWorkflowyHtml(o.note) || any(o.children));
  const html = fromWorkflowy || any(outlines);
  const convert = (o: RawOutline): OutlineItem => {
    if (!html) {
      // Plain OPML text is taken as is, except that a ``` fence can't stay in single-line content.
      const text = extractFencedBlocks(o.text);
      const content = text.html.replace(/\s+/g, ' ').trim() || (text.blocks[0] ? codeTitle(text.blocks[0]) : '');
      const note = [...text.blocks.map(noteBlock), ...(o.note === '' ? [] : [o.note])].join('\n\n');
      return text.blocks.length > 0 ? { content, note, children: o.children.map(convert) } : { content: o.text, note: o.note, children: o.children.map(convert) };
    }
    // Multi-line code can't live in a node's single-line content: it moves to the note.
    const text = extractWorkflowyCodeBlocks(o.text);
    const note = extractWorkflowyCodeBlocks(o.note, '\u0000');
    let content = workflowyHtmlToMarkdown(text.html);
    if (content === '' && text.blocks.length > 0) content = codeTitle(text.blocks[0]!);
    if (o.complete && content !== '') content = `~~${content}~~`;
    // Code blocks in the note stay where they were, as their own paragraphs.
    const parts = text.blocks.map(noteBlock);
    workflowyHtmlToMarkdown(note.html, true)
      .split('\u0000')
      .forEach((segment, i) => {
        if (i > 0) parts.push(noteBlock(note.blocks[i - 1]!));
        if (segment.trim() !== '') parts.push(segment.trim());
      });
    return { content, note: parts.join('\n\n'), children: o.children.map(convert) };
  };
  return outlines.map(convert);
}

/** Parse OPML `<outline>` elements (text/_note/_complete attributes). Needs a DOM. */
export function parseOpml(text: string): OutlineItem[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('invalid OPML');
  const body = doc.querySelector('body') ?? doc.documentElement;
  const walk = (el: Element): RawOutline[] =>
    [...el.children]
      .filter((c) => c.tagName.toLowerCase() === 'outline')
      .map((c) => ({
        text: c.getAttribute('text') ?? c.getAttribute('title') ?? '',
        note: c.getAttribute('_note') ?? '',
        complete: c.getAttribute('_complete') === 'true',
        children: walk(c),
      }));
  return opmlItems(walk(body), doc.querySelector('head > ownerEmail') !== null);
}

/** createNode commands for the items under `parentId`, after `after` or at the end. */
export function importCommands(parentId: string | null, items: OutlineItem[], after?: string): Command[] {
  const commands: Command[] = [];
  const add = (pid: string | null, list: OutlineItem[], anchor?: string) => {
    let prev = anchor;
    for (const item of list) {
      const id = newId();
      commands.push({
        type: 'createNode',
        id,
        parentId: pid,
        content: item.content,
        note: item.note,
        at: prev === undefined ? 'last' : { after: prev },
      });
      prev = id;
      add(id, item.children);
    }
  };
  add(parentId, items, after);
  return commands;
}

/** Create the items under `parentId` (at `after`, or at the end) as one undo step. */
export function importItems(engine: Engine, parentId: string | null, items: OutlineItem[], after?: string): Outcome {
  return engine.batch(importCommands(parentId, items, after), 'import');
}

export function countItems(items: OutlineItem[]): number {
  return items.reduce((n, i) => n + 1 + countItems(i.children), 0);
}
