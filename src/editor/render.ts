import DOMPurify from 'dompurify';
import { blockToHtml, inlineToHtml } from './markdown';

import type { Config } from 'dompurify';

/** A node's line: inline marks and links, no images (they don't fit a row). */
const inlineOptions: Config = { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'img'] };

/** A note: everything Markdown makes, images included. Notes take no raw HTML, so this is a second line of defence. */
const blockOptions: Config = { ADD_ATTR: ['target', 'referrerpolicy', 'loading'], FORBID_TAGS: ['style'] };

/** Sanitized HTML for a node's single-line content. */
export function renderInline(content: string): string {
  return DOMPurify.sanitize(inlineToHtml(content), inlineOptions);
}

/** Sanitized HTML for a node's block note. */
export function renderBlock(note: string): string {
  return DOMPurify.sanitize(blockToHtml(note), blockOptions);
}
