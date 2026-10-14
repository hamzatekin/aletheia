import markdownIt, { type MarkdownIt, type RendererRule } from 'markdown-it';
import { full as emoji } from 'markdown-it-emoji';
import footnotes from 'markdown-it-footnote';
import { alerts, allowedHtml, bareLinks, highlightCode } from './gfm';
import { taskLists } from './task-list';

/**
 * Options the editors parse Markdown with (tiptap-markdown): markdown-it's
 * default preset, raw HTML and bare links left as the text they are (so
 * editing keeps them as typed), no soft-break-to-<br>.
 */
export const markdownOptions = { html: false, linkify: false, breaks: false } as const;

/**
 * Rendering is GitHub's Markdown: on top of tables and strikethrough, task
 * lists, bare links, images, alerts, footnotes, :emoji: shortcodes, coloured
 * code and the HTML tags GitHub keeps. A node's own line takes inline Markdown and bare links only.
 */
const md: MarkdownIt = markdownIt({ ...markdownOptions, highlight: highlightCode })
  .use(taskLists)
  .use(bareLinks)
  .use(allowedHtml)
  .use(alerts)
  .use(footnotes)
  // :tada: shortcodes, but not :) and the like, which GitHub leaves alone.
  .use(emoji, { shortcuts: {} });
const mdInline: MarkdownIt = markdownIt(markdownOptions).use(bareLinks);

// Links open in a new tab; the editor owns clicks inside the outline.
for (const m of [md, mdInline]) {
  const defaultLinkOpen: RendererRule =
    m.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  m.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx]!.attrSet('target', '_blank');
    tokens[idx]!.attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen(tokens, idx, options, env, self);
  };
}

// Code blocks wrap long lines, except ones drawn with box characters
// (terminal tables), which only line up unwrapped.
const defaultFence: RendererRule = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const html = defaultFence(tokens, idx, options, env, self);
  return /[\u2500-\u257f]/.test(tokens[idx]!.content) ? html.replace('<pre>', '<pre class="nowrap">') : html;
};

/** Inline Markdown → HTML (no wrapping <p>). Not sanitized. */
export function inlineToHtml(content: string): string {
  return mdInline.renderInline(content);
}

/** Block Markdown → HTML. Not sanitized. `docId` keeps footnote anchors apart when several notes show at once. */
export function blockToHtml(note: string, docId?: string): string {
  return md.render(note, docId === undefined ? {} : { docId });
}

/** Plain text of inline Markdown (marks stripped). Used for titles and search. */
export function plainText(content: string): string {
  const tokens = mdInline.parseInline(content, {});
  let out = '';
  for (const block of tokens) {
    for (const t of block.children ?? []) {
      if (t.type === 'text' || t.type === 'code_inline') out += t.content;
      else if (t.type === 'softbreak' || t.type === 'hardbreak') out += ' ';
    }
  }
  return out;
}
