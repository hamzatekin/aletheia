import { useCallback, useEffect, useRef } from 'react';
import { defaultRangeExtractor, useWindowVirtualizer, type Range } from '@tanstack/react-virtual';
import { useUiStore } from '@/store/ui-store';
import { Row } from './Row';
import { useOutline } from './outline-context';
import { useVisibleRows } from './use-outline';
import { useDropMonitor } from './use-dnd';

interface Props {
  rootId: string | null;
}

/** The virtualized list of visible rows under the zoom root. */
export function Outline({ rootId }: Props) {
  const { ui, actions } = useOutline();
  const rows = useVisibleRows(rootId);
  const listRef = useRef<HTMLDivElement>(null);
  useDropMonitor();

  // Keep the focused (or selection-head) row mounted even when scrolled away.
  const pinnedId = useUiStore(ui, (s) => s.focus?.id ?? s.selection?.head ?? null);
  const pinned = pinnedId === null ? -1 : rows.findIndex((r) => r.id === pinnedId);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (pinned >= 0 && !indexes.includes(pinned)) indexes.push(pinned);
      return indexes;
    },
    [pinned],
  );

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 26,
    overscan: 12,
    scrollMargin: listRef.current?.offsetTop ?? 0,
    getItemKey: (index) => rows[index]!.id,
    rangeExtractor,
  });

  // Bring a keyboard-selected row into view.
  const selectionHead = useUiStore(ui, (s) => s.selection?.head ?? null);
  useEffect(() => {
    if (selectionHead === null) return;
    const index = rows.findIndex((r) => r.id === selectionHead);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the head changes
  }, [selectionHead]);

  if (rows.length === 0) {
    return (
      <div
        className="row-text cursor-text py-px text-neutral-400 dark:text-neutral-500"
        data-testid="empty-outline"
        onMouseDown={(e) => {
          e.preventDefault();
          actions.createFirst();
        }}
      >
        Click here or press Enter to start writing.
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
      data-testid="outline"
      data-row-count={rows.length}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index]!;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
          >
            <Row id={row.id} depth={row.depth} />
          </div>
        );
      })}
    </div>
  );
}
