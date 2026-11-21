import { For, Show, type Accessor } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { moveDownCommand, moveUpCommand } from '@/commands';
import { useUiStore } from '@/store/ui-store';
import type { SelectionAction } from './actions';
import { useOutline } from './outline-context';
import { useNode } from './use-outline';
import { useKeyboardInset } from '@/ui/hooks';
import { useCoarsePointer } from '@/ui/media';

function Icon(props: { children: JSX.Element }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {props.children}
    </svg>
  );
}

interface ToolbarButton {
  id: string;
  /** A getter where it changes: JSX reads it as it would a signal. */
  label: string;
  disabled?: Accessor<boolean>;
  run(): void;
  icon: JSX.Element;
}

/**
 * The bar above the phone keyboard while editing, like WorkFlowy's and
 * Dynalist's: the outline keys a phone keyboard lacks (Tab, Shift+Tab,
 * Alt+Shift+arrows), plus undo, the node menu and a button to stop editing.
 */
export function MobileToolbar() {
  const { engine, ui, session, actions, rootId } = useOutline();
  const coarse = useCoarsePointer();
  const focusedId = useUiStore(ui, (s) => s.focus?.id ?? null);
  const field = useUiStore(ui, (s) => s.focus?.field);
  const inset = useKeyboardInset();

  return (
    <Show when={coarse() ? focusedId() : null}>
      {(id) => {
        const isTitle = () => id() === rootId();
        const node = useNode(id);
        const canOutdent = () => !isTitle() && node()?.parentId !== rootId();

        const structural = (run: () => void) => () => {
          if (isTitle()) return;
          session.flush();
          run();
        };

        const buttons: ToolbarButton[] = [
          {
            id: 'outdent',
            label: 'Outdent',
            disabled: () => !canOutdent(),
            run: structural(() => engine.execute({ type: 'outdent', id: id() })),
            icon: <Icon><path d="M21 6H11M21 12H11M21 18H11M7 8l-4 4 4 4" /></Icon>,
          },
          {
            id: 'indent',
            label: 'Indent',
            disabled: isTitle,
            run: structural(() => engine.execute({ type: 'indent', id: id() })),
            icon: <Icon><path d="M21 6H11M21 12H11M21 18H11M3 8l4 4-4 4" /></Icon>,
          },
          {
            id: 'move-up',
            label: 'Move up',
            disabled: isTitle,
            run: structural(() => {
              const cmd = moveUpCommand({ tree: engine.tree, now: 0 }, id());
              if (cmd) engine.execute(cmd);
            }),
            icon: <Icon><path d="M12 19V5M6 11l6-6 6 6" /></Icon>,
          },
          {
            id: 'move-down',
            label: 'Move down',
            disabled: isTitle,
            run: structural(() => {
              const cmd = moveDownCommand({ tree: engine.tree, now: 0 }, id());
              if (cmd) engine.execute(cmd);
            }),
            icon: <Icon><path d="M12 5v14M6 13l6 6 6-6" /></Icon>,
          },
          {
            id: 'note',
            get label() {
              return field() === 'note' ? 'Back to node' : 'Note';
            },
            run: () => {
              session.flush();
              ui.focusNode(id(), { kind: 'end' }, ui.getState().focus?.field === 'note' ? 'content' : 'note');
            },
            icon: <Icon><path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3" /></Icon>,
          },
          {
            id: 'undo',
            label: 'Undo',
            run: () => actions.undo(),
            icon: <Icon><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Icon>,
          },
          {
            id: 'redo',
            label: 'Redo',
            run: () => actions.redo(),
            icon: <Icon><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></Icon>,
          },
          {
            id: 'more',
            label: 'More actions',
            disabled: isTitle,
            run: () => {
              // The menu hangs under the row; closing the keyboard keeps it on screen.
              const menu = ui.getState().menu;
              session.flush();
              ui.blur();
              ui.setMenu(menu === id() ? null : id());
            },
            icon: <Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>,
          },
          {
            id: 'done',
            label: 'Done',
            run: () => {
              session.flush();
              ui.blur();
              (document.activeElement as HTMLElement | null)?.blur();
            },
            icon: <Icon><path d="m6 9 6 6 6-6" /></Icon>,
          },
        ];

        return (
          <div
            role="toolbar"
            aria-label="Editing tools"
            data-testid="mobile-toolbar"
            class="fixed inset-x-0 z-40 flex items-stretch justify-around border-t border-line bg-surface"
            style={{ bottom: `${inset()}px`, 'padding-bottom': inset() === 0 ? 'env(safe-area-inset-bottom)' : '0px' }}
            // Keep the editor (and the keyboard) while a button is tapped.
            onMouseDown={(e) => e.preventDefault()}
          >
            <For each={buttons}>
              {(b) => (
                <button
                  type="button"
                  tabindex="-1"
                  aria-label={b.label}
                  title={b.label}
                  disabled={b.disabled?.() ?? false}
                  data-testid={`toolbar-${b.id}`}
                  data-menu-for={b.id === 'more' ? id() : undefined}
                  class="flex h-11 min-w-0 flex-1 items-center justify-center text-muted active:bg-active disabled:opacity-30"
                  onClick={b.run}
                >
                  {b.icon}
                </button>
              )}
            </For>
          </div>
        );
      }}
    </Show>
  );
}

/**
 * The bar at the bottom of a phone while nodes are selected (after a long
 * press or the menu's Select): what the keyboard does with a selection on a
 * computer. Tapping rows adds or removes them.
 */
export function SelectionBar() {
  const { ui, actions } = useOutline();
  const coarse = useCoarsePointer();
  const count = useUiStore(ui, (s) => (s.focus ? 0 : (s.selection?.ids.size ?? 0)));

  const buttons: { id: SelectionAction; label: string; icon: JSX.Element }[] = [
    { id: 'outdent', label: 'Outdent', icon: <Icon><path d="M21 6H11M21 12H11M21 18H11M7 8l-4 4 4 4" /></Icon> },
    { id: 'indent', label: 'Indent', icon: <Icon><path d="M21 6H11M21 12H11M21 18H11M3 8l4 4-4 4" /></Icon> },
    { id: 'moveUp', label: 'Move up', icon: <Icon><path d="M12 19V5M6 11l6-6 6 6" /></Icon> },
    { id: 'moveDown', label: 'Move down', icon: <Icon><path d="M12 5v14M6 13l6 6 6-6" /></Icon> },
    {
      id: 'copy',
      label: 'Copy',
      icon: <Icon><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h9" /></Icon>,
    },
    {
      id: 'cut',
      label: 'Cut',
      icon: <Icon><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M7.8 16.2 18 4M16.2 16.2 6 4" /></Icon>,
    },
    {
      id: 'paste',
      label: 'Paste below',
      icon: <Icon><path d="M9 4h6v3H9zM15 5h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3" /></Icon>,
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Icon><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Icon>,
    },
    { id: 'done', label: 'Done', icon: <Icon><path d="m5 12 5 5 9-10" /></Icon> },
  ];

  return (
    <Show when={coarse() && count() > 0}>
      <div
        role="toolbar"
        aria-label={`${count()} selected`}
        data-testid="selection-bar"
        class="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
        onMouseDown={(e) => e.preventDefault()}
      >
        <div class="px-3 pt-1.5 text-xs text-muted" data-testid="selection-count">
          {count()} selected · tap rows to add or remove
        </div>
        <div class="flex items-stretch justify-around">
          <For each={buttons}>
            {(b) => (
              <button
                type="button"
                tabindex="-1"
                aria-label={b.label}
                title={b.label}
                data-testid={`selection-${b.id}`}
                class={['flex h-11 min-w-0 flex-1 items-center justify-center active:bg-active', b.id === 'delete' ? 'text-danger' : 'text-muted']}
                onClick={() => actions.selectionAction(b.id)}
              >
                {b.icon}
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
