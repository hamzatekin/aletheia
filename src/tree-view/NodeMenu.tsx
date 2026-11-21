import { createEffect, createMemo, For, Show } from 'solid-js';
import { Portal } from '@solidjs/web';
import { moveDownCommand, moveUpCommand, type Command } from '@/commands';
import { importItems } from '@/io';
import { subtreeItems } from '@/io/clipboard';
import { formatTerminalContent, formatTerminalNote } from '@/io/terminal';
import { COLORS, HEADINGS, type TreeReader } from '@/model';
import { isNoteCollapsed, notePrefs, useNotePrefs } from '@/store/note-prefs';
import { isMac } from '@/ui/media';
import { useOutline } from './outline-context';
import { useNode } from './use-outline';

const MOD = isMac ? '⌘' : 'Ctrl+';
const ALT = isMac ? '⌥' : 'Alt+';

interface Item {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
  run(): void;
}

/** updateContent/updateNote commands that clean up terminal output pasted into the node and its descendants. */
function terminalFixes(tree: TreeReader, id: string): Command[] {
  const n = tree.get(id)!;
  const content = formatTerminalContent(n.content);
  const note = formatTerminalNote(n.note);
  return [
    ...(content !== n.content ? [{ type: 'updateContent' as const, id, content }] : []),
    ...(note !== n.note ? [{ type: 'updateNote' as const, id, note }] : []),
    ...tree.children(id).flatMap((c) => terminalFixes(tree, c)),
  ];
}

/**
 * The actions for a node: a dropdown under the row's ≡ grip, or on touch
 * screens a sheet from the bottom of the screen, where a thumb reaches it.
 */
export function NodeMenu(props: { id: string; hasChildren: boolean; sheet?: boolean }) {
  const { engine, ui, session, rootId, actions, ai, navigate } = useOutline();
  let ref: HTMLDivElement | undefined;
  const close = () => ui.setMenu(null);
  const noteCollapsed = useNotePrefs((s) => isNoteCollapsed(s, props.id));
  const node = useNode(() => props.id);
  const sheet = () => props.sheet ?? false;

  createEffect(
    () => [props.id, sheet()] as const,
    ([id, sheet]) => {
      const onDown = (e: PointerEvent) => {
        const t = e.target as Element;
        if (!ref?.contains(t) && !t.closest?.(`[data-menu-for="${id}"]`)) ui.setMenu(null);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          ui.setMenu(null);
        }
      };
      // The sheet's backdrop takes taps outside it instead (below).
      if (!sheet) document.addEventListener('pointerdown', onDown, true);
      window.addEventListener('keydown', onKey, true);
      return () => {
        document.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('keydown', onKey, true);
      };
    },
  );

  const { tree } = engine;
  const exec = (cmd: Command | null) => {
    session.flush();
    if (cmd) engine.execute(cmd);
  };

  // Rebuilt when the node (or the page's root) changes; the buttons below are keyed by id, so they stay in place.
  const items = createMemo((): Item[] => {
    const n = node();
    if (!n) return [];
    const id = props.id;
    const canOutdent = n.parentId !== rootId();
    const fixes = terminalFixes(tree, id);
    const done = n.completedAt != null;
    return [
      { id: 'zoom', label: 'Zoom in', hint: `${MOD}.`, run: () => (session.flush(), navigate(`/n/${id}`)) },
      {
        id: 'complete',
        label: done ? 'Mark not done' : 'Complete',
        hint: `${MOD}Enter`,
        // The row being edited may leave the page (done items hidden): the caret then moves on.
        run: () => (ui.getState().focus?.id === id ? actions.completeFocused(id) : exec({ type: 'toggleComplete', id })),
      },
      { id: 'note', label: n.note === '' ? 'Add note' : 'Edit note', hint: 'Shift+Enter', run: () => ui.focusNode(id, { kind: 'end' }, 'note') },
      ...(n.note !== ''
        ? [{ id: 'note-collapse', label: noteCollapsed() ? 'Expand note' : 'Collapse note', run: () => notePrefs.getState().toggleCollapsed(id) }]
        : []),
      ...(props.hasChildren
        ? [
            { id: 'expand-all', label: 'Expand all inside', run: () => actions.setAllCollapsed(id, false, true) },
            { id: 'collapse-all', label: 'Collapse all inside', run: () => actions.setAllCollapsed(id, true, true) },
          ]
        : []),
      ...(ai.available() ? [{ id: 'ai-title', label: 'Suggest title (AI)', run: () => void ai.suggestTitle(id) }] : []),
      {
        id: 'star',
        label: n.starredAt != null ? 'Unstar' : 'Star',
        run: () => exec({ type: 'toggleStar', id }),
      },
      { id: 'select', label: 'Select', hint: 'Esc', run: () => actions.selectNode(id) },
      { id: 'indent', label: 'Indent', hint: 'Tab', run: () => exec({ type: 'indent', id }) },
      ...(canOutdent ? [{ id: 'outdent', label: 'Outdent', hint: 'Shift+Tab', run: () => exec({ type: 'outdent', id }) }] : []),
      { id: 'up', label: 'Move up', hint: `${ALT}Shift+↑`, run: () => exec(moveUpCommand({ tree, now: 0 }, id)) },
      { id: 'down', label: 'Move down', hint: `${ALT}Shift+↓`, run: () => exec(moveDownCommand({ tree, now: 0 }, id)) },
      {
        id: 'duplicate',
        label: 'Duplicate',
        run: () => {
          session.flush();
          importItems(engine, tree.get(id)!.parentId, subtreeItems(tree, [id]), id);
        },
      },
      ...(fixes.length > 0
        ? [{ id: 'terminal', label: 'Format terminal output', run: () => (session.flush(), engine.batch(terminalFixes(tree, id), 'format')) }]
        : []),
      {
        id: 'link',
        label: 'Copy link',
        run: () => void navigator.clipboard?.writeText(`${location.origin}/n/${id}`).catch(() => {}),
      },
      {
        id: 'delete',
        label: 'Delete',
        danger: true,
        run: () => {
          session.flush();
          if (ui.getState().focus?.id === id) ui.blur();
          // An empty node only groups its children, so deleting it keeps them.
          const empty = tree.get(id)!.content.trim() === '';
          engine.execute({ type: empty ? 'deleteNode' : 'deleteSubtree', id });
        },
      },
    ];
  });

  const itemButton = (item: () => Item) => (
    <button
      type="button"
      role="menuitem"
      data-testid={`node-menu-${item().id}`}
      class={[
        'flex w-full items-center justify-between text-left hover:bg-hover active:bg-active',
        sheet() ? 'px-5 py-3' : 'px-3 py-1.5',
        item().danger ? 'text-danger' : 'text-ink',
      ]}
      onClick={() => {
        close();
        item().run();
      }}
    >
      <span>{item().label}</span>
      <Show when={item().hint && !sheet()}>
        <span class="ml-3 text-xs text-faint">{item().hint}</span>
      </Show>
    </button>
  );
  const chip = () => ['flex items-center justify-center rounded hover:bg-hover active:bg-active', sheet() ? 'h-10 min-w-9' : 'h-7 min-w-6'];
  const heading = () => node()?.heading ?? null;
  const color = () => node()?.color ?? null;

  const menu = () => (
    <div
      ref={ref}
      role="menu"
      aria-label="Node actions"
      data-testid="node-menu"
      class={
        sheet()
          ? 'fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-xl border-t border-line bg-surface py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-base shadow-2xl'
          : 'absolute top-full left-0 z-20 mt-1 w-64 rounded-md border border-line bg-surface py-1 text-sm shadow-lg'
      }
      onMouseDown={(e) => e.preventDefault()}
    >
      <For each={items().filter((item) => !item.danger)} keyed={(item) => item.id}>
        {itemButton}
      </For>
      {/* Heading size and color label, as in Dynalist: pick one, pick it again to clear it. */}
      <div class={['flex items-center border-t border-line justify-between', sheet() ? 'px-4 py-2' : 'px-2 py-1']} role="group" aria-label="Heading and color">
        <For each={HEADINGS}>
          {(h) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={heading() === h ? 'true' : 'false'}
              title={heading() === h ? 'Back to a normal row' : `Heading ${h}`}
              data-testid={`node-menu-h${h}`}
              class={[chip(), 'px-1.5 text-xs font-semibold', heading() === h ? 'bg-active text-ink' : 'text-muted']}
              onClick={() => {
                const current = heading();
                close();
                exec({ type: 'setHeading', id: props.id, heading: current === h ? null : h });
              }}
            >
              H{h}
            </button>
          )}
        </For>
        <span class="mx-1 h-4 w-px bg-line" aria-hidden="true" />
        <For each={COLORS}>
          {(c) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={color() === c ? 'true' : 'false'}
              aria-label={color() === c ? `Remove ${c}` : c[0]!.toUpperCase() + c.slice(1)}
              title={color() === c ? 'Remove color' : c[0]!.toUpperCase() + c.slice(1)}
              data-testid={`node-menu-color-${c}`}
              class={chip()}
              onClick={() => {
                const current = color();
                close();
                exec({ type: 'setColor', id: props.id, color: current === c ? null : c });
              }}
            >
              <span class={['color-dot', { 'color-dot-on': color() === c }]} data-color={c} />
            </button>
          )}
        </For>
      </div>
      <div class="border-t border-line">
        <For each={items().filter((item) => item.danger)} keyed={(item) => item.id}>
          {itemButton}
        </For>
      </div>
    </div>
  );

  return (
    <Show when={node()}>
      <Show when={sheet()} fallback={menu()}>
        <Portal mount={document.body}>
          {/* Closing on the tap's click, not its touch, keeps the backdrop up until the tap ends, so it doesn't fall through to the row below. */}
          <div class="fixed inset-0 z-50 bg-black/20" aria-hidden="true" onClick={close} />
          {menu()}
        </Portal>
      </Show>
    </Show>
  );
}
