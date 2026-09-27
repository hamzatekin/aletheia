import type { MouseEvent } from 'react';
import { renderBlock, renderInline } from '@/editor/render';
import { NodeEditor } from '@/editor/NodeEditor';
import { NoteEditor } from '@/editor/NoteEditor';
import type { Node } from '@/model';
import { useUiStore } from '@/store/ui-store';
import { useOutline } from './outline-context';
import { StarIcon } from './Star';

/** A zoomed-in page's heading: the node's text as the title, its note beneath, and a star in the gutter. */
export function PageTitle({ rootId, root }: { rootId: string; root: Node }) {
  const { engine, ui } = useOutline();
  const titleFocus = useUiStore(ui, (s) => (s.focus?.id === rootId ? s.focus.field : null));
  const starred = root.starredAt != null;

  const onTitleMouseDown = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('a') || e.button !== 0) return;
    e.preventDefault();
    ui.focusNode(rootId, { kind: 'point', x: e.clientX, y: e.clientY });
  };

  return (
    <header className="group/title relative mb-4" data-node-id={rootId} data-title="true">
      {/* In the gutter left of the title, where rows have their bullets: star this page. */}
      <button
        type="button"
        onClick={() => engine.execute({ type: 'toggleStar', id: rootId })}
        onMouseDown={(e) => e.preventDefault()}
        className={
          'page-star absolute flex size-7 items-center justify-center rounded-full hover:bg-hover ' +
          (starred ? 'star-on' : 'text-faint opacity-0 group-hover/title:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100')
        }
        aria-label={starred ? 'Unstar this page' : 'Star this page'}
        aria-pressed={starred}
        title={starred ? 'Starred: listed in the sidebar. Click to unstar.' : 'Star: list this page in the sidebar'}
        data-testid="page-star"
      >
        <StarIcon filled={starred} size={17} />
      </button>
      {titleFocus === 'content' ? (
        <NodeEditor id={rootId} className="node-content page-title font-normal tracking-tight wrap-break-word" />
      ) : (
        <h1
          className="node-content page-title cursor-text font-normal tracking-tight wrap-break-word"
          onMouseDown={onTitleMouseDown}
          dangerouslySetInnerHTML={{ __html: renderInline(root.content) || '<br>' }}
        />
      )}
      {titleFocus === 'note' ? (
        <div className="mt-1">
          <NoteEditor id={rootId} />
        </div>
      ) : (
        root.note !== '' && (
          <div
            className="prose-note mt-1 cursor-text text-sm text-muted"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest('a')) return;
              e.preventDefault();
              ui.focusNode(rootId, { kind: 'end' }, 'note');
            }}
            dangerouslySetInnerHTML={{ __html: renderBlock(root.note) }}
          />
        )
      )}
    </header>
  );
}
