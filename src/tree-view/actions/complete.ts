import type { Command } from '@/commands';
import type { TreeReader } from '@/model';
import type { Caret } from '@/store/ui-store';
import type { ActionContext } from './context';

/** Mark these nodes done, or not done when all of them already are (WorkFlowy's rule for a selection). */
export function completeCommands(tree: TreeReader, ids: readonly string[]): Command[] {
  const live = ids.filter((id) => tree.get(id)?.deletedAt === null);
  const completed = !live.every((id) => tree.get(id)!.completedAt != null);
  return live.map((id): Command => ({ type: 'toggleComplete', id, completed }));
}

/** Done items (Ctrl/⌘+Enter) and showing or hiding them (Ctrl/⌘+O), as in WorkFlowy. */
export function completeActions(ctx: ActionContext) {
  const { engine, ui, session, settings, rootId, tree } = ctx;

  /** The row the caret goes to when `id` and its children leave the page: the next row after them, else the one above. */
  const rowAfterHiding = (id: string): { id: string; caret: Caret } | null => {
    const rows = ctx.rowsNow();
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return null;
    let j = i + 1;
    while (rows[j] && rows[j]!.depth > rows[i]!.depth) j++;
    if (rows[j]) return { id: rows[j]!.id, caret: { kind: 'start' } };
    if (i > 0) return { id: rows[i - 1]!.id, caret: { kind: 'end' } };
    return rootId === null ? null : { id: rootId, caret: { kind: 'end' } };
  };

  /** Ctrl/⌘+Enter on the row being edited. While done items are hidden, the caret moves on as the row goes. */
  const completeFocused = (id: string) => {
    session.flush();
    const leaves = ctx.hideCompleted() && id !== rootId && tree.get(id)?.completedAt == null;
    const target = leaves ? rowAfterHiding(id) : null;
    engine.batch(completeCommands(tree, [id]), 'complete');
    if (!leaves) return;
    if (target) ui.focusNode(target.id, target.caret);
    else ui.blur();
  };

  const toggleShowCompleted = () => {
    session.flush();
    const show = !settings.getState().showCompleted;
    settings.getState().update({ showCompleted: show });
    if (show) return;
    // The row being edited or selected may have just gone from the page.
    const { focus, selection } = ui.getState();
    const rows = new Set(ctx.rowsNow().map((r) => r.id));
    if (focus && focus.id !== rootId && !rows.has(focus.id)) ui.blur();
    if (selection && [...selection.ids].some((id) => !rows.has(id))) ui.setSelection(null);
  };

  return { completeFocused, toggleShowCompleted };
}

export type CompleteActions = ReturnType<typeof completeActions>;
