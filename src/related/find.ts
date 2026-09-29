import { plainText } from '@/editor/markdown';
import { ancestorIds, descendantIds, type TreeReader } from '@/model';
import type { SearchIndex } from '@/search';

/** One row found for the item: `why` and `duplicate` come from AI, text matches have neither. */
export interface RelatedItem {
  id: string;
  why?: string;
  duplicate?: boolean;
}

/** Words too common to say two rows are about the same thing. */
const STOPWORDS = new Set(
  (
    'the and for with that this from have has had are was were will would can could should not but you your our their they them ' +
    'what when where which who how why all any some more most other into onto about over under than then there here its also just ' +
    'like make made need needs want does did done get got use used using one two new old very much many each only own same such ' +
    've ile bir bu şu için gibi daha çok ama veya hem ya da de ne mi mu mı mü olan olarak sonra önce kadar'
  ).split(' '),
);

/** Enough of the item to describe it; its deeper outline is cut here. */
const MAX_CHILD_LINES = 40;
const MAX_NOTE_CHARS = 2_000;
/** How many text matches the panel lists, at most. */
const MAX_TEXT_MATCHES = 12;
/** A match scoring under this share of the best one is noise. */
const MIN_SHARE = 0.3;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/** The search terms describing an item: its title words (weighed more), then its note and children. */
export function itemTerms(tree: TreeReader, id: string): { terms: string[]; title: Set<string> } {
  const node = tree.get(id);
  if (!node) return { terms: [], title: new Set() };
  const title = new Set(words(plainText(node.content)));
  const rest: string[] = [...words(node.note.slice(0, MAX_NOTE_CHARS))];
  for (const c of descendantIds(tree, id).slice(0, MAX_CHILD_LINES)) rest.push(...words(plainText(tree.get(c)?.content ?? '')));
  // The most repeated words say most about the item.
  const counts = new Map<string, number>();
  for (const w of rest) counts.set(w, (counts.get(w) ?? 0) + 1);
  const body = [...counts].sort((a, b) => b[1] - a[1]).map(([w]) => w).filter((w) => !title.has(w)).slice(0, 25);
  return { terms: [...title, ...body], title };
}

/** Rows that are the item, inside it, or above it: already on screen, never "related". */
export function excludedIds(tree: TreeReader, id: string): Set<string> {
  return new Set([id, ...descendantIds(tree, id), ...ancestorIds(tree, id)]);
}

/**
 * Rows elsewhere sharing the item's words, best first. A row and the row
 * above it are not both listed: the better match of the two leads to the other.
 */
export function textMatches(tree: TreeReader, search: SearchIndex, id: string): RelatedItem[] {
  const { terms, title } = itemTerms(tree, id);
  const skip = excludedIds(tree, id);
  // The item and its own rows match best of all; leave them out before judging scores.
  const hits = search.searchAny(terms, (t) => (title.has(t) ? 3 : 1), 80).filter((h) => !skip.has(h.id));
  const best = hits[0]?.score ?? 0;
  const out: RelatedItem[] = [];
  for (const h of hits) {
    if (out.length >= MAX_TEXT_MATCHES || h.score < best * MIN_SHARE) break;
    const node = tree.get(h.id);
    if (!node || node.deletedAt !== null) continue;
    if (plainText(node.content).trim() === '' && node.note.trim() === '') continue;
    const above = new Set(ancestorIds(tree, h.id));
    if (out.some((o) => above.has(o.id) || ancestorIds(tree, o.id).includes(h.id))) continue;
    out.push({ id: h.id });
  }
  return out;
}

/** "Home › A › B" for a row: where it lives. */
export function pathText(tree: TreeReader, id: string): string {
  return ancestorIds(tree, id)
    .reverse()
    .map((a) => plainText(tree.get(a)?.content ?? '').trim() || 'Untitled')
    .join(' › ');
}
