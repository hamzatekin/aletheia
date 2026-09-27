import { plainText } from '@/editor/markdown';
import { visibleRows, type Node, type TreeReader, type VisibleRow } from '@/model';

/**
 * Search that filters the page in place, as in WorkFlowy and Dynalist: the
 * rows that match, with the ancestors that lead to them. A match's own
 * children stay hidden (its bullet gets the collapsed halo) until opened.
 */
export interface Filter {
  query: string;
  /** Rows shown whatever they contain: ones edited or created during this search, so they do not vanish while typing. */
  keep: ReadonlySet<string>;
  /** Rows opened (true) or closed (false) by hand during this search; the rest open exactly when a match lies below. */
  open: ReadonlyMap<string, boolean>;
}

export interface FilteredRow extends VisibleRow {
  /**
   * Set on rows the filter decides: whether their children are shown. Rows
   * without it sit under a match opened by hand and follow their own collapsed state.
   */
  open?: boolean;
  /** The row itself matches the query (the rest lead to a match). */
  match?: boolean;
}

/** Lower-cased search words; quotes keep a phrase together. */
export function queryWords(query: string): string[] {
  const words: string[] = [];
  for (const m of query.toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)) {
    const w = (m[1] ?? m[2] ?? '').trim();
    if (w !== '') words.push(w);
  }
  return words;
}

const textCache = new Map<string, { content: string; note: string; text: string }>();

/** The node's searchable text: its content without Markdown, then its note. */
function searchText(node: Node): string {
  const hit = textCache.get(node.id);
  if (hit && hit.content === node.content && hit.note === node.note) return hit.text;
  const text = (plainText(node.content) + '\n' + node.note).toLowerCase();
  if (textCache.size > 20000) textCache.clear();
  textCache.set(node.id, { content: node.content, note: node.note, text });
  return text;
}

function nodeMatches(node: Node, words: readonly string[]): boolean {
  if (words.length === 0) return false;
  const text = searchText(node);
  return words.every((w) => text.includes(w));
}

export function isFiltering(filter: Filter | null): filter is Filter {
  return filter !== null && queryWords(filter.query).length > 0;
}

/** The rows of the page under `rootId` while filtering. */
export function filteredRows(tree: TreeReader, rootId: string | null, filter: Filter): FilteredRow[] {
  const words = queryWords(filter.query);
  const relevant = new Map<string, boolean>();
  const matches = new Set<string>();

  // Post-order over the whole subtree, ignoring collapsed state: a node is relevant if it matches, is kept, or has a relevant child.
  const visit = (id: string): boolean => {
    const node = tree.get(id);
    if (!node) return false;
    let any = false;
    for (const child of tree.children(id)) if (visit(child)) any = true;
    const self = nodeMatches(node, words);
    if (self) matches.add(id);
    const r = any || self || filter.keep.has(id);
    relevant.set(id, r);
    return r;
  };
  for (const id of tree.children(rootId)) visit(id);

  const out: FilteredRow[] = [];
  const emit = (parentId: string | null, depth: number) => {
    for (const id of tree.children(parentId)) {
      if (!relevant.get(id)) continue;
      const kids = tree.children(id);
      const leadsOn = kids.some((k) => relevant.get(k));
      const byHand = filter.open.get(id);
      const open = kids.length > 0 && (byHand ?? leadsOn);
      out.push({ id, depth, open, match: matches.has(id) });
      if (!open) continue;
      if (byHand === true && !leadsOn) {
        // Opened by hand with nothing matching below: its children as they are, unfiltered.
        for (const row of visibleRows(tree, id)) out.push({ id: row.id, depth: depth + 1 + row.depth });
      } else {
        emit(id, depth + 1);
      }
    }
  };
  emit(rootId, 0);
  return out;
}

/** How many nodes under `rootId` match. */
export function matchCount(rows: readonly FilteredRow[]): number {
  let n = 0;
  for (const r of rows) if (r.match) n++;
  return n;
}

/** The rows the page shows now: filtered while a search is on, else the usual visible rows. */
export function pageRows(tree: TreeReader, rootId: string | null, filter: Filter | null): FilteredRow[] {
  return isFiltering(filter) ? filteredRows(tree, rootId, filter) : visibleRows(tree, rootId);
}

/** Open or close a row the filter decides, remembering it only when it differs from the default. */
export function toggleFilterRow(tree: TreeReader, rootId: string | null, filter: Filter, id: string): Filter {
  const row = filteredRows(tree, rootId, filter).find((r) => r.id === id);
  if (!row || row.open === undefined) return filter;
  const open = new Map(filter.open);
  open.delete(id);
  const byDefault = filteredRows(tree, rootId, { ...filter, open }).find((r) => r.id === id)?.open ?? false;
  if (!row.open !== byDefault) open.set(id, !row.open);
  return { ...filter, open };
}
