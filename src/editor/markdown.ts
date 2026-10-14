import markdownIt, { type MarkdownIt, type RendererRule } from 'markdown-it';
import { taskLists } from './task-list';

/**
 * Options the editors parse Markdown with (tiptap-markdown): markdown-it's
 * default preset, no raw HTML, bare links left as the text they are (so
 * editing keeps them as typed), no soft-break-to-<br>.
 */
export const markdownOptions = { html: false, linkify: false, breaks: false } as const;

/** Bare links: http(s):// and e-mail addresses, but not file names like "README.md". */
function bareLinks(m: MarkdownIt): void {
  m.set({ linkify: true });
  m.linkify.set({ fuzzyLink: false });
}

/**
 * Rendering: markdown-it's default (tables, strikethrough, images, code)
 * plus task lists and bare links. A node's own line takes inline Markdown only.
 */
const md: MarkdownIt = markdownIt(markdownOptions).use(taskLists).use(bareLinks);
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

// Images load lazily and don't tell their server which page showed them.
const defaultImage: RendererRule = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet('referrerpolicy', 'no-referrer');
  tokens[idx]!.attrSet('loading', 'lazy');
  return defaultImage(tokens, idx, options, env, self);
};

// Code blocks wrap long lines, except ones drawn with box characters
// (terminal tables), which only line up unwrapped.
const defaultFence: RendererRule = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const html = defaultFence(tokens, idx, options, env, self);
  return /[─-╿]/.test(tokens[idx]!.content) ? html.replace('<pre>', '<pre class="nowrap">') : html;
};

/** Inline Markdown → HTML (no wrapping <p>). Not sanitized. */
export function inlineToHtml(content: string): string {
  return mdInline.renderInline(content);
}

/** Block Markdown → HTML. Not sanitized. */
export function blockToHtml(note: string): string {
  return md.render(note);
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
