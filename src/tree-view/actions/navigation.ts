import { flushSync } from 'react-dom';
import { hasOpenParent, setAllCollapsedCommands } from '@/commands';
import { ancestorIds, newId } from '@/model';
import type { Caret } from '@/store/ui-store';
import type { ActionContext } from './context';

/** Moving the caret between rows, zooming, collapsing, and undo/redo. */
export function navigationActions(ctx: ActionContext) {
  const { engine, ui, session, rootId, navigate, tree } = ctx;

  const focusPrev = (id: string, caret: Caret) => {
    const prev = ctx.prevOf(id);
    if (prev !== null) ui.focusNode(prev, caret);
  };
  const focusNext = (id: string, caret: Caret) => {
    const next = ctx.nextOf(id);
    if (next !== null) ui.focusNode(next, caret);
  };

  const createFirst = () => {
    const id = newId();
    ctx.applyFocus(engine.execute({ type: 'createNode', id, parentId: rootId, at: 'first' }));
  };

  const zoomOut = () => {
    if (rootId === null) return;
    session.flush();
    const root = tree.get(rootId);
    navigate(root?.parentId ? `/n/${root.parentId}` : '/');
    ui.focusNode(rootId, { kind: 'end' });
  };

  const setAllCollapsed = (underId: string | null, collapsed: boolean, includeSelf = false) => {
    session.flush();
    const commands = setAllCollapsedCommands(tree, underId, collapsed, includeSelf);
    if (commands.length === 0) return;
    engine.batch(commands, collapsed ? 'collapseAll' : 'expandAll');
    // A focused node that just got hidden hands the caret to the ancestor that hides it.
    const focus = ui.getState().focus;
    if (!collapsed || !focus || focus.id === rootId) return;
    const visible = new Set(ctx.rowsNow().map((r) => r.id));
    if (visible.has(focus.id)) return;
    const holder = ancestorIds(tree, focus.id).find((a) => visible.has(a));
    if (holder) ui.focusNode(holder, { kind: 'end' });
    else ui.blur();
  };

  const toggleAll = () => setAllCollapsed(rootId, hasOpenParent(tree, rootId));

  const undoRedo = (which: 'undo' | 'redo') => {
    session.flush();
    const inSelectionMode = ui.getState().focus === null && ui.getState().selection !== null;
    const outcome = which === 'undo' ? engine.undo() : engine.redo();
    if (outcome?.ok && outcome.focus && tree.get(outcome.focus.id)?.deletedAt === null) {
      if (inSelectionMode) ctx.selectRange(outcome.focus.id, outcome.focus.id);
      else ui.focusNode(outcome.focus.id, { kind: 'offset', offset: outcome.focus.offset });
    }
  };

  const revealNode = (id: string) => {
    const node = tree.get(id);
    if (!node || node.deletedAt !== null) return;
    session.flush();
    // Expand collapsed ancestors so the node is visible under its parent.
    ctx.expandCollapsed(ancestorIds(tree, id));
    navigate(node.parentId ? `/n/${node.parentId}` : '/');
    ui.focusNode(id, { kind: 'end' });
  };

  // Through /capture, the app icon's Add to Inbox route, which starts the
  // editor only once the new page is up, so no typed letter goes to this one.
  // Synchronously, so a tap's new editor is focused before the tap ends:
  // phones open the keyboard only for a field focused during the tap.
  const quickAdd = () => {
    session.flush();
    ui.setSelection(null);
    flushSync(() => void navigate('/capture'));
  };

  return { focusPrev, focusNext, createFirst, zoomOut, setAllCollapsed, toggleAll, undoRedo, revealNode, quickAdd };
}

export type NavigationActions = ReturnType<typeof navigationActions>;
