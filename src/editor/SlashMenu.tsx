import { createMemo, For, Show } from 'solid-js';
import type { JSX } from '@solidjs/web';
import type { EditorView } from '@tiptap/pm/view';
import { useOutline } from '@/tree-view/outline-context';
import { useUiStore } from '@/store/ui-store';
import { isCoarsePointer } from '@/ui/media';
import { slashCommands, type SlashCommand } from './slash-registry';

interface ListProps {
  items: SlashCommand[];
  index: number;
  onPick(index: number): void;
  onHover(index: number): void;
  style?: JSX.CSSProperties | undefined;
}

/** Room kept free at the bottom of the screen for the phone toolbar above the keyboard. */
const TOOLBAR_PX = 56;
const MENU_PX = 288;

/**
 * Where the menu goes inside `container` (its positioned parent): under the
 * "/" when there is room, else above it, so the keyboard and the phone
 * toolbar never cover it.
 */
export function slashPlacement(view: EditorView, from: number, container: Element, rows: number): JSX.CSSProperties {
  const at = view.coordsAtPos(Math.min(from, view.state.doc.content.size));
  const box = container.getBoundingClientRect();
  const coarse = isCoarsePointer();
  const screen = window.visualViewport?.height ?? window.innerHeight;
  const below = screen - (coarse ? TOOLBAR_PX : 0) - at.bottom;
  const height = Math.min(MENU_PX, Math.max(rows, 1) * (coarse ? 40 : 32) + 12);
  const left = Math.max(0, Math.min(at.left - box.left, box.width - MENU_PX));
  if (below < height && at.top > below) return { top: 'auto', bottom: `${box.bottom - at.top + 4}px`, left: `${left}px`, 'margin-top': '0px' };
  return { top: `${at.bottom - box.top + 4}px`, left: `${left}px`, 'margin-top': '0px' };
}

/** The "/" command list; the node line and the note editor each drive one. */
export function SlashList(props: ListProps) {
  return (
    <div
      role="listbox"
      aria-label="Commands"
      data-testid="slash-menu"
      class="absolute top-full left-0 z-20 mt-1 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-line bg-surface py-1 text-sm shadow-lg"
      style={props.style}
    >
      <Show when={props.items.length === 0}>
        <div class="px-3 py-1.5 text-faint">No matching command</div>
      </Show>
      <For each={props.items}>
        {(item, i) => (
          <div
            role="option"
            aria-selected={i() === props.index ? 'true' : 'false'}
            data-testid="slash-item"
            class={['flex cursor-pointer items-center justify-between px-3 py-1.5 pointer-coarse:py-2.5', { 'bg-active': i() === props.index }]}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onPick(i());
            }}
            onMouseEnter={() => props.onHover(i())}
          >
            <span>{item.title}</span>
            <Show when={item.group}>
              <span class="ml-3 text-xs text-faint">{item.group}</span>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

/** Floating command list under the focused node while the slash query is open. */
export function SlashMenu() {
  const { ui, actions, session } = useOutline();
  const slash = useUiStore(ui, (s) => s.slash);
  return (
    <Show when={slash()}>
      {(open) => {
        const items = createMemo(() => slashCommands(open().query, 'content'));
        // The editor's own box (made positioned by NodeEditor).
        const style = () => {
          const host = session.editor.view.dom.parentElement?.parentElement;
          return host ? slashPlacement(session.editor.view, open().from, host, items().length) : undefined;
        };
        return (
          <SlashList
            items={items()}
            index={Math.min(open().index, Math.max(0, items().length - 1))}
            onPick={(i) => actions.runSlash(i)}
            onHover={(i) => ui.setSlash({ ...open(), index: i })}
            style={style()}
          />
        );
      }}
    </Show>
  );
}
