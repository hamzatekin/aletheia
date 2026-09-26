/**
 * WorkFlowy puts rich text into OPML `text` / `_note` attributes as a small
 * HTML dialect: <b>, <i>, <u>, <s>, <a href>, <span class="colored …">,
 * <span class="mention">, <time …>date</time> and <br>. Literal & < > in the
 * user's text arrive entity-encoded inside that HTML. This turns it into the
 * inline Markdown nodes store.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const TAG = /<(\/?)([a-z]+)\b([^>]*?)\/?>/gi;
const KNOWN = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'pre', 'a', 'span', 'time', 'br', 'mark', 'font']);
const PAIRED = new Set([...KNOWN].filter((t) => t !== 'br'));

/** True when `text` holds WorkFlowy-style HTML: only known tags, all balanced. */
export function looksLikeWorkflowyHtml(text: string): boolean {
  const stack: string[] = [];
  let found = false;
  for (const m of text.matchAll(TAG)) {
    const name = m[2]!.toLowerCase();
    if (!KNOWN.has(name)) return false;
    found = true;
    if (name === 'br') continue;
    if (m[1] === '/') {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return found && stack.length === 0;
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null;
}

const MARKS: Record<string, string> = { b: '**', strong: '**', i: '*', em: '*', s: '~~', strike: '~~', del: '~~', code: '`' };

/**
 * WorkFlowy HTML → inline Markdown. Underline, colors, highlights and mention
 * spans have no Markdown form, so they keep their text and drop the styling.
 * `<br>` becomes a newline in notes and a space in single-line content.
 */
export function workflowyHtmlToMarkdown(html: string, multiline = false): string {
  let out = '';
  let last = 0;
  // Open paired tags with where their text starts in `out` (and the link target for <a>).
  const open: { name: string; start: number; href: string }[] = [];
  for (const m of html.matchAll(TAG)) {
    out += decodeEntities(html.slice(last, m.index));
    last = m.index! + m[0].length;
    const name = m[2]!.toLowerCase();
    if (name === 'br') {
      out += multiline ? '\n' : ' ';
      continue;
    }
    if (!PAIRED.has(name)) continue;
    if (m[1] !== '/') {
      open.push({ name, start: out.length, href: name === 'a' ? (attr(m[3]!, 'href') ?? '') : '' });
      continue;
    }
    const tag = open.pop();
    if (!tag) continue;
    const mark = MARKS[tag.name];
    if (!mark && !(tag.name === 'a' && tag.href !== '')) continue;
    // Markdown marks must hug the text ("**x** ", not "** x **"), so keep edge spaces outside.
    const inner = out.slice(tag.start);
    const body = inner.trim();
    const lead = inner.slice(0, inner.length - inner.trimStart().length);
    const tail = inner.slice(inner.trimEnd().length);
    let wrapped: string;
    if (mark) wrapped = body === '' ? '' : `${mark}${body}${mark}`;
    else wrapped = body === '' || body === tag.href ? `<${tag.href}>` : `[${body}](${tag.href})`;
    out = out.slice(0, tag.start) + (body === '' ? inner : lead + wrapped + tail);
    if (body === '' && !mark) out += `<${tag.href}>`;
  }
  out += decodeEntities(html.slice(last));
  return multiline ? out.replace(/[ \t]+$/gm, '') : out.replace(/\s+/g, ' ').trim();
}

const CODE_SPAN = /<(code|pre)\b[^>]*>([^]*?)<\/\1>/gi;

/** Plain text of a code span: <br> is a newline, other tags go, entities decode. */
function codeText(inner: string): string {
  return decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''));
}

/** A fenced Markdown code block, with a fence longer than any backtick run inside. */
export function fencedBlock(code: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}\n${code.replace(/^\n+|\s+$/g, '')}\n${fence}`;
}

/**
 * WorkFlowy code blocks are <code>/<pre> spans with line breaks inside. Inline
 * Markdown can't hold those, so they are cut out of `html` and returned as
 * fenced blocks for the note, leaving `placeholder` where each was. Single-line
 * code stays inline.
 */
export function extractWorkflowyCodeBlocks(html: string, placeholder = ' '): { html: string; blocks: string[] } {
  const blocks: string[] = [];
  const rest = html.replace(CODE_SPAN, (whole, _tag: string, inner: string) => {
    const code = codeText(inner);
    if (!code.trim().includes('\n')) return whole;
    blocks.push(code);
    return placeholder;
  });
  return { html: rest, blocks };
}

/** A short title for a node that was only a code block: its first line. */
export function codeTitle(code: string): string {
  const line = code.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}
