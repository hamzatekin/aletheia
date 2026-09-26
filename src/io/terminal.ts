/**
 * Text copied out of a terminal (typically Claude Code's answers) is Markdown
 * that the terminal already rendered: lists and paragraphs survive as they
 * are, but tables come out drawn with box characters. These helpers turn it
 * back into Markdown that renders (and wraps) like any other note.
 */

const VERTICAL = /[│┃║]/;
const BOX = /[─-╿]/;
/** A table border or row separator: only box-drawing characters and spaces. */
const RULE = /^[\s─-╿]+$/;

function isRule(line: string): boolean {
  return RULE.test(line) && BOX.test(line) && !VERTICAL.test(line.replace(/[┼╋╬├┤┝┥┠┨┣┫╠╣╞╡╟╢┌┐└┘┏┓┗┛╔╗╚╝╭╮╯╰┬┴┳┻╦╩─━═]/g, ''));
}

function isRow(line: string): boolean {
  return VERTICAL.test(line.trimStart()[0] ?? '');
}

function cellsOf(line: string): string[] {
  const parts = line.trim().split(/[│┃║]/);
  // Leading and trailing bars leave empty ends.
  return parts.slice(1, parts.length - 1).map((c) => c.trim());
}

const escapeCell = (text: string): string => text.replace(/\|/g, '\\|');

/** One box-drawn table (its lines, borders included) as a GFM table, or null if it isn't one. */
function boxTableToGfm(lines: string[]): string | null {
  // Rules split the table into groups of lines. When rules separate every body
  // row, each group is one row wrapped over several lines; when only the header
  // has a rule under it, each body line is its own row.
  const groups: string[][][] = [];
  let group: string[][] = [];
  for (const line of lines) {
    if (isRule(line)) {
      if (group.length > 0) groups.push(group);
      group = [];
    } else group.push(cellsOf(line));
  }
  if (group.length > 0) groups.push(group);
  const join = (g: string[][]): string[] =>
    Array.from({ length: Math.max(...g.map((r) => r.length)) }, (_, i) =>
      g.map((r) => r[i] ?? '').filter(Boolean).join(' '),
    );
  const [head, ...body] = groups;
  if (!head) return null;
  const rows = [join(head), ...(body.length === 1 ? body[0]!.map((r) => join([r])) : body.map(join))];
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (width === 0) return null;
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => escapeCell(r[i] ?? '')).join(' | ')} |`;
  return [line(rows[0]!), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

/** Whether `text` contains a box-drawn table. */
export function hasBoxTable(text: string): boolean {
  const lines = text.split('\n');
  return lines.some((l, i) => isRule(l) && lines.slice(i + 1, i + 3).some(isRow));
}

/** Replace every box-drawn table in `text` with a GFM table; everything else is kept. */
export function boxTablesToMarkdown(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const starts = isRule(lines[i]!) || isRow(lines[i]!);
    if (!starts || !hasBoxTable(lines.slice(i, i + 4).join('\n')) && !isRow(lines[i]!)) {
      out.push(lines[i]!);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && (isRule(lines[j]!) || isRow(lines[j]!))) j++;
    const block = lines.slice(i, j);
    const table = block.some(isRule) && block.some(isRow) ? boxTableToGfm(block) : null;
    if (table) {
      // Tables need a blank line around them to parse.
      if (out.length > 0 && out[out.length - 1]!.trim() !== '') out.push('');
      out.push(table);
      if (j < lines.length && lines[j]!.trim() !== '') out.push('');
    } else out.push(...block);
    i = j;
  }
  return out.join('\n');
}

/** Drop the indentation every non-blank line shares. */
function dedent(text: string): string {
  const lines = text.split('\n');
  const indents = lines.filter((l) => l.trim() !== '').map((l) => /^[ \t]*/.exec(l)![0].length);
  const cut = indents.length > 0 ? Math.min(...indents) : 0;
  return cut === 0 ? text : lines.map((l) => l.slice(Math.min(cut, /^[ \t]*/.exec(l)![0].length))).join('\n');
}

/**
 * Terminal output → Markdown: Claude Code's "⏺" markers and the shared indent
 * go, "•" bullets become list items, ─── lines become rules and box tables
 * become tables.
 */
export function terminalToMarkdown(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // Same width as the marker, so continuation lines still line up.
    .map((l) => l.replace(/^(\s*)⏺ ?/, '$1  ').replace(/\s+$/, ''));
  const out: string[] = [];
  for (const line of boxTablesToMarkdown(dedent(lines.join('\n'))).split('\n')) {
    if (/^\s*[─━═]{3,}\s*$/.test(line)) {
      // A blank line first, or "---" would underline the paragraph above as a heading.
      if (out.length > 0 && out[out.length - 1]!.trim() !== '') out.push('');
      out.push('---', '');
    } else out.push(line.replace(/^(\s*)[•●◦▪]\s+/, '$1- '));
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
}

const CODE_LINE = /^\s*(?:[{}()[\];]|\/\/|#include|import\s|export\s|const\s|let\s|var\s|function\b|def\s|class\s|return\b|if\s*\(|for\s*\(|\$\s|>\s|<\/?[a-z])|[{;]\s*$/i;

/**
 * Whether a "code block" is really prose, as when terminal answers are pasted
 * into WorkFlowy's code block to keep their line breaks: it has a box table, or
 * most of its lines are sentences rather than code.
 */
export function looksLikeTerminalProse(code: string): boolean {
  if (hasBoxTable(code)) return true;
  const lines = code.split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) return false;
  const prose = lines.filter((l) => {
    if (CODE_LINE.test(l)) return false;
    const words = l.trim().replace(/^([-*•]|\d+[.)])\s+/, '').split(/\s+/);
    const letters = (l.match(/[\p{L}]/gu) ?? []).length;
    return words.length >= 4 && letters / l.trim().length > 0.6;
  });
  return prose.length / lines.length >= 0.6;
}

/** Whether pasted text is terminal output worth converting: a box table or a Claude Code answer. */
export function isTerminalPaste(text: string): boolean {
  return hasBoxTable(text) || /^\s*⏺ /m.test(text);
}

const NOTE_FENCE = /^(`{3,}|~{3,})[^\n]*\n([^]*?)\n?\1[`~]*[ \t]*$/gm;

/**
 * A note with terminal output in it, cleaned up: code blocks that are really
 * prose or box tables become Markdown, and so do box tables outside code
 * blocks. Real code blocks are left alone.
 */
export function formatTerminalNote(note: string): string {
  let out = '';
  let last = 0;
  for (const m of note.matchAll(NOTE_FENCE)) {
    out += boxTablesToMarkdown(note.slice(last, m.index));
    out += looksLikeTerminalProse(m[2]!) ? terminalToMarkdown(m[2]!) : m[0];
    last = m.index + m[0].length;
  }
  out += boxTablesToMarkdown(note.slice(last));
  return out === note ? note : out.replace(/\n{3,}/g, '\n\n');
}

/** Content with Claude Code's leading "⏺" marker removed. */
export function formatTerminalContent(content: string): string {
  return content.replace(/^⏺\s*/, '');
}
