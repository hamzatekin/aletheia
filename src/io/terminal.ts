/**
 * Text copied out of a terminal (typically Claude Code's answers) is Markdown
 * that the terminal already rendered: lists and paragraphs survive as they
 * are, but tables come out drawn with box characters. These helpers turn it
 * back into Markdown that renders (and wraps) like any other note.
 */

import { decodeEntities, dedent } from './workflowy';

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

const LINUX_MARKER = /^● /;

/**
 * Lines with Claude Code's answer markers turned into spaces of the same
 * width, so continuation lines still line up. The marker is "⏺" on macOS and
 * "●" elsewhere; a "●" counts only at the very start of a line, and not next
 * to another such line, which makes the two of them list bullets.
 */
function unmarkLines(lines: string[]): string[] {
  return lines.map((l, i) => (hasLinuxMarker(lines, i) ? `  ${l.slice(2)}` : l.replace(/^(\s*)⏺ ?/, '$1  ')));
}

function hasLinuxMarker(lines: string[], i: number): boolean {
  return LINUX_MARKER.test(lines[i]!) && !LINUX_MARKER.test(lines[i - 1] ?? '') && !LINUX_MARKER.test(lines[i + 1] ?? '');
}

/**
 * Terminal output → Markdown: Claude Code's "⏺"/"●" markers and the shared
 * indent go, "•" bullets become list items, ─── lines become rules and box
 * tables become tables.
 */
export function terminalToMarkdown(text: string): string {
  const lines = unmarkLines(text.replace(/\r\n?/g, '\n').split('\n')).map((l) => l.replace(/\s+$/, ''));
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

interface Run {
  text: string;
  bold: boolean;
  code: boolean;
}

const HTML_TAG = /<!--[^]*?-->|<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi;
const PRE_STYLE = /white-space\s*:\s*pre\b/;

function styleOf(attrs: string): string {
  const m = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  return (m?.[1] ?? m?.[2] ?? '').toLowerCase();
}

/** A CSS text color, as "p<slot>" for a terminal palette slot or "r,g,b", or null. */
function colorOf(style: string): string | null {
  const value = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(style)?.[1] ?? '';
  const palette = /var\(--vt-palette-(\d+)\)/.exec(value);
  if (palette) return `p${palette[1]}`;
  const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value);
  if (rgb) return rgb.slice(1, 4).join(',');
  const hex = /#([0-9a-f]{3}|[0-9a-f]{6})\b/.exec(value)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(',');
}

/**
 * Whether text in this color stands out: a hue, not white, black or grey.
 * Claude Code colors inline code (blue); its secondary text is grey or dimmed.
 */
function isHue(color: string): boolean {
  if (color.startsWith('p')) {
    // Slots 1-6 and 9-14 are the red to cyan of the 16 basic colors.
    const slot = Number(color.slice(1));
    return slot < 16 && slot % 8 >= 1 && slot % 8 <= 6;
  }
  const rgb = color.split(',').map(Number);
  return Math.max(...rgb) - Math.min(...rgb) >= 48;
}

/** One line's runs as Markdown: bold as **…**, colored text as `…`. */
function markLine(runs: Run[]): string {
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === run.bold && last.code === run.code) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged
    .map(({ text, bold, code }) => {
      const [, lead, core, trail] = /(\s*)([^]*?)(\s*)$/.exec(text)!;
      // Marks only around words: a colored bullet or table border stays as it is.
      if (!/[\p{L}\p{N}]/u.test(core!)) return text;
      const inner = code && !core!.includes('`') ? `\`${core}\`` : core!;
      return lead + (bold ? `**${inner}**` : inner) + trail;
    })
    .join('');
}

/**
 * Styled terminal output from the clipboard's HTML (Ghostty, Windows Terminal
 * and others copy it alongside the text) as text with Markdown marks: bold
 * stays bold and colored words become inline code, the way Claude Code drew
 * them. Only the terminal's block counts (one with `white-space: pre`, or a
 * <pre>); null when there is none.
 */
export function terminalHtmlToText(html: string): string | null {
  type Frame = { tag: string; bold: boolean; color: string | null };
  // The elements open inside the terminal's block, the block itself first.
  const stack: Frame[] = [];
  const lines: Run[][] = [[]];
  let base: string | null = null;
  let found = false;
  const add = (raw: string) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    const code = top.color !== base && isHue(top.color ?? '');
    decodeEntities(raw)
      .replace(/\u00a0/g, ' ')
      .split(/\r?\n/)
      .forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part !== '') lines[lines.length - 1]!.push({ text: part, bold: top.bold, code });
      });
  };
  let last = 0;
  for (const m of html.matchAll(HTML_TAG)) {
    add(html.slice(last, m.index));
    last = m.index + m[0].length;
    const [, close, name, attrs] = m;
    if (!name) continue;
    const tag = name.toLowerCase();
    const top = stack[stack.length - 1];
    if (tag === 'br') {
      if (top) lines.push([]);
    } else if (close) {
      const at = stack.findLastIndex((f) => f.tag === tag);
      if (at >= 0) stack.length = at;
      // The block is over; what follows is the clipboard's packaging.
      if (found && stack.length === 0) return lines.map(markLine).join('\n');
    } else {
      const style = styleOf(attrs!);
      if (!top && tag !== 'pre' && !PRE_STYLE.test(style)) continue;
      const color = colorOf(style);
      if (!top) {
        found = true;
        base = color;
      }
      stack.push({
        tag,
        bold: (top?.bold ?? false) || tag === 'b' || tag === 'strong' || /font-weight\s*:\s*(bold|[6-9]00)/.test(style),
        color: color ?? top?.color ?? null,
      });
    }
  }
  add(html.slice(last));
  return found ? lines.map(markLine).join('\n') : null;
}

/** Whether pasted text is terminal output worth converting: a box table or a Claude Code answer. */
export function isTerminalPaste(text: string): boolean {
  if (hasBoxTable(text) || /^\s*⏺ /m.test(text)) return true;
  const lines = text.split(/\r?\n/);
  return lines.some((_, i) => hasLinuxMarker(lines, i));
}

/**
 * What a paste into a note becomes when it is terminal output, as Markdown, or
 * null to paste it as usual. Styled copies keep bold and colored words. HTML
 * counts as a terminal's when the text is a Claude Code answer or a box table,
 * or when its styles sit on inline boxes (Ghostty, Windows Terminal): code
 * copied from an editor such as VS Code also uses `white-space: pre`, but
 * with a block per line, and stays a normal paste.
 */
export function terminalPasteMarkdown(text: string, html: string): string | null {
  const terminal = isTerminalPaste(text);
  const styled = terminal || /display\s*:\s*inline/i.test(html) ? terminalHtmlToText(html) : null;
  if (styled !== null) return terminalToMarkdown(styled);
  return terminal ? terminalToMarkdown(text) : null;
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

/** Content with Claude Code's leading "⏺" or "●" marker removed. */
export function formatTerminalContent(content: string): string {
  return content.replace(/^⏺\s*|^● +/, '');
}
