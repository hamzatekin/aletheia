import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { moveDownCommand, moveUpCommand, type Command } from '@/commands';
import { importItems, type OutlineItem } from '@/io';
import { formatTerminalContent, formatTerminalNote } from '@/io/terminal';
import type { TreeReader } from '@/model';
import { isNoteCollapsed, notePrefs, useNotePrefs } from '@/store/note-prefs';
import { useOutline } from './outline-context';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';
const ALT = isMac ? '⌥' : 'Alt+';

interface Item {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
  run(): void;
}

function subtreeItems(tree: TreeReader, parentId: string): OutlineItem[] {
  return tree.children(parentId).map((id) => {
    const n = tree.get(id)!;
    return { content: n.content, note: n.note, children: subtreeItems(tree, id) };
  });
}

/** updateContent/updateNote commands that clean up terminal output pasted into the node and its descendants. */
function terminalFixes(tree: TreeReader, id: string): Command[] {
  const n = tree.get(id)!;
  const content = formatTerminalContent(n.content);
  const note = formatTerminalNote(n.note);
  return [
    ...(content !== n.content ? [{ type: 'updateContent' as const, id, content }] : []),
    ...(note !== n.note ? [{ type: 'updateNote' as const, id, note }] : []),
    ...tree.children(id).flatMap((c) => terminalFixes(tree, c)),
  ];
}

/**
 * The actions for a node: a dropdown under the row's ≡ grip, or on touch
 * screens a sheet from the bottom of the screen, where a thumb reaches it.
 */
export function NodeMenu({ id, hasChildren, collapsed, sheet = false }: { id: string; hasChildren: boolean; collapsed: boolean; sheet?: boolean }) {
  const { engine, ui, session, rootId } = useOutline();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const close = () => ui.setMenu(null);
  const noteCollapsed = useNotePrefs((s) => isNoteCollapsed(s, id));

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.(`[data-menu-for="${id}"]`)) ui.setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        ui.setMenu(null);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [id, ui]);

  const { tree } = engine;
  const node = tree.get(id);
  if (!node) return null;
  const exec = (cmd: Command | null) => {
    session.flush();
    if (cmd) engine.execute(cmd);
  };
  const canOutdent = node.parentId !== rootId;
  const fixes = terminalFixes(tree, id);

  const items: Item[] = [
    { id: 'zoom', label: 'Zoom in', hint: `${MOD}.`, run: () => (session.flush(), navigate(`/n/${id}`)) },
    { id: 'note', label: node.note === '' ? 'Add note' : 'Edit note', hint: 'Shift+Enter', run: () => ui.focusNode(id, { kind: 'end' }, 'note') },
    ...(node.note !== ''
      ? [{ id: 'note-collapse', label: noteCollapsed ? 'Expand note' : 'Collapse note', run: () => notePrefs.getState().toggleCollapsed(id) }]
      : []),
    ...(hasChildren
      ? [{ id: 'collapse', label: collapsed ? 'Expand' : 'Collapse', hint: collapsed ? `${MOD}↓` : `${MOD}↑`, run: () => exec({ type: 'toggleCollapse', id }) }]
      : []),
    { id: 'indent', label: 'Indent', hint: 'Tab', run: () => exec({ type: 'indent', id }) },
    ...(canOutdent ? [{ id: 'outdent', label: 'Outdent', hint: 'Shift+Tab', run: () => exec({ type: 'outdent', id }) }] : []),
    { id: 'up', label: 'Move up', hint: `${ALT}Shift+↑`, run: () => exec(moveUpCommand({ tree, now: 0 }, id)) },
    { id: 'down', label: 'Move down', hint: `${ALT}Shift+↓`, run: () => exec(moveDownCommand({ tree, now: 0 }, id)) },
    {
      id: 'duplicate',
      label: 'Duplicate',
      run: () => {
        session.flush();
        const copy = tree.get(id)!;
        importItems(engine, copy.parentId, [{ content: copy.content, note: copy.note, children: subtreeItems(tree, id) }], id);
      },
    },
    ...(fixes.length > 0
      ? [{ id: 'terminal', label: 'Format terminal output', run: () => (session.flush(), engine.batch(terminalFixes(tree, id), 'format')) }]
      : []),
    {
      id: 'link',
      label: 'Copy link',
      run: () => void navigator.clipboard?.writeText(`${location.origin}/n/${id}`).catch(() => {}),
    },
    {
      id: 'delete',
      label: 'Delete',
      danger: true,
      run: () => {
        session.flush();
        if (ui.getState().focus?.id === id) ui.blur();
        // An empty node only groups its children, so deleting it keeps them.
        const empty = tree.get(id)!.content.trim() === '';
        engine.execute({ type: empty ? 'deleteNode' : 'deleteSubtree', id });
      },
    },
  ];

  const menu = (
    <div
      ref={ref}
      role="menu"
      aria-label="Node actions"
      data-testid="node-menu"
      className={
        sheet
          ? 'fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-xl border-t border-line bg-surface py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-base shadow-2xl'
          : 'absolute top-full left-0 z-20 mt-1 w-56 rounded-md border border-line bg-surface py-1 text-sm shadow-lg'
      }
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-testid={`node-menu-${item.id}`}
          className={
            'flex w-full items-center justify-between text-left hover:bg-hover active:bg-active ' +
            (sheet ? 'px-5 py-3 ' : 'px-3 py-1.5 ') +
            (item.danger ? 'text-danger' : 'text-ink')
          }
          onClick={() => {
            close();
            item.run();
          }}
        >
          <span>{item.label}</span>
          {item.hint && !sheet && <span className="ml-3 text-xs text-faint">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
  if (!sheet) return menu;
  return createPortal(
    <>
      <div className="fixed inset-0 z-50 bg-black/20" aria-hidden="true" />
      {menu}
    </>,
    document.body,
  );
}
