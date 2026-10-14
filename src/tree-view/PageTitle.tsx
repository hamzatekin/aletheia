import type { MouseEvent } from 'react';
import { renderBlock, renderInline } from '@/editor/render';
import { noteAfterTick, taskCheckboxAt } from '@/editor/task-list';
import { NodeEditor } from '@/editor/NodeEditor';
import { NoteEditor, NoteHeader, useNoteMode } from '@/editor/NoteEditor';
import type { Node } from '@/model';
import { useUiStore } from '@/store/ui-store';
import { useOutline } from './outline-context';
import { StarIcon } from './Star';

/** A zoomed-in page's heading: the node's text as the title, its note beneath, and a star in the gutter. */
export function PageTitle({ rootId, root }: { rootId: string; root: Node }) {
  const { engine, ui } = useOutline();
  const titleFocus = useUiStore(ui, (s) => (s.focus?.id === rootId ? s.focus.field : null));
  const starred = root.starredAt != null;
  const noteMode = useNoteMode();

  const onTitleMouseDown = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('a') || e.button !== 0) return;
    e.preventDefault();
    ui.focusNode(rootId, { kind: 'point', x: e.clientX, y: e.clientY });
  };

  return (
    <header className="group group/title relative mb-4" data-node-id={rootId} data-title="true">
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
          // Laid out exactly like the editor that replaces it (NoteEditor): the same
          // icons at the upper right and the same text size, so clicking in moves nothing.
          <div className="note-box relative mt-1 flow-root">
            <NoteHeader id={rootId} raw={noteMode.raw} quiet />
            <div
              className="prose-note row-note cursor-text pb-0.5 text-muted"
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest('a')) return;
                e.preventDefault();
                if (!taskCheckboxAt(e.target)) ui.focusNode(rootId, { kind: 'end' }, 'note');
              }}
              onClick={(e) => {
                const box = taskCheckboxAt(e.target);
                if (!box) return;
                e.preventDefault();
                engine.execute({ type: 'updateNote', id: rootId, note: noteAfterTick(root.note, box) });
              }}
              dangerouslySetInnerHTML={{ __html: renderBlock(root.note, rootId) }}
            />
          </div>
        )
      )}
    </header>
  );
}
