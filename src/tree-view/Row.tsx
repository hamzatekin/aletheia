import { createMemo, createSignal, Match, Repeat, Show, Switch } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { renderBlock, renderInline } from '@/editor/render';
import { NodeEditor } from '@/editor/NodeEditor';
import { NoteEditor, NoteHeader } from '@/editor/NoteEditor';
import { useUiStore } from '@/store/ui-store';
import { useSettings } from '@/store/settings-store';
import { isNoteCollapsed, notePrefs, useNotePrefs } from '@/store/note-prefs';
import { addedLabel, findInbox } from '@/app/capture';
import { noteAfterTick, taskCheckboxAt } from '@/editor/task-list';
import { Bullet } from './Bullet';
import { CollapseToggle } from './CollapseToggle';
import { NodeMenu } from './NodeMenu';
import { useCoarsePointer } from '@/ui/media';
import { useOutline } from './outline-context';
import { useHasChildren, useNode } from './use-outline';
import { useRowDnd } from './use-dnd';
import { INDENT_PX, LONG_PRESS_MS, LONG_PRESS_SLOP_PX, TOUCH_INDENT_PX } from './layout';


interface Props {
  id: string;
  depth: number;
  /** While searching in place: whether the search shows this row's children (unset: its own collapsed state decides). */
  filterOpen?: boolean | undefined;
  /** While searching in place: the row itself matches. */
  match?: boolean | undefined;
}

/** A mouse event with its target known to be an element, as Solid's handlers get it. */
type RowMouse = MouseEvent & { target: Element };

/** One outline row: gutter (toggle + bullet), content, optional note. Outline keys rows by id; depth, filterOpen and match can change while it stays. */
export function Row(props: Props) {
  const { engine, ui, actions, session, settings } = useOutline();
  const node = useNode(() => props.id);
  const hasChildren = useHasChildren(() => props.id);
  const focusField = useUiStore(ui, (s) => (s.focus?.id === props.id ? s.focus.field : null));
  const selected = useUiStore(ui, (s) => s.selection?.ids.has(props.id) ?? false);
  const dragging = useUiStore(ui, (s) => s.dragging === props.id);
  const menuOpen = useUiStore(ui, (s) => s.menu === props.id);
  // A collapsed note is hidden, with a mark at the right, and shows while you're on its item.
  const noteFolded = useNotePrefs((s) => isNoteCollapsed(s, props.id));
  // Pressing elsewhere on the item you're on leaves it until the press ends; it stays highlighted, with its note shown, meanwhile.
  const [noteHeld, setNoteHeld] = createSignal(false);
  const indicator = useUiStore(ui, (s) => (s.dropIndicator?.targetId === props.id ? s.dropIndicator : null));
  const coarse = useCoarsePointer();
  const inboxDates = useSettings(settings, (s) => s.inboxDates);
  const indent = () => (coarse() ? TOUCH_INDENT_PX : INDENT_PX);
  let rowEl: HTMLDivElement | undefined;
  let handleEl: HTMLAnchorElement | undefined;
  let gripEl: HTMLButtonElement | undefined;
  let longPress: { timer: number; x: number; y: number; fired: number } | null = null;
  useRowDnd(
    () => props.id,
    () => props.depth,
    () => rowEl,
    () => handleEl,
    () => gripEl,
  );

  const noteCollapsed = () => {
    const n = node();
    return n !== undefined && n.note !== '' && noteFolded() && focusField() === null && !noteHeld();
  };
  // Inbox items can show when they were added (off by default): their name is whatever was typed first.
  const added = () => {
    const n = node();
    return n && inboxDates() && n.parentId !== null && n.parentId === findInbox(engine.tree) ? addedLabel(n.createdAt, { short: coarse() }) : null;
  };

  // While searching, the search decides what is open; toggling changes only the search, not the outline.
  const collapsed = () => (props.filterOpen === undefined ? (node()?.collapsed ?? false) : !props.filterOpen);
  const toggle = () => {
    if (props.filterOpen === undefined) engine.execute({ type: 'toggleCollapse', id: props.id });
    else actions.toggleFilterRow(props.id);
  };

  /** Shift+click, Ctrl/Cmd+click, and taps while selecting on a phone pick nodes instead of editing. Returns true if handled. */
  const selectClick = (e: RowMouse): boolean => {
    if (Date.now() - (longPress?.fired ?? 0) < 800) {
      e.preventDefault();
      return true; // the tap that ended a long press
    }
    const { focus, selection } = ui.getState();
    if (e.shiftKey && (focus || selection)) {
      e.preventDefault();
      actions.selectTo(props.id);
      return true;
    }
    const onLink = (e.target as HTMLElement).closest('a') !== null;
    if (((e.metaKey || e.ctrlKey) && !onLink) || (coarse() && selection && !focus)) {
      if (!focus && !selection) return false;
      e.preventDefault();
      actions.toggleSelected(props.id);
      return true;
    }
    return false;
  };

  /**
   * Pressing on a row's text. With a mouse the browser selects text right
   * away, as on any page (and as in WorkFlowy and Dynalist); editing starts on
   * release if nothing got selected. A drag into another row selects whole
   * nodes instead (use-page-events.ts). Touch screens start editing at once.
   */
  const pressText = (e: RowMouse, field: 'content' | 'note') => {
    if (e.button !== 0) return;
    if (selectClick(e)) return;
    if ((e.target as HTMLElement).closest('a')) return; // let links open
    const id = props.id;
    const point = { kind: 'point', x: e.clientX, y: e.clientY } as const;
    if (coarse() || e.detail >= 2) {
      // The second press of a quick double-click lands before the editor is up: select the word in it.
      e.preventDefault();
      ui.focusNode(id, e.detail >= 2 ? { ...point, word: true } : point, field);
      return;
    }
    const { focus } = ui.getState();
    if (focus) {
      // Without the hold, the item's hidden note would close here and open again on release.
      if (focus.id === id) setNoteHeld(true);
      session.flush();
      ui.blur();
    }
    ui.setSelection(null);
    const release = () => setNoteHeld(false);
    window.addEventListener(
      'mouseup',
      (up: MouseEvent) => {
        if (ui.getState().selection || ui.getState().focus) return release(); // dragged across rows, or already editing
        const sel = document.getSelection();
        const dragged = Math.hypot(up.clientX - point.x, up.clientY - point.y) > 3;
        if (dragged && sel && !sel.isCollapsed && rowEl?.contains(sel.anchorNode)) {
          // Text was selected: keep it, and the note it may be in, until the next press.
          window.addEventListener('mousedown', release, { once: true, capture: true });
          return;
        }
        ui.focusNode(id, point, field);
        release();
      },
      { once: true },
    );
  };
  const onContentMouseDown = (e: RowMouse) => pressText(e, 'content');

  // A long press selects the node, as in WorkFlowy's and Dynalist's apps.
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1 || ui.getState().focus?.id === props.id) return;
    const t = e.touches[0]!;
    const fired = longPress?.fired ?? 0;
    const id = props.id;
    const timer = window.setTimeout(() => {
      if (!longPress) return;
      longPress.fired = Date.now();
      navigator.vibrate?.(10);
      const { selection } = ui.getState();
      if (selection && !selection.ids.has(id)) actions.toggleSelected(id);
      else if (!selection) actions.selectNode(id);
    }, LONG_PRESS_MS);
    longPress = { timer, x: t.clientX, y: t.clientY, fired };
  };
  const onTouchMove = (e: TouchEvent) => {
    const lp = longPress;
    const t = e.touches[0];
    if (lp && t && Math.hypot(t.clientX - lp.x, t.clientY - lp.y) > LONG_PRESS_SLOP_PX) clearTimeout(lp.timer);
  };
  const onTouchEnd = () => {
    if (longPress) clearTimeout(longPress.timer);
  };

  // On phones a long press on the bullet opens this menu; leaving the text first closes the keyboard, so the sheet has the screen.
  const bulletMenu = {
    get open() {
      return menuOpen();
    },
    show: () => {
      session.flush();
      ui.blur();
      ui.setMenu(props.id);
    },
  };

  const onNoteMouseDown = (e: RowMouse) => {
    // A checklist's box ticks on click, without opening the note.
    if (taskCheckboxAt(e.target)) return e.preventDefault();
    pressText(e, 'note');
  };
  const onNoteClick = (e: RowMouse) => {
    const box = taskCheckboxAt(e.target);
    const n = node();
    if (!box || !n || ui.getState().selection) return;
    e.preventDefault();
    engine.execute({ type: 'updateNote', id: props.id, note: noteAfterTick(n.note, box) });
  };

  // The grip and its menu sit just left of the bullet, or of the arrow on a parent, as in Dynalist (desktop only, so the desktop indent).
  const gripLeft = () => props.depth * INDENT_PX - (hasChildren() ? 68 : 48);
  const gripShown = () => focusField() !== null || noteHeld() || menuOpen();

  return (
    <Show when={node()}>
      {(n) => (
        <div
          ref={(el) => (rowEl = el)}
          class={[
            'group relative flex items-start',
            selected() ? 'rounded bg-selection' : focusField() !== null || noteHeld() ? 'row-focused' : '',
            { 'opacity-40': dragging() },
          ]}
          style={{ 'padding-left': `${props.depth * indent()}px` }}
          data-node-id={props.id}
          data-depth={props.depth}
          data-focused={focusField() ?? undefined}
          data-selected={selected() ? 'true' : undefined}
          data-match={props.match ? 'true' : undefined}
          data-done={n().completedAt != null ? 'true' : undefined}
          data-heading={n().heading ?? undefined}
          data-color={n().color ?? undefined}
        >
          {/* Indent guides, like WorkFlowy's: one line per ancestor level, down from its bullet through its children. */}
          <Repeat count={props.depth}>
            {(level) => (
              <div
                aria-hidden="true"
                class="indent-guide pointer-events-none absolute inset-y-0 w-px"
                style={{ left: `${level * indent() - (coarse() ? 14 : 16)}px` }}
              />
            )}
          </Repeat>
          <Show when={indicator()}>
            {(ind) => (
              <div
                class="pointer-events-none absolute right-0 z-10 h-0.5 rounded bg-accent"
                style={{ left: `${ind().level * indent() - 20}px`, [ind().edge === 'above' ? 'top' : 'bottom']: '-1px' }}
                data-testid="drop-indicator"
                data-level={ind().level}
                data-edge={ind().edge}
              >
                <div class="absolute -top-[3px] -left-[3px] h-2 w-2 rounded-full border-2 border-accent bg-surface" />
              </div>
            )}
          </Show>
          <button
            ref={(el) => (gripEl = el)}
            type="button"
            aria-label="Node menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen() ? 'true' : 'false'}
            tabindex={-1}
            class={[
              'grip absolute flex h-6 w-6 pointer-coarse:hidden cursor-pointer items-center justify-center rounded-full text-faint transition-[opacity,background-color]',
              gripShown() ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            ]}
            style={{ left: `${gripLeft()}px`, top: 'calc((var(--row-lh) - 1.5rem) / 2 + 1px)' }}
            data-testid="drag-grip"
            data-menu-for={props.id}
            onClick={() => ui.setMenu(menuOpen() ? null : props.id)}
          >
            <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor">
              <rect y="0" width="14" height="1.25" rx="0.6" />
              <rect y="4.4" width="14" height="1.25" rx="0.6" />
              <rect y="8.75" width="14" height="1.25" rx="0.6" />
            </svg>
          </button>
          <Show when={menuOpen()}>
            <div class="absolute" style={{ left: `${gripLeft()}px`, top: 'var(--row-lh)' }}>
              <NodeMenu id={props.id} hasChildren={hasChildren()} sheet={coarse()} />
            </div>
          </Show>
          {/* On phones the arrow sits at the right end, so the gutter holds just the bullet. */}
          <div class={coarse() ? '-ml-6 flex w-6 shrink-0 items-start pr-1' : '-ml-11.5 flex w-11.5 shrink-0 items-start pr-1.5'}>
            <Show when={!coarse()}>
              <Show when={hasChildren()} fallback={<span class="w-5 shrink-0" />}>
                <CollapseToggle collapsed={collapsed()} onToggle={toggle} shown={gripShown()} />
              </Show>
            </Show>
            <Bullet
              id={props.id}
              collapsedWithChildren={collapsed() && hasChildren()}
              handleRef={(el) => (handleEl = el)}
              menu={coarse() ? bulletMenu : undefined}
            />
          </div>
          <div
            class="row-text min-w-0 flex-1 py-px"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
            onContextMenu={(e) => {
              // The long press is ours; the browser's text selection menu would cover the rows.
              if (coarse() && focusField() === null) e.preventDefault();
            }}
          >
            <Show when={added()}>
              {(label) => (
                // At the right: when an Inbox item was added (if turned on in Settings).
                <span class="pointer-events-none float-right ml-3 flex items-center text-xs text-faint select-none" style={{ height: 'var(--row-lh)' }} data-testid="added-at">
                  {label()}
                </span>
              )}
            </Show>
            <Switch
              fallback={
                <div
                  class="node-content cursor-text wrap-break-word"
                  onMouseDown={onContentMouseDown}
                  innerHTML={renderInline(n().content) || '<br>'}
                />
              }
            >
              <Match when={focusField() === 'content'}>
                <NodeEditor id={props.id} class="node-content wrap-break-word" />
              </Match>
              <Match when={noteCollapsed()}>
                {/* A hidden note gets a mark right after the text, as in Dynalist. */}
                <div class="node-content cursor-text wrap-break-word" onMouseDown={onContentMouseDown}>
                  <span innerHTML={renderInline(n().content)} />
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    aria-label="Has a note"
                    role="img"
                    data-testid="note-marker"
                    class="ml-2 inline-block align-[-1px] text-faint select-none"
                  >
                    <path d="M2 3.5h12M2 8h12M2 12.5h7" />
                  </svg>
                </div>
              </Match>
            </Switch>
            {/* A note shows only while you're on its item, unless it is kept open (Dynalist's "hide notes"). */}
            <Show when={focusField() === 'note' || (n().note !== '' && !noteCollapsed())}>
              <NoteCard reveal={noteFolded() && n().note !== ''}>
                {/* The same caret while reading and editing, so nothing appears or moves on click. */}
                <Show when={n().note !== ''}>
                  <button
                    type="button"
                    tabindex={-1}
                    aria-label={noteFolded() ? 'Expand note' : 'Collapse note'}
                    aria-expanded={noteFolded() ? 'false' : 'true'}
                    data-testid="note-toggle"
                    class="note-toggle absolute -left-6 z-[1] flex h-5 w-5 items-center justify-center rounded-full text-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-muted"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => notePrefs.getState().toggleCollapsed(props.id)}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" class={noteFolded() ? '-rotate-90' : ''}>
                      <path d="M1.5 3.2 5 6.8l3.5-3.6z" />
                    </svg>
                  </button>
                </Show>
                <Show
                  when={focusField() === 'note'}
                  fallback={
                    <>
                      <NoteHeader id={props.id} quiet />
                      <div
                        class="node-note prose-note row-note cursor-text pb-0.5 text-note"
                        onMouseDown={onNoteMouseDown}
                        onClick={onNoteClick}
                        innerHTML={renderBlock(n().note)}
                      />
                    </>
                  }
                >
                  <NoteEditor id={props.id} />
                </Show>
              </NoteCard>
            </Show>
          </div>
          <Show when={hasChildren() && coarse()}>
            <CollapseToggle side="right" collapsed={collapsed()} onToggle={toggle} />
          </Show>
        </div>
      )}
    </Show>
  );
}

/** The note under an item's text. A hidden note slides open when you get on its item. */
function NoteCard(props: { reveal: boolean; children?: JSX.Element }) {
  // Decided once, from the first value: hiding or showing the note from its ▾ while on it doesn't replay the slide.
  let first: boolean | undefined;
  const slide = createMemo(() => (first ??= props.reveal));
  return <div class={['note-card relative flow-root', { 'note-reveal': slide() }]}>{props.children}</div>;
}
