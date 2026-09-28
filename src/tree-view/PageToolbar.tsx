import { useMemo } from 'react';
import { hasOpenParent } from '@/commands';
import { isFiltering } from '@/search/filter';
import { useUiStore } from '@/store/ui-store';
import { useOutline } from './outline-context';
import { useVisibleRows } from './use-outline';

/** The buttons at the top right: collapse / expand all, search this page, tutorial. */
export function PageToolbar() {
  const { engine, ui, session, actions, rootId } = useOutline();

  // Visible rows change whenever a parent opens or closes, so this follows every toggle.
  const pageRows = useVisibleRows(rootId);
  const anyOpen = useMemo(() => hasOpenParent(engine.tree, rootId), [engine, rootId, pageRows]); // eslint-disable-line react-hooks/exhaustive-deps
  const anyParent = pageRows.some((r) => engine.tree.children(r.id).length > 0);

  const filtering = useUiStore(ui, (s) => isFiltering(s.filter));
  const filterOn = useUiStore(ui, (s) => s.filter !== null);

  return (
    <>
      <button
        type="button"
        onClick={() => actions.toggleAll()}
        onMouseDown={(e) => e.preventDefault()}
        disabled={!anyParent || filtering}
        className="top-icon fixed top-3 right-33 z-40 flex size-[34px] items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink disabled:opacity-40"
        aria-label={anyOpen ? 'Collapse all' : 'Expand all'}
        title={(anyOpen ? 'Collapse all' : 'Expand all') + ' (Ctrl+Shift+.)'}
        data-testid="toggle-all"
        data-state={anyOpen ? 'open' : 'collapsed'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {anyOpen ? <path d="m7 20 5-5 5 5M7 4l5 5 5-5" /> : <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />}
        </svg>
      </button>
      <button
        type="button"
        onClick={() => (ui.getState().filter ? actions.closeFilter() : actions.openFilter())}
        onMouseDown={(e) => e.preventDefault()}
        className="top-icon fixed top-3 right-23 z-40 flex size-[34px] items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
        aria-label="Search"
        aria-pressed={filterOn}
        title="Search this page (Ctrl+F). Ctrl+K jumps anywhere."
        data-testid="filter-button"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => {
          session.flush();
          ui.blur();
          ui.setHelpOpen(true);
        }}
        className="top-icon fixed top-3 right-13 z-40 flex size-[34px] items-center justify-center rounded-md text-[15px] font-semibold text-muted hover:bg-hover hover:text-ink"
        aria-label="Tutorial"
        title="Tutorial (Ctrl+/)"
      >
        ?
      </button>
    </>
  );
}
