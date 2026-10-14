import type { MarkdownIt, StateBlock, StateInline } from 'markdown-it';

/**
 * Math as GitHub writes it: $inline$, $`inline`$ and $$display$$ blocks
 * (```math fences are handled with the other fences). An inline $ must hug
 * its formula ("$x$", not "$ x $") and the closing one can't run into a
 * digit, so "$5 and $10" stays money.
 */

/** The inline formula starting at `pos` (a "$"): its TeX and where it ends, or null. */
export function inlineMathAt(src: string, pos: number): { tex: string; end: number } | null {
  if (src[pos] !== '$') return null;
  if (src[pos + 1] === '`') {
    const close = src.indexOf('`$', pos + 2);
    return close > pos + 2 ? { tex: src.slice(pos + 2, close), end: close + 2 } : null;
  }
  const first = src[pos + 1];
  if (first === undefined || first === '$' || /\s/.test(first)) return null;
  for (let end = pos + 1; (end = src.indexOf('$', end)) !== -1; end++) {
    if (src[end - 1] === '\\') continue;
    if (/\s/.test(src[end - 1]!) || /\d/.test(src[end + 1] ?? '') || src.slice(pos + 1, end).includes('\n\n')) return null;
    return { tex: src.slice(pos + 1, end), end: end + 1 };
  }
  return null;
}

/** [from, to) of every inline formula in `text`, as the renderer finds them. */
export function inlineMathSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '$') {
      const math = inlineMathAt(text, i);
      if (math) {
        spans.push([i, math.end]);
        i = math.end - 1;
      }
    }
  }
  return spans;
}

const installed = new WeakSet<MarkdownIt>();

/**
 * The math syntax as tokens. `render` decides how they show: "placeholder"
 * for rendered notes (spans and divs that KaTeX fills in, see draw-math.ts),
 * "source" for the note editor, which shows inline formulas as the text they
 * are and $$ blocks as ```math code blocks, so editing never touches TeX
 * (backslashes, underscores) the way Markdown would.
 */
export function math(md: MarkdownIt, { render }: { render: 'placeholder' | 'source' }): void {
  // The note editor's parser runs its setup again on every parse.
  if (installed.has(md)) return;
  installed.add(md);
  const escape = md.utils.escapeHtml;
  md.inline.ruler.after('escape', 'math_inline', (state: StateInline, silent: boolean) => {
    const found = inlineMathAt(state.src, state.pos);
    if (!found) return false;
    if (!silent) {
      const token = state.push('math_inline', 'span', 0);
      token.content = found.tex;
      token.markup = state.src.slice(state.pos, found.end);
    }
    state.pos = found.end;
    return true;
  });
  md.block.ruler.before('fence', 'math_block', (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
    if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
    const lineText = (line: number) => state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]);
    const opening = lineText(startLine);
    if (!opening.startsWith('$$')) return false;
    let tex: string;
    let last = startLine;
    const rest = opening.slice(2).trimEnd();
    if (rest.endsWith('$$') && rest.length >= 2) tex = rest.slice(0, -2);
    else {
      const lines = rest ? [rest] : [];
      for (last = startLine + 1; last < endLine; last++) {
        const text = lineText(last).trimEnd();
        if (text.endsWith('$$')) {
          if (text.length > 2) lines.push(text.slice(0, -2));
          break;
        }
        lines.push(text);
      }
      if (last >= endLine) return false; // never closed: ordinary text
      tex = lines.join('\n');
    }
    if (silent) return true;
    const token = state.push('math_block', 'div', 0);
    token.content = tex.trim();
    token.map = [startLine, last + 1];
    token.markup = '$$';
    token.block = true;
    state.line = last + 1;
    return true;
  });
  md.renderer.rules.math_inline = (tokens, idx) =>
    render === 'source' ? escape(tokens[idx]!.markup) : `<span class="math-inline">${escape(tokens[idx]!.content)}</span>`;
  md.renderer.rules.math_block = (tokens, idx) =>
    render === 'source'
      ? `<pre><code class="language-math">${escape(tokens[idx]!.content)}\n</code></pre>\n`
      : `<div class="math-display">${escape(tokens[idx]!.content)}</div>\n`;
}
