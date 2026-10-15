import type { Command, Engine } from '@/commands';
import type { UiStore } from '@/store/ui-store';
import { flushNote } from './note-flush';
import type { EditorSession } from './session';

/** A line that starts block Markdown (heading, list, quote, table, code, image, rule), which can't be an item's one-line text. */
const BLOCK_START = /^\s*(#{1,6}(\s|$)|[-*+]\s|\d+[.)]\s|>|\||`{3,}|~{3,}|!\[|<|(-{3,}|\*{3,}|_{3,})\s*$)/;
/** A setext heading's underline. */
const UNDERLINE = /^\s*(=+|-+)\s*$/;

/**
 * Split a note so its first line becomes the item's text and the rest stays
 * the note, as when you type a block and its first line names it (Bear, Apple
 * Notes, Logseq). Returns null when the note doesn't start with a plain line
 * of text. A hard line break's marker (two spaces or a backslash) is dropped.
 */
export function liftFirstLine(note: string): { content: string; note: string } | null {
  const lines = note.split('\n');
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  const [first = '', ...rest] = lines;
  if (first.trim() === '' || BLOCK_START.test(first) || UNDERLINE.test(rest[0] ?? '')) return null;
  while (rest.length > 0 && rest[0]!.trim() === '') rest.shift();
  return { content: first.trimEnd().replace(/\\$/, '').trim(), note: rest.join('\n') };
}

/** The commands that give a nameless item its note's first line as its name, if it has a liftable note. */
function nameCommands(engine: Engine, id: string): Command[] {
  const node = engine.tree.get(id);
  if (!node || node.deletedAt !== null || node.content.trim() !== '') return [];
  const lifted = liftFirstLine(node.note);
  if (!lifted) return [];
  return [
    { type: 'updateContent', id, content: lifted.content },
    { type: 'updateNote', id, note: lifted.note },
  ];
}

/**
 * An item with no text but a note takes the note's first line as its text,
 * as one undo step. Called when the caret leaves the item, so a quick add
 * (or any item) can be typed as one block. Returns true if it renamed it.
 */
export function nameFromNote(engine: Engine, id: string): boolean {
  const commands = nameCommands(engine, id);
  if (commands.length > 0) engine.batch(commands, 'nameFromNote');
  return commands.length > 0;
}

/**
 * At startup, name every nameless item that has a note, as one undo step:
 * one typed into and left by closing the app never saw the caret leave.
 * Returns how many were renamed.
 */
export function nameAllFromNotes(engine: Engine): number {
  const commands = [...engine.tree.all()].flatMap((node) => nameCommands(engine, node.id));
  if (commands.length > 0) engine.batch(commands, 'nameFromNote');
  return commands.length / 2;
}

/** Run nameFromNote on every item the caret leaves, saving what was typed in it first. */
export function watchNameFromNote(engine: Engine, ui: UiStore, session: EditorSession): () => void {
  return ui.subscribe((s, prev) => {
    const left = prev.focus;
    if (!left || s.focus?.id === left.id) return;
    if (left.field === 'note') flushNote(left.id);
    else if (session.nodeId === left.id) session.flush();
    nameFromNote(engine, left.id);
  });
}
