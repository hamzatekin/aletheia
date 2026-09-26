import { memo, useRef, type MouseEvent } from 'react';
import { renderBlock, renderInline } from '@/editor/render';
import { NodeEditor } from '@/editor/NodeEditor';
import { NoteEditor } from '@/editor/NoteEditor';
import { useUiStore } from '@/store/ui-store';
import { Bullet } from './Bullet';
import { CollapseToggle } from './CollapseToggle';
import { NodeMenu } from './NodeMenu';
import { useOutline } from './outline-context';
import { useHasChildren, useNode } from './use-outline';
import { useRowDnd } from './use-dnd';

export const INDENT_PX = 24;

interface Props {
  id: string;
  depth: number;
}

/** One outline row: gutter (toggle + bullet), content, optional note. */
export const Row = memo(function Row({ id, depth }: Props) {
  const { engine, ui } = useOutline();
  const node = useNode(id);
  const hasChildren = useHasChildren(id);
  const focusField = useUiStore(ui, (s) => (s.focus?.id === id ? s.focus.field : null));
  const selected = useUiStore(ui, (s) => s.selection?.ids.has(id) ?? false);
  const dragging = useUiStore(ui, (s) => s.dragging === id);
  const menuOpen = useUiStore(ui, (s) => s.menu === id);
  const indicator = useUiStore(ui, (s) => (s.dropIndicator?.targetId === id ? s.dropIndicator : null));
  const rowRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLAnchorElement>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  useRowDnd(id, depth, rowRef, handleRef, gripRef);
  if (!node) return null;

  const onContentMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('a')) return; // let links open
    if (e.button !== 0) return;
    e.preventDefault();
    ui.focusNode(id, { kind: 'point', x: e.clientX, y: e.clientY });
  };

  const onNoteMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('a')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    ui.focusNode(id, { kind: 'end' }, 'note');
  };

  return (
    <div
      ref={rowRef}
      className={
        'group relative flex items-start ' +
        (selected ? 'rounded bg-selection ' : focusField ? 'row-focused ' : '') +
        (dragging ? 'opacity-40' : '')
      }
      style={{ paddingLeft: depth * INDENT_PX }}
      data-node-id={id}
      data-depth={depth}
      data-focused={focusField ?? undefined}
      data-selected={selected || undefined}
    >
      {indicator && (
        <div
          className="pointer-events-none absolute right-0 z-10 h-0.5 rounded bg-accent"
          style={{ left: indicator.level * INDENT_PX - 20, [indicator.edge === 'above' ? 'top' : 'bottom']: -1 }}
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
          'grip absolute flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-faint transition-[opacity,background-color] ' +
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
          <NodeMenu id={id} hasChildren={hasChildren} collapsed={node.collapsed} />
        </div>
      )}
      <div className="-ml-11.5 flex w-11.5 shrink-0 items-start pr-1.5">
        {hasChildren ? (
          <CollapseToggle collapsed={node.collapsed} onToggle={() => engine.execute({ type: 'toggleCollapse', id })} />
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Bullet id={id} collapsedWithChildren={node.collapsed && hasChildren} handleRef={handleRef} />
      </div>
      <div className="row-text min-w-0 flex-1 py-px">
        {focusField === 'content' ? (
          <NodeEditor id={id} className="node-content wrap-break-word" />
        ) : (
          <div
            className="node-content cursor-text wrap-break-word"
            onMouseDown={onContentMouseDown}
            dangerouslySetInnerHTML={{ __html: renderInline(node.content) || '<br>' }}
          />
        )}
        {focusField === 'note' ? (
          <NoteEditor id={id} />
        ) : (
          node.note !== '' && (
            <div
              className="node-note prose-note row-note cursor-text pb-0.5 text-muted"
              onMouseDown={onNoteMouseDown}
              dangerouslySetInnerHTML={{ __html: renderBlock(node.note) }}
            />
          )
        )}
      </div>
    </div>
  );
});
