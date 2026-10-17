import type { BatchItem } from '@/commands';
import { plainText } from '@/editor/markdown';
import { isLive, isSelfOrDescendant, newId, previousSibling, type TreeReader } from '@/model';
import { MEMORY_TITLE, memoryRow } from './memory';
import type { Refs } from './prompt';

/** The changes AI asked for, ready to run as one batch, with what they did and how to take them back. */
export interface Plan {
  items: BatchItem[];
  /** After the batch ran: one line per change that took effect. */
  done(tree: TreeReader): string[];
  /** After the batch ran: commands that put things back, to run as one batch. */
  undo(): BatchItem[];
  /** How many changes were dropped as unreadable (unknown rows, a move into itself…). */
  dropped: number;
}

type At = 'first' | 'last';
const at = (v: unknown): At => (v === 'first' ? 'first' : 'last');
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v.replace(/\s*\n\s*/g, ' ').trim() : undefined);
const quote = (tree: TreeReader, id: string | null, fallback: string) => {
  if (id === null) return 'the top level';
  const t = plainText(tree.get(id)?.content ?? '').trim() || fallback;
  return `“${t.length > 40 ? `${t.slice(0, 39)}…` : t}”`;
};

/**
 * Turn AI's change list into commands. Rows are AI's numbers, "top", or a
 * name a create in the same list gave its new row ("as"). Anything naming a
 * row that doesn't exist is dropped rather than guessed at. A memory goes in
 * the memory row, made at the end of the top level the first time.
 */
export function planChanges(tree: TreeReader, refs: Refs, changes: readonly unknown[]): Plan {
  const items: BatchItem[] = [];
  /** Each change's inverse; a move's is only known once the batch ran. */
  const inverses: BatchItem[][] = [];
  const checks: ((t: TreeReader) => string | null)[] = [];
  const named = new Map<string, string>();
  const created = new Set<string>();
  let dropped = 0;
  let memory = memoryRow(tree);

  /** A row that exists now or will once the creates before it ran. */
  const row = (v: unknown): string | undefined => {
    if (typeof v === 'string' && named.has(v)) return named.get(v);
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
    const id = refs.id(n);
    return id && isLive(tree.get(id)) ? id : undefined;
  };
  const parent = (v: unknown): string | null | undefined => (v === 'top' || v === null ? null : row(v));

  for (const raw of changes) {
    const undo: BatchItem[] = [];
    inverses.push(undo);
    const c = (raw ?? {}) as Record<string, Record<string, unknown> | undefined>;
    if (c.create) {
      const p = parent(c.create.under);
      const text = str(c.create.text) ?? '';
      if (p === undefined || text === '') {
        dropped++;
        continue;
      }
      const id = newId();
      const name = str(c.create.as);
      if (name) named.set(name, id);
      created.add(id);
      const note = typeof c.create.note === 'string' ? c.create.note.trim() : '';
      items.push({ type: 'createNode', id, parentId: p, at: at(c.create.at), content: text, ...(note !== '' ? { note } : {}) });
      undo.push({ type: 'deleteSubtree', id });
      checks.push((t) => (isLive(t.get(id)) ? `Created ${quote(t, id, text)} in ${quote(t, p, 'a row')}.` : null));
    } else if (c.move) {
      const id = row(c.move.row);
      const p = parent(c.move.under);
      if (!id || p === undefined || (p !== null && !created.has(p) && isSelfOrDescendant(tree, id, p))) {
        dropped++;
        continue;
      }
      const where = at(c.move.at);
      items.push((t) => {
        const node = t.get(id);
        if (!node) return null;
        const after = previousSibling(t, id);
        const from = node.parentId;
        // Going back: after the same sibling when it's still there, else first under the old parent.
        undo.push((u) => ({ type: 'moveNode', id, parentId: from, at: after && isLive(u.get(after)) ? { after } : 'first' }));
        return { type: 'moveNode', id, parentId: p, at: where };
      });
      checks.push((t) => (t.get(id)?.parentId === p ? `Moved ${quote(t, id, 'a row')} to ${quote(t, p, 'a row')}.` : null));
    } else if (c.edit) {
      const id = row(c.edit.row);
      const text = str(c.edit.text);
      const note = typeof c.edit.note === 'string' ? c.edit.note.trim() : undefined;
      if (!id || ((text === undefined || text === '') && note === undefined)) {
        dropped++;
        continue;
      }
      const before = tree.get(id);
      if (text) {
        items.push({ type: 'updateContent', id, content: text });
        if (before) undo.push({ type: 'updateContent', id, content: before.content });
      }
      if (note !== undefined) {
        items.push({ type: 'updateNote', id, note });
        if (before) undo.push({ type: 'updateNote', id, note: before.note });
      }
      checks.push((t) => (isLive(t.get(id)) ? `Edited ${quote(t, id, 'a row')}.` : null));
    } else if (c.star) {
      const id = row(c.star.row);
      if (!id) {
        dropped++;
        continue;
      }
      const on = c.star.on !== false;
      const was = Boolean(tree.get(id)?.starredAt);
      items.push({ type: 'toggleStar', id, starred: on });
      undo.push({ type: 'toggleStar', id, starred: was });
      checks.push((t) => (Boolean(t.get(id)?.starredAt) === on && was !== on ? `${on ? 'Starred' : 'Unstarred'} ${quote(t, id, 'a row')}.` : null));
    } else if (typeof c.remember === 'string') {
      const text = str(c.remember) ?? '';
      if (text === '') {
        dropped++;
        continue;
      }
      if (memory === null) {
        memory = newId();
        items.push({ type: 'createNode', id: memory, parentId: null, at: 'last', content: MEMORY_TITLE });
        undo.push({ type: 'deleteSubtree', id: memory });
      }
      const id = newId();
      items.push({ type: 'createNode', id, parentId: memory, at: 'last', content: text });
      if (undo.length === 0) undo.push({ type: 'deleteSubtree', id });
      checks.push((t) => (isLive(t.get(id)) ? `Remembered ${quote(t, id, text)}.` : null));
    } else {
      dropped++;
    }
  }

  return {
    items,
    // Last change first: a row moved into a new row goes back before that row is deleted.
    undo: () => [...inverses].reverse().flat(),
    done: (t) => checks.map((check) => check(t)).filter((line): line is string => line !== null),
    dropped,
  };
}
