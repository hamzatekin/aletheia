import { memo, type MouseEvent } from 'react';
import { renderBlock, renderInline } from '@/editor/render';
import { NodeEditor } from '@/editor/NodeEditor';
import { NoteEditor } from '@/editor/NoteEditor';
import { useUiStore } from '@/store/ui-store';
import { Bullet } from './Bullet';
import { CollapseToggle } from './CollapseToggle';
import { useOutline } from './outline-context';
import { useHasChildren, useNode } from './use-outline';

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
      className={'group flex items-start rounded ' + (selected ? 'bg-blue-100/70 dark:bg-blue-900/30' : '')}
      style={{ paddingLeft: depth * INDENT_PX }}
      data-node-id={id}
      data-depth={depth}
      data-focused={focusField ?? undefined}
    >
      <div className="-ml-10 flex w-10 shrink-0 items-start">
        {hasChildren ? (
          <CollapseToggle collapsed={node.collapsed} onToggle={() => engine.execute({ type: 'toggleCollapse', id })} />
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Bullet id={id} collapsedWithChildren={node.collapsed && hasChildren} />
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        {focusField === 'content' ? (
          <NodeEditor id={id} className="node-content leading-6 wrap-break-word" />
        ) : (
          <div
            className="node-content cursor-text leading-6 wrap-break-word"
            onMouseDown={onContentMouseDown}
            dangerouslySetInnerHTML={{ __html: renderInline(node.content) || '<br>' }}
          />
        )}
        {focusField === 'note' ? (
          <NoteEditor id={id} />
        ) : (
          node.note !== '' && (
            <div
              className="node-note prose-note cursor-text text-sm leading-5 text-neutral-500 dark:text-neutral-400"
              onMouseDown={onNoteMouseDown}
              dangerouslySetInnerHTML={{ __html: renderBlock(node.note) }}
            />
          )
        )}
      </div>
    </div>
  );
});
