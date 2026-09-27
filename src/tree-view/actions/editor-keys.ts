import { moveDownCommand, moveUpCommand } from '@/commands';
import type { OutlineKey } from '@/editor/outliner-keymap';
import { slashCommands } from '@/editor/slash-registry';
import { newId } from '@/model';
import type { ActionContext } from './context';
import type { FilterActions } from './filter';
import type { NavigationActions } from './navigation';
import type { SlashActions } from './slash';

type Parts = NavigationActions & FilterActions & SlashActions;

/** Structural keys coming from the editor keymap (`OutlineKey`). Returns true if handled. */
export function editorKeyHandler(ctx: ActionContext, parts: Parts): (key: OutlineKey) => boolean {
  const { engine, ui, session, rootId, navigate, tree } = ctx;
  const { closeSlash, runSlash, undoRedo, createFirst, focusPrev, focusNext, zoomOut, toggleFilterRow } = parts;

  return (key) => {
    if (key === 'undo' || key === 'redo') {
      undoRedo(key);
      return true;
    }
    if (key === 'search') {
      session.flush();
      ui.setSearchOpen(true);
      return true;
    }
    const slash = ui.getState().slash;
    if (key === 'slash') {
      // Sent just after a "/" was typed, so it sits right before the caret.
      // Inside a word that already has ":" or "/" it is part of a URL or path.
      const from = session.caretPos() - 1;
      const { doc } = session.editor.state;
      if (from < 1 || doc.textBetween(from, from + 1) !== '/') return false;
      const word = /\S*$/.exec(doc.textBetween(1, from))![0];
      if (!slash && !/[:/]/.test(word)) ui.setSlash({ from, query: '', index: 0 });
      return false;
    }
    if (slash) {
      const count = slashCommands(slash.query).length;
      switch (key) {
        case 'up':
          ui.setSlash({ ...slash, index: (slash.index - 1 + Math.max(count, 1)) % Math.max(count, 1) });
          return true;
        case 'down':
          ui.setSlash({ ...slash, index: (slash.index + 1) % Math.max(count, 1) });
          return true;
        case 'enter':
          if (count === 0) {
            // Nothing to run: close the menu and let Enter split the node as usual.
            closeSlash();
            break;
          }
          runSlash(Math.min(slash.index, count - 1));
          return true;
        case 'escape':
          closeSlash();
          return true;
        default:
          break;
      }
    }
    const focus = ui.getState().focus;
    if (!focus || focus.field !== 'content') return false;
    const id = focus.id;
    const isTitle = id === rootId;
    const node = tree.get(id);
    if (!node) return false;

    switch (key) {
      case 'enter': {
        if (isTitle) {
          session.flush();
          createFirst();
          return true;
        }
        const { left, right } = session.split();
        session.discard();
        return ctx.applyFocus(engine.execute({ type: 'splitNode', id, newId: newId(), left, right }));
      }
      case 'note':
        session.flush();
        ui.focusNode(id, { kind: 'end' }, 'note');
        return true;
      case 'indent':
        if (isTitle) return true;
        session.flush();
        engine.execute({ type: 'indent', id });
        return true;
      case 'outdent':
        if (isTitle || node.parentId === rootId) return true;
        session.flush();
        engine.execute({ type: 'outdent', id });
        return true;
      case 'backspaceAtStart': {
        if (isTitle) return true;
        if (session.isEmpty()) {
          // An empty parent goes, but its children stay: they move up into its place.
          const type = tree.children(id).length > 0 ? 'deleteNode' : 'deleteSubtree';
          session.discard();
          const outcome = engine.execute({ type, id });
          if (outcome.ok && !outcome.focus) {
            const next = ctx.nextOf(id);
            if (next) ui.focusNode(next, { kind: 'start' });
            else ui.blur();
            return true;
          }
          return ctx.applyFocus(outcome);
        }
        const prev = ctx.prevOf(id);
        if (prev === null) return true;
        session.flush();
        return ctx.applyFocus(engine.execute({ type: 'mergeNodes', sourceId: id, targetId: prev }));
      }
      case 'up':
        if (isTitle) return true;
        focusPrev(id, { kind: 'line', line: 'last', x: session.caretX() });
        return true;
      case 'down':
        focusNext(id, { kind: 'line', line: 'first', x: session.caretX() });
        return true;
      case 'left':
        if (isTitle) return true;
        focusPrev(id, { kind: 'end' });
        return true;
      case 'right':
        focusNext(id, { kind: 'start' });
        return true;
      case 'collapse':
      case 'expand': {
        if (isTitle) return true;
        const row = ui.getState().filter ? ctx.rowsNow().find((r) => r.id === id) : undefined;
        if (row?.open !== undefined) {
          if (row.open === (key === 'collapse')) toggleFilterRow(id);
          return true;
        }
        engine.execute({ type: 'toggleCollapse', id, collapsed: key === 'collapse' });
        return true;
      }
      case 'moveUp':
      case 'moveDown': {
        if (isTitle) return true;
        session.flush();
        const cmd = key === 'moveUp' ? moveUpCommand({ tree, now: 0 }, id) : moveDownCommand({ tree, now: 0 }, id);
        if (cmd) engine.execute(cmd);
        return true;
      }
      case 'zoomIn':
        if (isTitle) return true;
        session.flush();
        navigate(`/n/${id}`);
        ui.focusNode(id, { kind: 'end' });
        return true;
      case 'zoomOut':
        zoomOut();
        return true;
      case 'escape':
        session.flush();
        ui.blur();
        if (!isTitle) ui.setSelection({ anchor: id, head: id, ids: new Set([id]) });
        return true;
      case 'selectUp':
      case 'selectDown': {
        if (isTitle) return true;
        const target = key === 'selectUp' ? ctx.previousVisible(id) : ctx.nextVisible(id);
        session.flush();
        ui.blur();
        ctx.selectRange(id, target ?? id);
        return true;
      }
      case 'selectAll': {
        const rows = ctx.rowsNow();
        if (rows.length === 0) return false;
        session.flush();
        ui.blur();
        ctx.selectRange(rows[0]!.id, rows[rows.length - 1]!.id);
        return true;
      }
    }
  };
}
