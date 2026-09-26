/**
 * Open note editors save on a short delay. Anything that reads a note while
 * it is being edited (copying it, say) flushes that editor first.
 */
const flushers = new Map<string, () => void>();

/** Register the open editor of note `id`; returns the unregister function. */
export function registerNoteFlush(id: string, flush: () => void): () => void {
  flushers.set(id, flush);
  return () => {
    if (flushers.get(id) === flush) flushers.delete(id);
  };
}

/** Save note `id` now if an editor has it open. */
export function flushNote(id: string): void {
  flushers.get(id)?.();
}
