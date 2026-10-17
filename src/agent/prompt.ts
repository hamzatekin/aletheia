import { plainText } from '@/editor/markdown';
import { ancestorIds, isLive, type TreeReader } from '@/model';
import type { SearchIndex } from '@/search';

/**
 * Rows are shown to AI by number ([12]) rather than by id: short, and AI can
 * only name rows it was shown. Numbers start at 1 and stay fixed for a run.
 */
export class Refs {
  private readonly nums = new Map<string, number>();
  private readonly ids: string[] = [];

  ref(id: string): number {
    let n = this.nums.get(id);
    if (n === undefined) {
      this.ids.push(id);
      n = this.ids.length;
      this.nums.set(id, n);
    }
    return n;
  }

  id(n: number): string | undefined {
    return Number.isInteger(n) ? this.ids[n - 1] : undefined;
  }

  /** Row ids by number: `[n]` is `list()[n - 1]`. */
  list(): string[] {
    return [...this.ids];
  }
}

export interface ChatTurn {
  role: 'user' | 'ai';
  text: string;
}

/** One read AI asked for. */
export type Read = { search: string } | { open: number };

/** What AI replied in one step: more reads, or the answer and the changes to make. */
export type Reply = { reads: Read[] } | { answer: string; changes: unknown[] };

export const MAX_STEPS = 6;
const MAX_READS = 5;
const ROW_CHARS = 120;
const NOTE_CHARS = 2_000;
const SEARCH_HITS = 15;
const OPEN_LINES = 60;
const TOP_LINES = 120;
const HISTORY_TURNS = 6;

const one = (text: string, max: number) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const title = (tree: TreeReader, id: string) => one(plainText(tree.get(id)?.content ?? ''), ROW_CHARS) || 'Untitled';
const path = (tree: TreeReader, id: string) =>
  ancestorIds(tree, id)
    .reverse()
    .map((a) => title(tree, a))
    .join(' › ');

/** "[12] Title" with what AI may want to know before opening it. */
function rowLine(tree: TreeReader, refs: Refs, id: string, withPath: boolean): string {
  const node = tree.get(id)!;
  const kids = tree.children(id).length;
  const where = withPath ? path(tree, id) : '';
  const extra = [
    ...(where !== '' ? [`inside: ${one(where, 120)}`] : []),
    ...(node.note.trim() !== '' ? ['has a note'] : []),
    ...(kids > 0 ? [`${kids} inside`] : []),
    ...(node.starredAt ? ['starred'] : []),
  ];
  return `[${refs.ref(id)}] ${title(tree, id)}${extra.length > 0 ? `  (${extra.join(', ')})` : ''}`;
}

/** The rows under `parent` (null = top level), indented, to `depth` levels, cut after `max` lines. */
function treeLines(tree: TreeReader, refs: Refs, parent: string | null, depth: number, max: number): string[] {
  const lines: string[] = [];
  const walk = (p: string | null, d: number) => {
    for (const c of tree.children(p)) {
      if (lines.length >= max) return;
      lines.push(`${'  '.repeat(d)}${rowLine(tree, refs, c, false)}`);
      if (d + 1 < depth) walk(c, d + 1);
    }
  };
  walk(parent, 0);
  const total = tree.children(parent).length;
  if (lines.length >= max && total > 0) lines.push('  …more, open or search to see them');
  return lines;
}

/** A row in full: where it is, its note, and what's inside it. */
function openLines(tree: TreeReader, refs: Refs, id: string): string[] {
  const node = tree.get(id)!;
  const where = path(tree, id);
  const note = node.note.trim();
  const inside = treeLines(tree, refs, id, 3, OPEN_LINES);
  return [
    `[${refs.ref(id)}] ${title(tree, id)}  (inside: ${where !== '' ? where : 'top level'})`,
    ...(note !== '' ? ['Note:', note.length > NOTE_CHARS ? `${note.slice(0, NOTE_CHARS)}…` : note] : []),
    ...(inside.length > 0 ? ['Inside it:', ...inside] : ['Nothing inside it.']),
  ];
}

const RULES = [
  'You are the assistant inside Aletheia, an outliner like WorkFlowy. You can read the person\'s notes and change them for them.',
  'Rows are named by number, like [12]. Only use numbers you have been shown.',
  '',
  'Reply with exactly one JSON object and nothing else. Either:',
  `- To look further: {"read":[{"search":"words"},{"open":12}]}. "search" finds rows by their words (best ${SEARCH_HITS}); "open" shows a row's note and the rows inside it. Up to ${MAX_READS} reads per step; read only what you need.`,
  '- To finish: {"answer":"...","changes":[...]}',
  '',
  'Changes run in order, and one Undo takes them all back:',
  '- {"create":{"under":12,"text":"Title","note":"optional","at":"last","as":"a"}}: a new row. "under" is a row number, or "top" for the top level. "at" is "first" or "last". "as" names the new row so later changes can use "a" as a row.',
  '- {"move":{"row":12,"under":7,"at":"last"}}: moves the row with everything inside it.',
  '- {"edit":{"row":12,"text":"New title","note":"New note"}}: give only the parts that change.',
  '- {"star":{"row":12,"on":true}}',
  'You cannot delete. Only change things when they ask you to; when they only ask a question, "changes" is [].',
  '"answer" is short, in the language they write in, as plain Markdown. Cite rows you used like [12]. If you changed things, say what you did in one line.',
];

/** The opening prompt: how to reply, where they are, the top of their outline, and the question. */
export function startPrompt(o: {
  tree: TreeReader;
  refs: Refs;
  item: string | null;
  related: readonly string[];
  history: readonly ChatTurn[];
  question: string;
}): string {
  const { tree, refs, item } = o;
  const here = item && isLive(tree.get(item)) ? ['', 'They are on this row:', ...openLines(tree, refs, item)] : ['', 'They are on the home page (the whole outline).'];
  const related = o.related.filter((r) => isLive(tree.get(r)));
  const turns = o.history.slice(-HISTORY_TURNS).map((t) => `${t.role === 'user' ? 'Them' : 'You'}: ${t.text}`);
  return [
    ...RULES,
    ...here,
    ...(related.length > 0 ? ['', 'Rows elsewhere that seem related to it:', ...related.map((r) => rowLine(tree, refs, r, true))] : []),
    '',
    'The top of their outline:',
    ...treeLines(tree, refs, null, 2, TOP_LINES),
    ...(turns.length > 0 ? ['', 'The conversation so far:', ...turns] : []),
    '',
    `Them: ${o.question}`,
  ].join('\n');
}

/** What each read found, as the next message to AI. */
export function readResults(tree: TreeReader, search: SearchIndex, refs: Refs, reads: readonly Read[], last: boolean): string {
  const out: string[] = [];
  for (const r of reads.slice(0, MAX_READS)) {
    if ('search' in r) {
      out.push(`search "${r.search}":`);
      let hits = search.search(r.search, SEARCH_HITS);
      // Every word must match for search(); fall back to any word.
      if (hits.length === 0) hits = search.searchAny(r.search.split(/\s+/).filter((w) => w.length >= 2), () => 1, SEARCH_HITS);
      const live = hits.map((h) => h.id).filter((id) => isLive(tree.get(id)));
      out.push(...(live.length > 0 ? live.map((id) => rowLine(tree, refs, id, true)) : ['No rows match.']));
    } else {
      const id = refs.id(r.open);
      out.push(`open [${r.open}]:`);
      out.push(...(id && isLive(tree.get(id)) ? openLines(tree, refs, id) : ['There is no such row.']));
    }
    out.push('');
  }
  out.push(last ? 'This is your last step: answer now with what you have.' : 'Reply with your next JSON object.');
  return ['Results:', ...out].join('\n');
}

/**
 * Read one reply. Anything that isn't one of the two JSON shapes is taken
 * as a plain answer, so a model that forgets the format still gets heard.
 */
export function parseReply(text: string): Reply {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { read?: unknown; answer?: unknown; changes?: unknown };
      if (typeof parsed.answer === 'string') return { answer: parsed.answer.trim(), changes: Array.isArray(parsed.changes) ? parsed.changes : [] };
      if (Array.isArray(parsed.read)) {
        const reads: Read[] = [];
        for (const r of parsed.read as { search?: unknown; open?: unknown }[]) {
          if (typeof r?.search === 'string' && r.search.trim() !== '') reads.push({ search: r.search.trim() });
          else if (typeof r?.open === 'number' || (typeof r?.open === 'string' && /^\d+$/.test(r.open))) reads.push({ open: Number(r.open) });
        }
        if (reads.length > 0) return { reads };
      }
    } catch {
      // not JSON after all: a plain answer
    }
  }
  return { answer: text.trim(), changes: [] };
}

/** What the progress line says while a read runs. */
export function readLabel(tree: TreeReader, refs: Refs, r: Read): string {
  if ('search' in r) return `Searching “${one(r.search, 40)}”`;
  const id = refs.id(r.open);
  return `Reading ${id && tree.get(id) ? `“${one(title(tree, id), 40)}”` : 'a row'}`;
}
