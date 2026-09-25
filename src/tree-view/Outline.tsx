import { useRef } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Row } from './Row';
import { useVisibleRows } from './use-outline';

interface Props {
  rootId: string | null;
}

/** The virtualized list of visible rows under the zoom root. */
export function Outline({ rootId }: Props) {
  const rows = useVisibleRows(rootId);
  const listRef = useRef<HTMLDivElement>(null);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 28,
    overscan: 12,
    scrollMargin: listRef.current?.offsetTop ?? 0,
    getItemKey: (index) => rows[index]!.id,
  });

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
