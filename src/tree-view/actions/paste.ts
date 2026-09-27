import type { Command } from '@/commands';
import { clipboardItems } from '@/io/clipboard';
import { importCommands, parseMarkdownOutline } from '@/io/import';
import type { ActionContext } from './context';

/** Pasting into the node being edited. */
export function pasteActions(ctx: ActionContext) {
  const { engine, ui, session, rootId, tree } = ctx;

  /** Multi-line paste: one node per line, nested by indentation. Copied nodes come back whole. */
  const pasteLines = (text: string, json?: string | null): boolean => {
    const focus = ui.getState().focus;
    if (!focus || focus.field !== 'content') return false;
    const copied = clipboardItems(text, json);
    if (!copied && !text.includes('\n')) return false;
    const items = copied ?? parseMarkdownOutline(text);
    if (items.length === 0) return false;
    const id = focus.id;
    const node = tree.get(id);
    if (!node) return false;
    session.flush();
    const commands: Command[] = [];
    let rest = items;
    if (session.isEmpty() && id !== rootId) {
      // An empty node takes the first item; the rest follow as siblings.
      const [first, ...others] = items;
      commands.push({ type: 'updateContent', id, content: first!.content });
      if (first!.note !== '') commands.push({ type: 'updateNote', id, note: first!.note });
      commands.push(...importCommands(id, first!.children));
      rest = others;
    }
    if (id === rootId) commands.push(...importCommands(id, rest, undefined));
    else commands.push(...importCommands(node.parentId, rest, id));
    const outcome = engine.batch(commands, 'paste');
    if (outcome.ok) {
      const lastTop = outcome.op.changes[outcome.op.changes.length - 1];
      ui.focusNode(lastTop && lastTop.id !== id ? lastTop.id : id, { kind: 'end' });
    }
    return true;
  };

  return { pasteLines };
}
