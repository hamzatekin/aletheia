import type { CSSProperties } from 'react';
import type { EditorView } from '@tiptap/pm/view';
import { useOutline } from '@/tree-view/outline-context';
import { useUiStore } from '@/store/ui-store';
import { slashCommands, type SlashCommand } from './slash-registry';

interface ListProps {
  items: SlashCommand[];
  index: number;
  onPick(index: number): void;
  onHover(index: number): void;
  style?: CSSProperties;
}

/** Room kept free at the bottom of the screen for the phone toolbar above the keyboard. */
const TOOLBAR_PX = 56;
const MENU_PX = 288;

/**
 * Where the menu goes inside `container` (its positioned parent): under the
 * "/" when there is room, else above it, so the keyboard and the phone
 * toolbar never cover it.
 */
export function slashPlacement(view: EditorView, from: number, container: Element, rows: number): CSSProperties {
  const at = view.coordsAtPos(Math.min(from, view.state.doc.content.size));
  const box = container.getBoundingClientRect();
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const screen = window.visualViewport?.height ?? window.innerHeight;
  const below = screen - (coarse ? TOOLBAR_PX : 0) - at.bottom;
  const height = Math.min(MENU_PX, Math.max(rows, 1) * (coarse ? 40 : 32) + 12);
  const left = Math.max(0, Math.min(at.left - box.left, box.width - MENU_PX));
  if (below < height && at.top > below) return { top: 'auto', bottom: box.bottom - at.top + 4, left, marginTop: 0 };
  return { top: at.bottom - box.top + 4, left, marginTop: 0 };
}

/** The "/" command list; the node line and the note editor each drive one. */
export function SlashList({ items, index, onPick, onHover, style }: ListProps) {
  return (
    <div
      role="listbox"
      aria-label="Commands"
      data-testid="slash-menu"
      className="absolute top-full left-0 z-20 mt-1 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-line bg-surface py-1 text-sm shadow-lg"
      style={style}
    >
      {items.length === 0 && <div className="px-3 py-1.5 text-faint">No matching command</div>}
      {items.map((item, i) => (
        <div
          key={item.id}
          role="option"
          aria-selected={i === index}
          data-testid="slash-item"
          className={
            'flex cursor-pointer items-center justify-between px-3 py-1.5 pointer-coarse:py-2.5 ' +
            (i === index ? 'bg-active' : '')
          }
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(i);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span>{item.title}</span>
          {item.group && <span className="ml-3 text-xs text-faint">{item.group}</span>}
        </div>
      ))}
    </div>
  );
}

/** Floating command list under the focused node while the slash query is open. */
export function SlashMenu() {
  const { ui, actions, session } = useOutline();
  const slash = useUiStore(ui, (s) => s.slash);
  if (!slash) return null;
  // The editor's own box (made positioned by NodeEditor).
  const host = session.editor.view.dom.parentElement?.parentElement;
  const items = slashCommands(slash.query, 'content');
  const index = Math.min(slash.index, Math.max(0, items.length - 1));
  return (
    <SlashList
      items={items}
      index={index}
      onPick={(i) => actions.runSlash(i)}
      onHover={(i) => ui.setSlash({ ...slash, index: i })}
      {...(host ? { style: slashPlacement(session.editor.view, slash.from, host, items.length) } : {})}
    />
  );
}
