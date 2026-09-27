import { memo, useRef, type MouseEvent, type TouchEvent } from 'react';
import { renderBlock, renderInline } from '@/editor/render';
import { NodeEditor } from '@/editor/NodeEditor';
import { NoteEditor, NoteHeader, useNoteMode } from '@/editor/NoteEditor';
import { useUiStore } from '@/store/ui-store';
import { isNoteCollapsed, notePrefs, useNotePrefs } from '@/store/note-prefs';
import { plainText } from '@/editor/markdown';
import { Bullet } from './Bullet';
import { CollapseToggle } from './CollapseToggle';
import { NodeMenu } from './NodeMenu';
import { useCoarsePointer } from './MobileToolbar';
import { useOutline } from './outline-context';
import { useHasChildren, useNode } from './use-outline';
import { useRowDnd } from './use-dnd';

export const INDENT_PX = 24;
/** Phones indent less, like WorkFlowy's app, so deep outlines keep room for text. */
export const TOUCH_INDENT_PX = 18;

/** One line standing in for a collapsed note: its first line of text, marked as cut. */
function noteSummary(note: string): string {
  const lines = note.split('\n').filter((l) => l.trim() !== '' && !/^\s*(`{3,}|~{3,})/.test(l));
  const first = plainText((lines[0] ?? '').replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')).trim();
  return lines.length > 1 || first === '' ? `${first} …`.trim() : first;
}

interface Props {
  id: string;
  depth: number;
}

/** One outline row: gutter (toggle + bullet), content, optional note. */
export const Row = memo(function Row({ id, depth }: Props) {
  const { engine, ui, actions, session } = useOutline();
  const node = useNode(id);
  const hasChildren = useHasChildren(id);
  const focusField = useUiStore(ui, (s) => (s.focus?.id === id ? s.focus.field : null));
  const selected = useUiStore(ui, (s) => s.selection?.ids.has(id) ?? false);
  const dragging = useUiStore(ui, (s) => s.dragging === id);
  const menuOpen = useUiStore(ui, (s) => s.menu === id);
  const noteCollapsed = useNotePrefs((s) => isNoteCollapsed(s, id));
  const noteMode = useNoteMode();
  const indicator = useUiStore(ui, (s) => (s.dropIndicator?.targetId === id ? s.dropIndicator : null));
  const coarse = useCoarsePointer();
  const indent = coarse ? TOUCH_INDENT_PX : INDENT_PX;
  const rowRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLAnchorElement>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  useRowDnd(id, depth, rowRef, handleRef, gripRef);
  if (!node) return null;

  const longPress = useRef<{ timer: number; x: number; y: number; fired: number } | null>(null);

  /** Shift+click, Ctrl/Cmd+click, and taps while selecting on a phone pick nodes instead of editing. Returns true if handled. */
  const selectClick = (e: MouseEvent<HTMLDivElement>): boolean => {
    if (Date.now() - (longPress.current?.fired ?? 0) < 800) {
      e.preventDefault();
      return true; // the tap that ended a long press
    }
    const { focus, selection } = ui.getState();
    if (e.shiftKey && (focus || selection)) {
      e.preventDefault();
      actions.selectTo(id);
      return true;
    }
    const onLink = (e.target as HTMLElement).closest('a') !== null;
    if (((e.metaKey || e.ctrlKey) && !onLink) || (coarse && selection && !focus)) {
      if (!focus && !selection) return false;
      e.preventDefault();
      actions.toggleSelected(id);
      return true;
    }
    return false;
  };

  /**
   * Pressing on a row's text. With a mouse the browser selects text right
   * away, as on any page (and as in WorkFlowy and Dynalist); editing starts on
   * release if nothing got selected. A drag into another row selects whole
   * nodes instead (OutlinePage). Touch screens start editing at once.
   */
  const pressText = (e: MouseEvent<HTMLDivElement>, field: 'content' | 'note') => {
    if (e.button !== 0) return;
    if (selectClick(e)) return;
    if ((e.target as HTMLElement).closest('a')) return; // let links open
    const point = { kind: 'point', x: e.clientX, y: e.clientY } as const;
    if (coarse || e.detail >= 2) {
      // The second press of a quick double-click lands before the editor is up: select the word in it.
      e.preventDefault();
      ui.focusNode(id, e.detail >= 2 ? { ...point, word: true } : point, field);
      return;
    }
    if (ui.getState().focus) {
      session.flush();
      ui.blur();
    }
    ui.setSelection(null);
    window.addEventListener(
      'mouseup',
      (up: globalThis.MouseEvent) => {
        if (ui.getState().selection || ui.getState().focus) return; // dragged across rows, or already editing
        const sel = document.getSelection();
        const dragged = Math.hypot(up.clientX - point.x, up.clientY - point.y) > 3;
        if (dragged && sel && !sel.isCollapsed && rowRef.current?.contains(sel.anchorNode)) return; // text was selected: keep it
        ui.focusNode(id, point, field);
      },
      { once: true },
    );
  };
  const onContentMouseDown = (e: MouseEvent<HTMLDivElement>) => pressText(e, 'content');

  // A long press selects the node, as in WorkFlowy's and Dynalist's apps.
  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1 || ui.getState().focus?.id === id) return;
    const t = e.touches[0]!;
    const fired = longPress.current?.fired ?? 0;
    const timer = window.setTimeout(() => {
      if (!longPress.current) return;
      longPress.current.fired = Date.now();
      navigator.vibrate?.(10);
      const { selection } = ui.getState();
      if (selection && !selection.ids.has(id)) actions.toggleSelected(id);
      else if (!selection) actions.selectNode(id);
    }, 450);
    longPress.current = { timer, x: t.clientX, y: t.clientY, fired };
  };
  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const lp = longPress.current;
    const t = e.touches[0];
    if (lp && t && Math.hypot(t.clientX - lp.x, t.clientY - lp.y) > 10) clearTimeout(lp.timer);
  };
  const onTouchEnd = () => {
    if (longPress.current) clearTimeout(longPress.current.timer);
  };

  const onNoteMouseDown = (e: MouseEvent<HTMLDivElement>) => pressText(e, 'note');

  return (
    <div
      ref={rowRef}
      className={
        'group relative flex items-start ' +
        (selected ? 'rounded bg-selection ' : focusField ? 'row-focused ' : '') +
        (dragging ? 'opacity-40' : '')
      }
      style={{ paddingLeft: depth * indent }}
      data-node-id={id}
      data-depth={depth}
      data-focused={focusField ?? undefined}
      data-selected={selected || undefined}
    >
      {/* Indent guides, like WorkFlowy's: one line per ancestor level, down from its bullet through its children. */}
      {Array.from({ length: depth }, (_, level) => (
        <div
          key={level}
          aria-hidden="true"
          className="indent-guide pointer-events-none absolute inset-y-0 w-px"
          style={{ left: level * indent - (coarse ? 14 : 16) }}
        />
      ))}
      {indicator && (
        <div
          className="pointer-events-none absolute right-0 z-10 h-0.5 rounded bg-accent"
          style={{ left: indicator.level * indent - 20, [indicator.edge === 'above' ? 'top' : 'bottom']: -1 }}
          data-testid="drop-indicator"
          data-level={indicator.level}
          data-edge={indicator.edge}
        >
          <div className="absolute -top-[3px] -left-[3px] h-2 w-2 rounded-full border-2 border-accent bg-surface" />
        </div>
      )}
      <button
        ref={gripRef}
        type="button"
        aria-label="Node menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        tabIndex={-1}
        className={
          'grip absolute flex h-6 w-6 pointer-coarse:hidden cursor-pointer items-center justify-center rounded-full text-faint transition-[opacity,background-color] ' +
          (focusField || menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
        }
        style={{ left: depth * INDENT_PX - 68, top: 'calc((var(--row-lh) - 1.5rem) / 2 + 1px)' }}
        data-testid="drag-grip"
        data-menu-for={id}
        onClick={() => ui.setMenu(menuOpen ? null : id)}
      >
        <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor">
          <rect y="0" width="14" height="1.25" rx="0.6" />
          <rect y="4.4" width="14" height="1.25" rx="0.6" />
          <rect y="8.75" width="14" height="1.25" rx="0.6" />
        </svg>
      </button>
      {menuOpen && (
        <div className="absolute" style={{ left: depth * INDENT_PX - 68, top: 'var(--row-lh)' }}>
          <NodeMenu id={id} hasChildren={hasChildren} collapsed={node.collapsed} sheet={coarse} />
        </div>
      )}
      {/* On phones the arrow sits at the right end, so the gutter holds just the bullet. */}
      <div className={coarse ? '-ml-6 flex w-6 shrink-0 items-start pr-1' : '-ml-11.5 flex w-11.5 shrink-0 items-start pr-1.5'}>
        {coarse ? null : hasChildren ? (
          <CollapseToggle collapsed={node.collapsed} onToggle={() => engine.execute({ type: 'toggleCollapse', id })} />
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Bullet id={id} collapsedWithChildren={node.collapsed && hasChildren} handleRef={handleRef} />
      </div>
      <div
        className="row-text min-w-0 flex-1 py-px"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onContextMenu={(e) => {
          // The long press is ours; the browser's text selection menu would cover the rows.
          if (coarse && focusField === null) e.preventDefault();
        }}
      >
        {focusField === 'content' ? (
          <NodeEditor id={id} className="node-content wrap-break-word" />
        ) : (
          <div
            className="node-content cursor-text wrap-break-word"
            onMouseDown={onContentMouseDown}
            dangerouslySetInnerHTML={{ __html: renderInline(node.content) || '<br>' }}
          />
        )}
        {(focusField === 'note' || node.note !== '') && (
          <div className="note-card relative flow-root">
            {/* The same caret while reading and editing, so nothing appears or moves on click. */}
            {node.note !== '' && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={noteCollapsed ? 'Expand note' : 'Collapse note'}
                aria-expanded={!noteCollapsed}
                data-testid="note-toggle"
                className={
                  'note-toggle absolute -left-6 z-[1] flex h-5 w-5 items-center justify-center rounded-full text-faint hover:bg-hover hover:text-muted ' +
                  (noteCollapsed && focusField !== 'note' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
                }
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  // Collapsing the note being edited also leaves it.
                  if (focusField === 'note' && !noteCollapsed) ui.focusNode(id, { kind: 'end' });
                  notePrefs.getState().toggleCollapsed(id);
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={noteCollapsed && focusField !== 'note' ? '-rotate-90' : ''}>
                  <path d="M1.5 3.2 5 6.8l3.5-3.6z" />
                </svg>
              </button>
            )}
            {focusField === 'note' ? (
              <NoteEditor id={id} />
            ) : noteCollapsed ? (
              <div
                className="node-note row-note cursor-text truncate pb-0.5 text-muted"
                data-collapsed="true"
                onMouseDown={onNoteMouseDown}
              >
                {noteSummary(node.note)}
              </div>
            ) : (
              <>
                <NoteHeader id={id} raw={noteMode.raw} quiet />
                <div
                  className="node-note prose-note row-note cursor-text pb-0.5 text-muted"
                  onMouseDown={onNoteMouseDown}
                  dangerouslySetInnerHTML={{ __html: renderBlock(node.note) }}
                />
              </>
            )}
          </div>
        )}
      </div>
      {hasChildren && coarse && (
        <CollapseToggle side="right" collapsed={node.collapsed} onToggle={() => engine.execute({ type: 'toggleCollapse', id })} />
      )}
    </div>
  );
});
