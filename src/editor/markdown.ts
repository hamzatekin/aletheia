import markdownIt, { type MarkdownIt, type RendererRule } from 'markdown-it';

/**
 * The single Markdown dialect used everywhere: static rendering here and
 * tiptap-markdown in the editor share these options (markdown-it default
 * preset, no raw HTML, no linkify, no soft-break-to-<br>).
 */
export const markdownOptions = { html: false, linkify: false, breaks: false } as const;

export const md: MarkdownIt = markdownIt(markdownOptions);

// Links open in a new tab; the editor owns clicks inside the outline.
const defaultLinkOpen: RendererRule =
  md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet('target', '_blank');
  tokens[idx]!.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** Inline Markdown → HTML (no wrapping <p>). Not sanitized. */
export function inlineToHtml(content: string): string {
  return md.renderInline(content);
}

/** Block Markdown → HTML. Not sanitized. */
export function blockToHtml(note: string): string {
  return md.render(note);
}

/** Plain text of inline Markdown (marks stripped). Used for titles and search. */
export function plainText(content: string): string {
  const tokens = md.parseInline(content, {});
  let out = '';
  for (const block of tokens) {
    for (const t of block.children ?? []) {
      if (t.type === 'text' || t.type === 'code_inline') out += t.content;
      else if (t.type === 'softbreak' || t.type === 'hardbreak') out += ' ';
    }
  }
  return out;
}
