import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { moveDownCommand, moveUpCommand, type Command } from '@/commands';
import { importItems } from '@/io';
import { subtreeItems } from '@/io/clipboard';
import { formatTerminalContent, formatTerminalNote } from '@/io/terminal';
import { COLORS, HEADINGS, type TreeReader } from '@/model';
import { isNoteCollapsed, notePrefs, useNotePrefs } from '@/store/note-prefs';
import { isMac } from '@/ui/media';
import { useOutline } from './outline-context';

const MOD = isMac ? '⌘' : 'Ctrl+';
const ALT = isMac ? '⌥' : 'Alt+';

interface Item {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
  run(): void;
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
export function NodeMenu({ id, hasChildren, sheet = false }: { id: string; hasChildren: boolean; sheet?: boolean }) {
  const { engine, ui, session, rootId, actions, ai, navigate } = useOutline();
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
    // The sheet's backdrop takes taps outside it instead (below).
    if (!sheet) document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [id, ui, sheet]);

  const { tree } = engine;
  const node = tree.get(id);
  if (!node) return null;
  const exec = (cmd: Command | null) => {
    session.flush();
    if (cmd) engine.execute(cmd);
  };
  const canOutdent = node.parentId !== rootId;
  const fixes = terminalFixes(tree, id);

  const done = node.completedAt != null;
  const items: Item[] = [
    { id: 'zoom', label: 'Zoom in', hint: `${MOD}.`, run: () => (session.flush(), navigate(`/n/${id}`)) },
    {
      id: 'complete',
      label: done ? 'Mark not done' : 'Complete',
      hint: `${MOD}Enter`,
      // The row being edited may leave the page (done items hidden): the caret then moves on.
      run: () => (ui.getState().focus?.id === id ? actions.completeFocused(id) : exec({ type: 'toggleComplete', id })),
    },
    { id: 'note', label: node.note === '' ? 'Add note' : 'Edit note', hint: 'Shift+Enter', run: () => ui.focusNode(id, { kind: 'end' }, 'note') },
    ...(node.note !== ''
      ? [{ id: 'note-collapse', label: noteCollapsed ? 'Expand note' : 'Collapse note', run: () => notePrefs.getState().toggleCollapsed(id) }]
      : []),
    ...(hasChildren
      ? [
          { id: 'expand-all', label: 'Expand all inside', run: () => actions.setAllCollapsed(id, false, true) },
          { id: 'collapse-all', label: 'Collapse all inside', run: () => actions.setAllCollapsed(id, true, true) },
        ]
      : []),
    ...(ai.available() ? [{ id: 'ai-title', label: 'Suggest title (AI)', run: () => void ai.suggestTitle(id) }] : []),
    {
      id: 'star',
      label: node.starredAt != null ? 'Unstar' : 'Star',
      run: () => exec({ type: 'toggleStar', id }),
    },
    { id: 'select', label: 'Select', hint: 'Esc', run: () => actions.selectNode(id) },
    { id: 'indent', label: 'Indent', hint: 'Tab', run: () => exec({ type: 'indent', id }) },
    ...(canOutdent ? [{ id: 'outdent', label: 'Outdent', hint: 'Shift+Tab', run: () => exec({ type: 'outdent', id }) }] : []),
    { id: 'up', label: 'Move up', hint: `${ALT}Shift+↑`, run: () => exec(moveUpCommand({ tree, now: 0 }, id)) },
    { id: 'down', label: 'Move down', hint: `${ALT}Shift+↓`, run: () => exec(moveDownCommand({ tree, now: 0 }, id)) },
    {
      id: 'duplicate',
      label: 'Duplicate',
      run: () => {
        session.flush();
        importItems(engine, tree.get(id)!.parentId, subtreeItems(tree, [id]), id);
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

  const itemButton = (item: Item) => (
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
  );
  const chip = 'flex items-center justify-center rounded hover:bg-hover active:bg-active ' + (sheet ? 'h-10 min-w-9 ' : 'h-7 min-w-6 ');
  const heading = node.heading ?? null;
  const color = node.color ?? null;

  const menu = (
    <div
      ref={ref}
      role="menu"
      aria-label="Node actions"
      data-testid="node-menu"
      className={
        sheet
          ? 'fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-xl border-t border-line bg-surface py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-base shadow-2xl'
          : 'absolute top-full left-0 z-20 mt-1 w-64 rounded-md border border-line bg-surface py-1 text-sm shadow-lg'
      }
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.filter((item) => !item.danger).map(itemButton)}
      {/* Heading size and color label, as in Dynalist: pick one, pick it again to clear it. */}
      <div className={'flex items-center border-t border-line ' + (sheet ? 'px-4 py-2' : 'px-2 py-1') + ' justify-between'} role="group" aria-label="Heading and color">
        {HEADINGS.map((h) => (
          <button
            key={h}
            type="button"
            role="menuitemradio"
            aria-checked={heading === h}
            title={heading === h ? 'Back to a normal row' : `Heading ${h}`}
            data-testid={`node-menu-h${h}`}
            className={chip + 'px-1.5 text-xs font-semibold ' + (heading === h ? 'bg-active text-ink' : 'text-muted')}
            onClick={() => {
              close();
              exec({ type: 'setHeading', id, heading: heading === h ? null : h });
            }}
          >
            H{h}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="menuitemradio"
            aria-checked={color === c}
            aria-label={color === c ? `Remove ${c}` : c[0]!.toUpperCase() + c.slice(1)}
            title={color === c ? 'Remove color' : c[0]!.toUpperCase() + c.slice(1)}
            data-testid={`node-menu-color-${c}`}
            className={chip}
            onClick={() => {
              close();
              exec({ type: 'setColor', id, color: color === c ? null : c });
            }}
          >
            <span className={'color-dot ' + (color === c ? 'color-dot-on' : '')} data-color={c} />
          </button>
        ))}
      </div>
      <div className="border-t border-line">{items.filter((item) => item.danger).map(itemButton)}</div>
    </div>
  );
  if (!sheet) return menu;
  return createPortal(
    <>
      {/* Closing on the tap's click, not its touch, keeps the backdrop up until the tap ends, so it doesn't fall through to the row below. */}
      <div className="fixed inset-0 z-50 bg-black/20" aria-hidden="true" onClick={close} />
      {menu}
    </>,
    document.body,
  );
}
