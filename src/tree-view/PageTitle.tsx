import { Show } from 'solid-js';
import { renderBlock, renderInline } from '@/editor/render';
import { noteAfterTick, taskCheckboxAt } from '@/editor/task-list';
import { NodeEditor } from '@/editor/NodeEditor';
import { NoteEditor, NoteHeader } from '@/editor/NoteEditor';
import type { Node } from '@/model';
import { useUiStore } from '@/store/ui-store';
import { useOutline } from './outline-context';
import { StarIcon } from './Star';

/** A zoomed-in page's heading: the node's text as the title, its note beneath, and a star in the gutter. */
export function PageTitle(props: { root: Node }) {
  const { engine, ui } = useOutline();
  const titleFocus = useUiStore(ui, (s) => (s.focus?.id === props.root.id ? s.focus.field : null));
  const starred = () => props.root.starredAt != null;

  const onTitleMouseDown = (e: MouseEvent & { currentTarget: HTMLElement; target: Element }) => {
    if (e.target.closest('a') || e.button !== 0) return;
    e.preventDefault();
    ui.focusNode(props.root.id, { kind: 'point', x: e.clientX, y: e.clientY });
  };

  return (
    <header class="group group/title relative mb-4" data-node-id={props.root.id} data-title="true">
      {/* In the gutter left of the title, where rows have their bullets: star this page. */}
      <button
        type="button"
        onClick={() => engine.execute({ type: 'toggleStar', id: props.root.id })}
        onMouseDown={(e) => e.preventDefault()}
        class={[
          'page-star absolute flex size-7 items-center justify-center rounded-full hover:bg-hover',
          starred() ? 'star-on' : 'text-faint opacity-0 group-hover/title:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
        ]}
        aria-label={starred() ? 'Unstar this page' : 'Star this page'}
        aria-pressed={starred() ? 'true' : 'false'}
        title={starred() ? 'Starred: listed in the sidebar. Click to unstar.' : 'Star: list this page in the sidebar'}
        data-testid="page-star"
      >
        <StarIcon filled={starred()} size={17} />
      </button>
      <Show
        when={titleFocus() === 'content'}
        fallback={
          <h1
            class="node-content page-title cursor-text font-normal tracking-tight wrap-break-word"
            onMouseDown={onTitleMouseDown}
            innerHTML={renderInline(props.root.content) || '<br>'}
          />
        }
      >
        <NodeEditor id={props.root.id} class="node-content page-title font-normal tracking-tight wrap-break-word" />
      </Show>
      <Show
        when={titleFocus() === 'note'}
        fallback={
          <Show when={props.root.note !== ''}>
            {/* Laid out exactly like the editor that replaces it (NoteEditor): the same
                icons at the upper right and the same text size, so clicking in moves nothing. */}
            <div class="note-box relative mt-1 flow-root">
              <NoteHeader id={props.root.id} quiet />
              <div
                class="prose-note row-note cursor-text pb-0.5 text-note"
                onMouseDown={(e) => {
                  if (e.target.closest('a')) return;
                  e.preventDefault();
                  if (!taskCheckboxAt(e.target)) ui.focusNode(props.root.id, { kind: 'end' }, 'note');
                }}
                onClick={(e) => {
                  const box = taskCheckboxAt(e.target);
                  if (!box) return;
                  e.preventDefault();
                  engine.execute({ type: 'updateNote', id: props.root.id, note: noteAfterTick(props.root.note, box) });
                }}
                innerHTML={renderBlock(props.root.note)}
              />
            </div>
          </Show>
        }
      >
        <div class="mt-1">
          <NoteEditor id={props.root.id} />
        </div>
      </Show>
    </header>
  );
}
