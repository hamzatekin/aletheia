import hljs from 'highlight.js/lib/common';
import type { MarkdownIt, RendererRule, StateCore, Token } from 'markdown-it';

/**
 * GitHub's Markdown on top of markdown-it's own (tables, strikethrough): the
 * pieces agents and READMEs use. Rendering only; the note editor keeps such
 * blocks as their source (note-source.ts).
 */

/** Bare links as GitHub makes them: http(s)://, www. and e-mail addresses, but not "README.md". */
export function bareLinks(md: MarkdownIt): void {
  md.set({ linkify: true });
  md.linkify.set({ fuzzyLink: true, fuzzyEmail: true });
  md.core.ruler.after('linkify', 'bare_links', (state: StateCore) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      const kept: Token[] = [];
      const children = block.children;
      for (let i = 0; i < children.length; i++) {
        const t = children[i]!;
        const text = children[i + 1];
        if (t.type === 'link_open' && t.markup === 'linkify' && text && !/^(https?:\/\/|www\.|mailto:)/i.test(text.content) && !text.content.includes('@')) {
          kept.push(text);
          i += 2; // the text and its link_close
          continue;
        }
        kept.push(t);
      }
      block.children = kept;
    }
  });
}

const ALERTS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)?/i;

/** The kind of a GitHub alert ("> [!NOTE]") starting `text`, and how long its marker is. */
export function alertMarker(text: string): { kind: (typeof ALERTS)[number]; length: number } | null {
  const m = ALERT_MARKER.exec(text);
  return m ? { kind: m[1]!.toLowerCase() as (typeof ALERTS)[number], length: m[0].length } : null;
}

/**
 * GitHub alerts: a quote starting with [!NOTE], [!TIP], [!IMPORTANT],
 * [!WARNING] or [!CAUTION] becomes a coloured callout titled with its kind.
 * The marker may also share its line with the text (the editor saves it so).
 */
export function alerts(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'github_alerts', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i + 2 < tokens.length; i++) {
      const [quote, para, inline] = [tokens[i]!, tokens[i + 1]!, tokens[i + 2]!];
      if (quote.type !== 'blockquote_open' || para.type !== 'paragraph_open' || inline.type !== 'inline') continue;
      const first = inline.children?.[0];
      const marker = first?.type === 'text' ? alertMarker(first.content) : null;
      if (!marker || !first) continue;
      quote.attrJoin('class', `markdown-alert markdown-alert-${marker.kind}`);
      first.content = first.content.slice(marker.length).replace(/^[ \t]+/, '');
      // A marker alone on its line is followed by a line break; drop it with the marker.
      const next = inline.children![1];
      if (first.content === '' && (next?.type === 'softbreak' || next?.type === 'hardbreak')) inline.children!.splice(1, 1);
      const title = new state.Token('html_inline', '', 0);
      title.content = `<span class="markdown-alert-title">${marker.kind[0]!.toUpperCase()}${marker.kind.slice(1)}</span>`;
      title.meta = { trusted: true };
      inline.children!.unshift(title);
    }
  });
}

/**
 * HTML tags GitHub keeps in Markdown (its sanitizer's list, minus forms and
 * media): <br>, <kbd>, <sub>, <details> and the like render; any other tag,
 * such as <Component> in a sentence, shows as the text it is.
 */
export const HTML_TAGS = [
  'a', 'abbr', 'b', 'bdo', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'picture',
  'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'source', 'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul', 'var', 'wbr',
];
const allowed = new Set(HTML_TAGS);
const TAG = /^<\/?([A-Za-z][A-Za-z0-9-]*)/;

/** Whether raw HTML from a note may render (comments may, and are dropped by the sanitizer). */
function renders(html: string): boolean {
  if (html.startsWith('<!--')) return true;
  const name = TAG.exec(html)?.[1];
  return name !== undefined && allowed.has(name.toLowerCase());
}

export function allowedHtml(md: MarkdownIt): void {
  md.set({ html: true });
  const escape = md.utils.escapeHtml;
  const inline: RendererRule = (tokens, idx) => {
    const t = tokens[idx]!;
    return (t.meta as { trusted?: boolean } | null)?.trusted || renders(t.content) ? t.content : escape(t.content);
  };
  md.renderer.rules.html_inline = inline;
  md.renderer.rules.html_block = (tokens, idx) => {
    const html = tokens[idx]!.content;
    return renders(html.trimStart()) ? html : `<p>${escape(html.trimEnd())}</p>\n`;
  };
}

/** Colours code in fences that name a language GitHub's highlighter knows (highlight.js's common set). */
export function highlightCode(code: string, lang: string): string {
  const language = lang.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!language || !hljs.getLanguage(language)) return '';
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return '';
  }
}
