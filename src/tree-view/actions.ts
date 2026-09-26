import { moveDownCommand, moveUpCommand, type BatchItem, type Command, type Engine, type Outcome } from '@/commands';
import type { EditorSession } from '@/editor/session';
import type { OutlineKey } from '@/editor/outliner-keymap';
import { slashCommands } from '@/editor/slash-registry';
import { importCommands, parseMarkdownOutline } from '@/io/import';
import { ancestorIds, newId, nextVisible, previousVisible, visibleRows, type TreeReader } from '@/model';
import type { SearchIndex } from '@/search';
import type { Caret, UiStore } from '@/store/ui-store';
import type { NavigateFunction } from 'react-router';

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
  /** Zoom to the node's parent and focus it (search results, links). */
  revealNode(id: string): void;
  /** Run the i-th command of the open slash menu. */
  runSlash(index: number): void;
  /** Keep the slash query in sync with the editor; called after each transaction. */
  syncSlash(): void;
  /** Multi-line paste: one node per line, nested by indentation. */
  pasteLines(text: string): boolean;
}

interface Deps {
  engine: Engine;
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
  rootId: string | null;
  navigate: NavigateFunction;
}

export function createOutlineActions({ engine, ui, session, search, rootId, navigate }: Deps): OutlineActions {
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

  const selectRange = (anchor: string, head: string) => {
    const rows = visibleRows(tree, rootId).map((r) => r.id);
    const a = rows.indexOf(anchor);
    const h = rows.indexOf(head);
    if (a < 0 || h < 0) return ui.setSelection(null);
    const ids = new Set(rows.slice(Math.min(a, h), Math.max(a, h) + 1));
    ui.setSelection({ anchor, head, ids });
  };

  const undoRedo = (which: 'undo' | 'redo') => {
    session.flush();
    const inSelectionMode = ui.getState().focus === null && ui.getState().selection !== null;
    const outcome = which === 'undo' ? engine.undo() : engine.redo();
    if (outcome?.ok && outcome.focus && tree.get(outcome.focus.id)?.deletedAt === null) {
      if (inSelectionMode) selectRange(outcome.focus.id, outcome.focus.id);
      else ui.focusNode(outcome.focus.id, { kind: 'offset', offset: outcome.focus.offset });
    }
  };

  const revealNode = (id: string) => {
    const node = tree.get(id);
    if (!node || node.deletedAt !== null) return;
    session.flush();
    // Expand collapsed ancestors so the node is visible under its parent.
    const collapsed = ancestorIds(tree, id).filter((a) => tree.get(a)?.collapsed);
    if (collapsed.length > 0) engine.batch(collapsed.map((a): Command => ({ type: 'toggleCollapse', id: a, collapsed: false })), 'expand');
    navigate(node.parentId ? `/n/${node.parentId}` : '/');
    ui.focusNode(id, { kind: 'end' });
  };

  const closeSlash = () => ui.setSlash(null);

  const syncSlash = () => {
    const slash = ui.getState().slash;
    if (!slash) return;
    const text = session.textFrom(slash.from);
    if (text === null || !text.startsWith('/') || text.includes('/', 1)) return closeSlash();
    const query = text.slice(1);
    if (query !== slash.query) ui.setSlash({ from: slash.from, query, index: 0 });
  };

  const runSlash = (index: number) => {
    const slash = ui.getState().slash;
    const focus = ui.getState().focus;
    if (!slash || !focus) return;
    const item = slashCommands(slash.query)[index];
    closeSlash();
    if (!item) return;
    session.deleteRange(slash.from, session.caretPos());
    void item.run({ engine, session, ui, search, navigate, rootId, nodeId: focus.id });
  };

  const pasteLines = (text: string): boolean => {
    const focus = ui.getState().focus;
    if (!focus || focus.field !== 'content') return false;
    const items = parseMarkdownOutline(text);
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

  const handleKey = (key: OutlineKey): boolean => {
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
        // An empty parent stays: merging it away would re-home its children.
        if (session.isEmpty()) return true;
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

  const handleGlobalKey = (e: KeyboardEvent): boolean => {
    const mod = e.metaKey || e.ctrlKey;
    if (ui.getState().searchOpen) return false;
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
    revealNode,
    runSlash,
    syncSlash,
    pasteLines,
  };
}
