import DOMPurify from 'dompurify';
import { blockToHtml, inlineToHtml } from './markdown';

import type { Config } from 'dompurify';

const purifyOptions: Config = { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'img'] };

/** Sanitized HTML for a node's single-line content. */
export function renderInline(content: string): string {
  return DOMPurify.sanitize(inlineToHtml(content), purifyOptions);
}

/** Sanitized HTML for a node's block note. */
export function renderBlock(note: string): string {
  return DOMPurify.sanitize(blockToHtml(note), purifyOptions);
}
