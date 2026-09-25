import { moveDownCommand, moveUpCommand, type BatchItem, type Command, type Engine, type Outcome } from '@/commands';
import type { EditorSession } from '@/editor/session';
import type { OutlineKey } from '@/editor/outliner-keymap';
import { newId, nextVisible, previousVisible, visibleRows, type TreeReader } from '@/model';
import type { Caret, UiStore } from '@/store/ui-store';

export interface OutlineActions {
  /** Structural keys coming from the editor keymap. */
  handleKey(key: OutlineKey): boolean;
  /** Keys pressed while nothing is being edited (tree-level selection). Returns true if handled. */
  handleGlobalKey(e: KeyboardEvent): boolean;
  focusPrev(id: string, caret: Caret): void;
  focusNext(id: string, caret: Caret): void;
  createFirst(): void;
  undo(): void;
  redo(): void;
  zoomOut(): void;
}

interface Deps {
  engine: Engine;
  ui: UiStore;
  session: EditorSession;
  rootId: string | null;
  navigate: (to: string) => void;
}

export function createOutlineActions({ engine, ui, session, rootId, navigate }: Deps): OutlineActions {
  const tree: TreeReader = engine.tree;

  const applyFocus = (outcome: Outcome | null, fallback?: Caret): boolean => {
    if (outcome?.ok && outcome.focus) {
      ui.focusNode(outcome.focus.id, fallback ?? { kind: 'offset', offset: outcome.focus.offset });
    }
    return true;
  };

  const prevOf = (id: string): string | null => previousVisible(tree, rootId, id) ?? rootId;
  const nextOf = (id: string): string | null =>
    id === rootId ? (visibleRows(tree, rootId)[0]?.id ?? null) : nextVisible(tree, rootId, id);

  const focusPrev = (id: string, caret: Caret) => {
    const prev = prevOf(id);
    if (prev !== null) ui.focusNode(prev, caret);
  };
  const focusNext = (id: string, caret: Caret) => {
    const next = nextOf(id);
    if (next !== null) ui.focusNode(next, caret);
  };

  const createFirst = () => {
    const id = newId();
    applyFocus(engine.execute({ type: 'createNode', id, parentId: rootId, at: 'first' }));
  };

  const zoomOut = () => {
    if (rootId === null) return;
    session.flush();
    const root = tree.get(rootId);
    navigate(root?.parentId ? `/n/${root.parentId}` : '/');
    ui.focusNode(rootId, { kind: 'end' });
  };

  const undoRedo = (which: 'undo' | 'redo') => {
    session.flush();
    const outcome = which === 'undo' ? engine.undo() : engine.redo();
    if (outcome?.ok && outcome.focus && tree.get(outcome.focus.id)?.deletedAt === null) {
      ui.setSelection(null);
      ui.focusNode(outcome.focus.id, { kind: 'offset', offset: outcome.focus.offset });
    }
  };

  const handleKey = (key: OutlineKey): boolean => {
    if (key === 'undo' || key === 'redo') {
      undoRedo(key);
      return true;
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
        return applyFocus(engine.execute({ type: 'splitNode', id, newId: newId(), left, right }));
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
        const hasChildren = tree.children(id).length > 0;
        if (session.isEmpty() && !hasChildren) {
          session.discard();
          const outcome = engine.execute({ type: 'deleteSubtree', id });
          if (outcome.ok && !outcome.focus) {
            const next = nextOf(id);
            if (next) ui.focusNode(next, { kind: 'start' });
            else ui.blur();
            return true;
          }
          return applyFocus(outcome);
        }
        const prev = prevOf(id);
        if (prev === null) return true;
        session.flush();
        return applyFocus(engine.execute({ type: 'mergeNodes', sourceId: id, targetId: prev }));
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
      case 'expand':
        if (isTitle) return true;
        engine.execute({ type: 'toggleCollapse', id, collapsed: key === 'collapse' });
        return true;
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
    }
  };

  /** Selected nodes whose parent is not selected, in visible order. */
  const topLevelSelected = (ids: ReadonlySet<string>): string[] =>
    visibleRows(tree, rootId)
      .map((r) => r.id)
      .filter((id) => ids.has(id) && !ids.has(tree.get(id)?.parentId ?? ''));

  const selectRange = (anchor: string, head: string) => {
    const rows = visibleRows(tree, rootId).map((r) => r.id);
    const a = rows.indexOf(anchor);
    const h = rows.indexOf(head);
    if (a < 0 || h < 0) return ui.setSelection(null);
    const ids = new Set(rows.slice(Math.min(a, h), Math.max(a, h) + 1));
    ui.setSelection({ anchor, head, ids });
  };

  const handleGlobalKey = (e: KeyboardEvent): boolean => {
    const mod = e.metaKey || e.ctrlKey;
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

    const { focus, selection } = ui.getState();
    if (focus) return false;

    if (!selection) {
      if (e.key === 'Enter' && visibleRows(tree, rootId).length === 0) {
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
    const rows = visibleRows(tree, rootId).map((r) => r.id);
    const headIndex = rows.indexOf(head);
    const run = (items: BatchItem[], type: string): Outcome => engine.batch(items, type);

    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        if (e.altKey && e.shiftKey) {
          const top = topLevelSelected(ids);
          const ordered = e.key === 'ArrowUp' ? top : [...top].reverse();
          const make = e.key === 'ArrowUp' ? moveUpCommand : moveDownCommand;
          run(ordered.map((id) => (t: TreeReader) => make({ tree: t, now: 0 }, id)), 'moveSelection');
          return true;
        }
        if (mod) {
          const collapsed = e.key === 'ArrowUp';
          run([...ids].map((id): Command => ({ type: 'toggleCollapse', id, collapsed })), 'collapseSelection');
          return true;
        }
        const target = rows[headIndex + (e.key === 'ArrowUp' ? -1 : 1)];
        if (target === undefined) return true;
        if (e.shiftKey) selectRange(anchor, target);
        else selectRange(target, target);
        document.querySelector(`[data-node-id="${target}"]`)?.scrollIntoView({ block: 'nearest' });
        return true;
      }
      case 'Tab': {
        e.preventDefault();
        const top = topLevelSelected(ids);
        if (e.shiftKey) {
          const items = [...top].reverse().filter((id) => tree.get(id)?.parentId !== rootId);
          run(items.map((id): Command => ({ type: 'outdent', id })), 'outdentSelection');
        } else {
          run(top.map((id): Command => ({ type: 'indent', id })), 'indentSelection');
        }
        return true;
      }
      case 'Backspace':
      case 'Delete': {
        e.preventDefault();
        const top = topLevelSelected(ids);
        const outcome = run(top.map((id): Command => ({ type: 'deleteSubtree', id })), 'deleteSelection');
        ui.setSelection(null);
        if (outcome.ok && outcome.focus) selectRange(outcome.focus.id, outcome.focus.id);
        return true;
      }
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

  return {
    handleKey,
    handleGlobalKey,
    focusPrev,
    focusNext,
    createFirst,
    undo: () => undoRedo('undo'),
    redo: () => undoRedo('redo'),
    zoomOut,
  };
}
