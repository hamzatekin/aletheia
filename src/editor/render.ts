import DOMPurify from 'dompurify';
import { blockToHtml, inlineToHtml } from './markdown';
import { HTML_TAGS } from './gfm';

import type { Config } from 'dompurify';

/** Classes the renderer itself sets (code colours, alerts, footnotes, terminal tables, math); others are dropped. */
const OWN_CLASS = /^(hljs(-[\w-]+)?|language-[\w+#.-]+|markdown-alert(-[\w-]+)?|footnotes?(-[\w-]+)?|footnote-(ref|item|backref)|nowrap|math-(inline|display))$/;

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'class') data.attrValue = data.attrValue.split(/\s+/).filter((c) => OWN_CLASS.test(c)).join(' ');
  // Styles only align table columns (":---:" in Markdown).
  if (data.attrName === 'style') {
    const align = /^text-align:\s*(left|center|right);?$/.exec(data.attrValue.trim())?.[1];
    if (align && (node.nodeName === 'TH' || node.nodeName === 'TD')) data.attrValue = `text-align: ${align}`;
    else data.keepAttr = false;
  }
});
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // Links leave the app; in-page anchors (footnotes) stay.
  if (node.tagName === 'A' && !node.getAttribute('href')?.startsWith('#')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'IMG') {
    node.setAttribute('referrerpolicy', 'no-referrer');
    node.setAttribute('loading', 'lazy');
  }
});

/** A node's line: inline marks and links, no images (they don't fit a row). */
const inlineOptions: Config = { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'img'] };

/**
 * A note: GitHub's tags, plus the checkboxes and labels of task lists. No
 * styles (but a table column's alignment) or arbitrary classes, so a note
 * can't restyle the page.
 */
const blockOptions: Config = {
  ALLOWED_TAGS: [...HTML_TAGS, 'section', 'input', 'label'],
  ALLOWED_ATTR: ['href', 'src', 'srcset', 'alt', 'title', 'width', 'height', 'align', 'colspan', 'rowspan', 'start', 'type', 'checked', 'tabindex', 'open', 'target', 'rel', 'class', 'id', 'datetime', 'media', 'data-type', 'data-checked', 'data-line', 'data-tight', 'style'],
  ALLOW_DATA_ATTR: false,
};

/** Sanitized HTML for a node's single-line content. */
export function renderInline(content: string): string {
  return DOMPurify.sanitize(inlineToHtml(content), inlineOptions);
}

/** Sanitized HTML for a node's block note; `docId` (the node's id) keeps its footnote links its own. */
export function renderBlock(note: string, docId?: string): string {
  return DOMPurify.sanitize(blockToHtml(note, docId), blockOptions);
}
