import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { wasTraversal } from '@/app/routing';
import { createWindowVirtualizer, defaultRangeExtractor, type Range } from '@/ui/virtual';
import type { FilteredRow } from '@/search/filter';
import { useUiStore } from '@/store/ui-store';
import { Row } from './Row';
import { useOutline } from './outline-context';
import { useNode, usePageRows } from './use-outline';
import { useDropMonitor } from './use-dnd';
import { TOP_BAR_CLEARANCE_PX } from './TopBar';

interface Props {
  rootId: string | null;
}

/** The virtualized list of visible rows under the zoom root. */
export function Outline(props: Props) {
  const { ui, actions } = useOutline();
  const rows = usePageRows(() => props.rootId);
  const filtering = useUiStore(ui, (s) => s.filter !== null && s.filter.query.trim() !== '');
  // Typing the page's own title or note (as right after a quick add): no "start writing" hint under it.
  const editingPage = useUiStore(ui, (s) => props.rootId !== null && s.focus?.id === props.rootId);
  // A page with a title or a note already says what it is: the hint would only be clutter.
  const root = useNode(() => props.rootId);
  const quiet = () => {
    const r = root();
    return r !== undefined && (r.content.trim() !== '' || r.note.trim() !== '');
  };
  let listEl: HTMLDivElement | undefined;
  // The list element exists only while there are rows. Bumped once it is in the page, so the options below read its
  // position at once; they read it again on every scroll, resize and measure (the title or note above may have grown).
  const [listMounted, setListMounted] = createSignal(0);
  useDropMonitor();

  // Keep the focused (or selection-head) row mounted even when scrolled away.
  const pinnedId = useUiStore(ui, (s) => s.focus?.id ?? s.selection?.head ?? null);
  // Rows are separate stacking contexts (transform), so the row showing a
  // popup (slash menu under the editor, grip menu) must sit above the rest.
  const raisedId = useUiStore(ui, (s) => s.menu ?? s.focus?.id ?? null);
  const pinned = createMemo(() => {
    const id = pinnedId();
    return id === null ? -1 : rows().findIndex((r) => r.id === id);
  });
  // Rows by id: an item's row is found by its key, so the two never disagree for a moment while one lags the other.
  // A row keeps its object while it shows the same: effects never compare, so a new one would re-run every row's
  // effects (drag and drop, the editor) on any change to the page.
  const rowById = createMemo<Map<string, FilteredRow>>((prev) => {
    const next = new Map<string, FilteredRow>();
    for (const r of rows()) {
      const old = prev?.get(r.id);
      next.set(r.id, old && old.depth === r.depth && old.open === r.open && old.match === r.match ? old : r);
    }
    return next;
  });

  /** Distance from the top of the document; the page sheet is positioned, so offsetTop alone is not enough. */
  const scrollMargin = () => (listEl?.isConnected ? listEl.getBoundingClientRect().top + window.scrollY : 0);

  const virtualizer = createWindowVirtualizer(() => {
    listMounted();
    const list = rows();
    const pin = pinned();
    return {
      count: list.length,
      estimateSize: () => 26,
      overscan: 12,
      scrollMargin: scrollMargin(),
      // Rows scrolled into view stop below the solid bar at the top.
      scrollPaddingStart: TOP_BAR_CLEARANCE_PX,
      getItemKey: (index: number) => list[index]!.id,
      rangeExtractor: (range: Range) => {
        const indexes = defaultRangeExtractor(range);
        if (pin >= 0 && !indexes.includes(pin)) indexes.push(pin);
        return indexes;
      },
    };
  });

  // A new page starts at its top. Going up a level (breadcrumbs, the back arrow)
  // keeps the row you came out of in view instead, as WorkFlowy does. Back and
  // forward leave the scroll to @solidjs/router, which restores it (it sets
  // history.scrollRestoration to manual); a focused row scrolls itself.
  // Runs for the first page too, and only when the page changes (the compute
  // also follows the rows, so the apply skips the runs where the page is the same).
  const location = useLocation<{ from?: string } | null>();
  let scrolledFor: string | null | undefined;
  createEffect(
    () => ({ rootId: props.rootId, list: rows(), from: location.state?.from, instance: virtualizer.instance }),
    ({ rootId, list, from, instance }) => {
      if (rootId === scrolledFor) return;
      scrolledFor = rootId;
      if (wasTraversal() || ui.getState().focus) return;
      const index = from ? list.findIndex((r) => r.id === from) : -1;
      if (index >= 0) {
        // The list may have moved since the options were last set (the title above it changed).
        instance.setOptions({ ...instance.options, scrollMargin: scrollMargin() });
        instance.scrollToIndex(index, { align: 'center' });
      } else window.scrollTo(0, 0);
    },
  );

  // Bring a keyboard-selected row into view.
  const selectionHead = useUiStore(ui, (s) => s.selection?.head ?? null);
  let scrolledToHead: string | null = null;
  createEffect(
    () => ({ head: selectionHead(), list: rows(), instance: virtualizer.instance }),
    ({ head, list, instance }) => {
      if (head === scrolledToHead) return;
      scrolledToHead = head;
      if (head === null) return;
      const index = list.findIndex((r) => r.id === head);
      if (index >= 0) instance.scrollToIndex(index, { align: 'auto' });
    },
  );

  return (
    <Switch>
      <Match when={rows().length === 0 && filtering()}>
        <div class="py-px text-faint" data-testid="no-matches">
          Nothing here matches.
        </div>
      </Match>
      <Match when={rows().length === 0 && editingPage()}>{null}</Match>
      <Match when={rows().length === 0}>
        <div
          class="row-text cursor-text py-px text-faint"
          data-testid="empty-outline"
          onMouseDown={(e) => {
            e.preventDefault();
            actions.createFirst();
          }}
        >
          {/* Without the words, the line stays: clicking under the title still starts the first item. */}
          {quiet() ? <br /> : 'Click here or press Enter to start writing.'}
        </div>
      </Match>
      <Match when={rows().length > 0}>
        <div
          ref={(el) => {
            listEl = el;
            // Refs run before the element is in the page: tell the options once it is.
            queueMicrotask(() => setListMounted((n) => n + 1));
          }}
          class="relative"
          style={{ height: `${virtualizer.totalSize()}px` }}
          data-testid="outline"
          data-row-count={rows().length}
        >
          <For each={virtualizer.items()} keyed={(item) => item.key}>
            {(item) => (
              <div
                data-index={item().index}
                ref={virtualizer.measure}
                class={'absolute top-0 left-0 w-full' + (item().key === raisedId() ? ' z-10' : '')}
                style={{ transform: `translateY(${item().start - virtualizer.instance.options.scrollMargin}px)` }}
              >
                <Show when={rowById().get(item().key as string)}>
                  {(row) => <Row id={row().id} depth={row().depth} filterOpen={row().open} match={row().match} />}
                </Show>
              </div>
            )}
          </For>
        </div>
      </Match>
    </Switch>
  );
}
