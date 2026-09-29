import type { Editor } from '@tiptap/core';
import type { Engine } from '@/commands';

/** Where "/" was typed: a node's text or its (rendered) note. */
export type SlashField = 'content' | 'note';

/** Everything a slash command may act on. */
export interface SlashContext {
  engine: Engine;
  /** The editor the menu was opened from (the node's line or its note). */
  editor: Editor;
  field: SlashField;
  /** The node whose editor the menu was opened from. */
  nodeId: string;
}

/**
 * A "/" menu entry. The menu only inserts or formats inside the text being
 * edited (and runs AI on it), like WorkFlowy's; actions on the node itself
 * live in its menu, and app-wide ones (import, export) in Settings.
 */
export interface SlashCommand {
  id: string;
  title: string;
  /** Extra words the filter matches on. */
  keywords?: string;
  /** Section label shown in the menu. */
  group?: string;
  /** Where the command is offered; both by default. Block formats only fit notes. */
  fields?: SlashField[];
  /** Hide the command when this returns false (e.g. AI while sync is off). */
  available?(): boolean;
  run(ctx: SlashContext): unknown;
}

const registry: SlashCommand[] = [];

/** Plug in a command. Future commands (including AI) register the same way. */
export function registerSlashCommand(command: SlashCommand): () => void {
  registry.push(command);
  return () => {
    const i = registry.indexOf(command);
    if (i >= 0) registry.splice(i, 1);
  };
}

export function slashCommands(query: string, field: SlashField = 'content'): SlashCommand[] {
  const q = query.trim().toLowerCase();
  const shown = registry.filter((c) => (c.fields ?? ['content', 'note']).includes(field) && (c.available?.() ?? true));
  if (q === '') return shown;
  return shown.filter((c) => `${c.title} ${c.keywords ?? ''}`.toLowerCase().includes(q));
}

/**
 * Whether a "/" just typed at `from` should open the menu: not inside a word
 * that already has ":" or "/" (a URL or a path), and not inside code.
 */
export function opensSlashMenu(editor: Editor, from: number): boolean {
  const { doc } = editor.state;
  if (from < 1 || doc.textBetween(from, from + 1) !== '/') return false;
  const $from = doc.resolve(from);
  if ($from.parent.type.spec.code || editor.isActive('code')) return false;
  const word = /\S*$/.exec(doc.textBetween($from.start(), from))![0];
  return !/[:/]/.test(word);
}
