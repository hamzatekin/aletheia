import { plainText } from '@/editor/markdown';
import type { TreeReader } from '@/model';

/** The top-level row whose rows are what AI remembers. It lives in the outline, so it syncs and can be read and edited. */
export const MEMORY_TITLE = 'AI memory';

/** The memory row: the first top-level row titled MEMORY_TITLE, or null before AI remembers anything. */
export function memoryRow(tree: TreeReader): string | null {
  return tree.children(null).find((id) => plainText(tree.get(id)?.content ?? '').trim() === MEMORY_TITLE) ?? null;
}
