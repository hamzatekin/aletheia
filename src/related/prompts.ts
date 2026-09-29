import { plainText } from '@/editor/markdown';
import type { OutlineItem } from '@/io';
import { ancestorIds, descendantIds, type TreeReader } from '@/model';
import { excludedIds, pathText, type RelatedItem } from './find';

/** Budget for the outline sent to find related rows: shallow rows first, deeper ones cut. */
const DIGEST_CHARS = 40_000;
const ROW_CHARS = 100;
const MAX_AI_RELATED = 10;
const ITEM_LINES = 60;
const ITEM_NOTE_CHARS = 3_000;
const RELATED_NOTE_CHARS = 400;
const RELATED_CHILD_LINES = 8;
/** Earlier turns sent with a question; older ones are dropped. */
const HISTORY_TURNS = 6;

const one = (text: string, max: number) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const rowText = (tree: TreeReader, id: string) => one(plainText(tree.get(id)?.content ?? ''), ROW_CHARS);

/** The item's children and deeper rows as an indented list. */
function subtreeLines(tree: TreeReader, id: string, max: number, indent = ''): string[] {
  const lines: string[] = [];
  const walk = (parent: string, depth: number) => {
    for (const c of tree.children(parent)) {
      if (lines.length >= max) return;
      const text = rowText(tree, c);
      if (text !== '') lines.push(`${indent}${'  '.repeat(depth)}- ${text}`);
      walk(c, depth + 1);
    }
  };
  walk(id, 0);
  return lines;
}

/** Title, note and the rows under the item, as the prompts describe it. */
function describeItem(tree: TreeReader, id: string): string[] {
  const node = tree.get(id)!;
  const note = node.note.trim().slice(0, ITEM_NOTE_CHARS);
  const children = subtreeLines(tree, id, ITEM_LINES);
  const path = pathText(tree, id);
  return [
    `Title: ${plainText(node.content).trim() || 'Untitled'}`,
    ...(path !== '' ? [`Inside: ${path}`] : []),
    ...(note !== '' ? ['Note:', note] : []),
    ...(children.length > 0 ? ['Items under it:', ...children] : []),
  ];
}

/**
 * The rest of the outline as numbered, indented rows, within `DIGEST_CHARS`.
 * Rows in `first` (text matches) and their parents always go in; then the
 * outline fills level by level, so every row sent has its parent above it.
 * Returns the text and each number's row id.
 */
export function outlineDigest(tree: TreeReader, id: string, first: readonly string[]): { text: string; rows: string[] } {
  const skip = new Set([id, ...descendantIds(tree, id)]);
  const all: { id: string; depth: number; text: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of tree.children(parent)) {
      if (skip.has(c)) continue;
      all.push({ id: c, depth, text: rowText(tree, c) });
      walk(c, depth + 1);
    }
  };
  walk(null, 0);
  const cost = (r: { depth: number; text: string }) => r.depth * 2 + r.text.length + 8;
  const byId = new Map(all.map((r) => [r.id, r]));
  const chosen = new Set<string>();
  let used = 0;
  const take = (rid: string) => {
    const r = byId.get(rid);
    if (!r || chosen.has(rid)) return;
    chosen.add(rid);
    used += cost(r);
  };
  for (const f of first) {
    if (used >= DIGEST_CHARS) break;
    for (const a of [...ancestorIds(tree, f)].reverse()) take(a);
    take(f);
  }
  const maxDepth = all.reduce((m, r) => Math.max(m, r.depth), 0);
  outer: for (let d = 0; d <= maxDepth; d++) {
    for (const r of all) {
      if (r.depth !== d || chosen.has(r.id)) continue;
      if (used + cost(r) > DIGEST_CHARS) break outer;
      take(r.id);
    }
  }
  const rows: string[] = [];
  const lines: string[] = [];
  for (const r of all) {
    if (!chosen.has(r.id) || r.text === '') continue;
    rows.push(r.id);
    lines.push(`${'  '.repeat(r.depth)}[${rows.length}] ${r.text}`);
  }
  return { text: lines.join('\n'), rows };
}

/** The prompt asking AI which rows relate to the item, with the number → id map to read its answer. */
export function relatedPrompt(tree: TreeReader, id: string, textHits: readonly string[]): { prompt: string; rows: string[] } {
  const digest = outlineDigest(tree, id, textHits);
  const prompt = [
    'Someone is looking at one item in their outliner (like WorkFlowy) and wants to see what else in their notes relates to it, so they can act on it.',
    '',
    'The item:',
    ...describeItem(tree, id),
    '',
    'The rest of their outline. [n] is the row number; indentation shows which row is inside which:',
    digest.text,
    '',
    `Pick up to ${MAX_AI_RELATED} rows that are really related to the item: the same subject or project, a decision, fact or task it depends on, or a near duplicate of it.`,
    'Skip rows that only share a common word, and rows that are just the item\'s parents. Prefer the most specific row over its parent unless the whole branch is related.',
    'Reply with JSON only, best first, like {"related":[{"row":12,"why":"reason in at most 10 words","duplicate":false}]}. Write "why" in the same language as the notes. Use {"related":[]} when nothing is related.',
  ].join('\n');
  return { prompt, rows: digest.rows };
}

/** AI's pick of related rows, as row ids; rows it made up or that are the item (or above it) are dropped. */
export function parseRelated(tree: TreeReader, id: string, text: string, rows: readonly string[]): RelatedItem[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI gave no list.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('AI gave a list that could not be read.');
  }
  const list = (parsed as { related?: unknown }).related;
  if (!Array.isArray(list)) throw new Error('AI gave a list that could not be read.');
  const skip = excludedIds(tree, id);
  const out: RelatedItem[] = [];
  for (const entry of list as { row?: unknown; why?: unknown; duplicate?: unknown }[]) {
    const n = typeof entry.row === 'number' ? entry.row : Number(entry.row);
    const rid = Number.isInteger(n) ? rows[n - 1] : undefined;
    if (!rid || skip.has(rid) || out.some((o) => o.id === rid) || tree.get(rid)?.deletedAt !== null) continue;
    out.push({
      id: rid,
      ...(typeof entry.why === 'string' && entry.why.trim() !== '' ? { why: one(entry.why, 120) } : {}),
      ...(entry.duplicate === true ? { duplicate: true } : {}),
    });
    if (out.length >= MAX_AI_RELATED) break;
  }
  return out;
}

export interface ChatTurn {
  role: 'user' | 'ai';
  text: string;
}

/**
 * The prompt for a question about the item. The item is row [0] and the
 * related rows are [1], [2]…, in `related` order, so answers can cite them.
 */
export function chatPrompt(tree: TreeReader, id: string, related: readonly string[], history: readonly ChatTurn[], question: string): string {
  const relatedLines: string[] = [];
  related.forEach((rid, i) => {
    const node = tree.get(rid);
    if (!node) return;
    const path = pathText(tree, rid);
    relatedLines.push(`[${i + 1}] ${rowText(tree, rid)}${path !== '' ? `  (inside: ${one(path, 120)})` : ''}`);
    const note = one(node.note, RELATED_NOTE_CHARS);
    if (note !== '') relatedLines.push(`    Note: ${note}`);
    relatedLines.push(...subtreeLines(tree, rid, RELATED_CHILD_LINES, '    '));
  });
  const turns = history.slice(-HISTORY_TURNS).map((t) => `${t.role === 'user' ? 'Them' : 'You'}: ${t.text}`);
  return [
    'You help someone act on one item in their outliner (like WorkFlowy). Base your answer on their notes below; say so plainly when the notes do not cover it.',
    '',
    'The item [0]:',
    ...describeItem(tree, id),
    ...(relatedLines.length > 0 ? ['', 'Related rows elsewhere in their outline:', ...relatedLines] : []),
    ...(turns.length > 0 ? ['', 'The conversation so far:', ...turns] : []),
    '',
    `Them: ${question}`,
    '',
    'Answer briefly, in the language they write in, as plain Markdown. When you give steps, ideas or a list, use "- " bullets, one short line each, so they can be added to the outline as items.',
    'Cite the rows you used as [n] right after the point, for example [2] or [0].',
  ].join('\n');
}

/** Citations like [2] or [1, 3] in an answer. */
const CITATION = /\s?\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g;

/** The answer with each citation as a `#cite-<n>` link the panel turns into a jump to that row. */
export function linkCitations(text: string, label: (n: number) => string | null): string {
  return text.replace(CITATION, (whole, list: string) => {
    const links = list
      .split(',')
      .map((s) => Number(s.trim()))
      .map((n) => {
        const l = label(n);
        return l === null ? null : ` [${l.replace(/[[\]]/g, '')}](#cite-${n})`;
      })
      .filter((l): l is string => l !== null);
    return links.length > 0 ? links.join('') : whole;
  });
}

/**
 * The answer as outline items to insert: its bullets (nested as written), or
 * one item per paragraph when it has none. Citations are dropped.
 */
export function answerItems(text: string): OutlineItem[] {
  const clean = text.replace(CITATION, '').replace(/[ \t]+$/gm, '');
  const lines = clean.split('\n');
  const bullet = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
  if (!lines.some((l) => bullet.test(l))) {
    return clean
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
      .filter((p) => p !== '')
      .map((content) => ({ content, note: '', children: [] }));
  }
  const roots: OutlineItem[] = [];
  const stack: { item: OutlineItem; indent: number }[] = [];
  for (const line of lines) {
    const m = bullet.exec(line);
    if (!m) continue; // lead-in and closing sentences stay in the chat
    const indent = m[1]!.replace(/\t/g, '    ').length;
    const item: OutlineItem = { content: m[2]!.trim(), note: '', children: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    (stack[stack.length - 1]?.item.children ?? roots).push(item);
    stack.push({ item, indent });
  }
  return roots;
}
