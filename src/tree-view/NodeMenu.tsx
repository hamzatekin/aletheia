import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { moveDownCommand, moveUpCommand, type Command } from '@/commands';
import { importItems, type OutlineItem } from '@/io';
import type { TreeReader } from '@/model';
import { notePrefs, useNotePrefs } from '@/store/note-prefs';
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

/** Dropdown under a row's ≡ grip with the actions for that node. */
export function NodeMenu({ id, hasChildren, collapsed }: { id: string; hasChildren: boolean; collapsed: boolean }) {
  const { engine, ui, session, rootId } = useOutline();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const close = () => ui.setMenu(null);
  const noteCollapsed = useNotePrefs((s) => s.collapsed.has(id));

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

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Node actions"
      data-testid="node-menu"
      className="absolute top-full left-0 z-20 mt-1 w-56 rounded-md border border-line bg-surface py-1 text-sm shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-testid={`node-menu-${item.id}`}
          className={
            'flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-hover ' +
            (item.danger ? 'text-danger' : 'text-ink')
          }
          onClick={() => {
            close();
            item.run();
          }}
        >
          <span>{item.label}</span>
          {item.hint && <span className="ml-3 text-xs text-faint">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
