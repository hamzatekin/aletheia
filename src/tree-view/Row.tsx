import { memo } from 'react';
import { useEngine } from '@/app/engine-context';
import { renderBlock, renderInline } from '@/editor/render';
import { Bullet } from './Bullet';
import { CollapseToggle } from './CollapseToggle';
import { useHasChildren, useNode } from './use-outline';

export const INDENT_PX = 24;

interface Props {
  id: string;
  depth: number;
}

/** One outline row: gutter (toggle + bullet), static content, optional note. */
export const Row = memo(function Row({ id, depth }: Props) {
  const engine = useEngine();
  const node = useNode(id);
  const hasChildren = useHasChildren(id);
  if (!node) return null;

  return (
    <div
      className="group flex items-start"
      style={{ paddingLeft: depth * INDENT_PX }}
      data-node-id={id}
      data-depth={depth}
    >
      <div className="-ml-10 flex w-10 shrink-0 items-start">
        {hasChildren ? (
          <CollapseToggle
            collapsed={node.collapsed}
            onToggle={() => engine.execute({ type: 'toggleCollapse', id })}
          />
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Bullet id={id} collapsedWithChildren={node.collapsed && hasChildren} />
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <div
          className="node-content leading-6 wrap-break-word"
          dangerouslySetInnerHTML={{ __html: renderInline(node.content) || '&nbsp;' }}
        />
        {node.note !== '' && (
          <div
            className="node-note prose-note text-sm leading-5 text-neutral-500 dark:text-neutral-400"
            dangerouslySetInnerHTML={{ __html: renderBlock(node.note) }}
          />
        )}
      </div>
    </div>
  );
});
