import type { Command } from '@/commands';
import type { ActionContext } from './context';
import type { FilterActions } from './filter';
import type { NavigationActions } from './navigation';
import type { SelectionActions } from './selection';

type Parts = NavigationActions & FilterActions & SelectionActions;

/** Keys pressed while nothing is being edited (page shortcuts, tree-level selection). Returns true if handled. */
export function pageKeyHandler(ctx: ActionContext, parts: Parts): (e: KeyboardEvent) => boolean {
  const { engine, ui, session, navigate } = ctx;
  const { openFilter, closeFilter, undoRedo, toggleAll, createFirst, zoomOut, selectionAction } = parts;

  return (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (ui.getState().searchOpen) return false;
    // Ctrl/⌘+F searches this page in place, as Dynalist does; Ctrl/⌘+K jumps anywhere.
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFilter();
      return true;
    }
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      session.flush();
      ui.setSearchOpen(true);
      return true;
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undoRedo(e.shiftKey ? 'redo' : 'undo');
      return true;
    }
    if (mod && e.key === 'y') {
      e.preventDefault();
      undoRedo('redo');
      return true;
    }
    // Ctrl/⌘+Shift+. like Dynalist; e.code, since Shift turns "." into ">" on many layouts.
    if (mod && e.shiftKey && e.code === 'Period') {
      e.preventDefault();
      toggleAll();
      return true;
    }

    const { focus, selection } = ui.getState();
    if (focus) return false;

    if (!selection) {
      if (e.key === 'Escape' && ui.getState().filter) {
        e.preventDefault();
        closeFilter();
        return true;
      }
      if (e.key === 'Enter' && ctx.rowsNow().length === 0 && !ui.getState().filter) {
        e.preventDefault();
        createFirst();
        return true;
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        zoomOut();
        return true;
      }
      return false;
    }

    const { anchor, head, ids } = selection;
    const rows = ctx.rowsNow().map((r) => r.id);
    const headIndex = rows.indexOf(head);

    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (rows.length > 0) ctx.selectRange(rows[0]!, rows[rows.length - 1]!);
      return true;
    }

    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        if (e.altKey && e.shiftKey) {
          selectionAction(e.key === 'ArrowUp' ? 'moveUp' : 'moveDown');
          return true;
        }
        if (mod) {
          const collapsed = e.key === 'ArrowUp';
          engine.batch([...ids].map((id): Command => ({ type: 'toggleCollapse', id, collapsed })), 'collapseSelection');
          return true;
        }
        const target = rows[headIndex + (e.key === 'ArrowUp' ? -1 : 1)];
        if (target === undefined) return true;
        if (e.shiftKey) ctx.selectRange(anchor, target);
        else ctx.selectRange(target, target);
        document.querySelector(`[data-node-id="${target}"]`)?.scrollIntoView({ block: 'nearest' });
        return true;
      }
      case 'Tab':
        e.preventDefault();
        selectionAction(e.shiftKey ? 'outdent' : 'indent');
        return true;
      case 'Backspace':
      case 'Delete':
        e.preventDefault();
        selectionAction('delete');
        return true;
      case 'Enter':
        e.preventDefault();
        ui.focusNode(head, { kind: 'end' });
        return true;
      case 'Escape':
        e.preventDefault();
        ui.setSelection(null);
        return true;
      case '.':
        if (!mod) return false;
        e.preventDefault();
        navigate(`/n/${head}`);
        ui.setSelection(null);
        return true;
      case ',':
        if (!mod) return false;
        e.preventDefault();
        zoomOut();
        return true;
      default:
        return false;
    }
  };
}
