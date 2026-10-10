import { ancestorIds } from '@/model';
import { toggleFilterRow as toggledFilter } from '@/search/filter';
import type { ActionContext } from './context';

/** The in-place search (Ctrl/⌘+F) that filters the page. */
export function filterActions(ctx: ActionContext) {
  const { ui, session, rootId, tree, expandCollapsed } = ctx;

  const openFilter = () => {
    session.flush();
    ui.blur();
    ui.setSelection(null);
    if (!ui.getState().filter) ui.setFilter({ query: '', keep: new Set(), open: new Map() });
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="filter-input"]');
      input?.focus();
      input?.select();
    });
  };

  const closeFilter = () => {
    if (!ui.getState().filter) return;
    const { focus } = ui.getState();
    ui.setFilter(null);
    // The edited row may now sit under a collapsed parent: open the way to it, as the search did.
    if (focus && focus.id !== rootId) {
      const chain = ancestorIds(tree, focus.id);
      expandCollapsed(rootId === null ? chain : chain.slice(0, Math.max(0, chain.indexOf(rootId))));
    }
  };

  const toggleFilterRow = (id: string) => {
    const filter = ui.getState().filter;
    if (filter) ui.setFilter(toggledFilter(tree, rootId, filter, id));
  };

  return { openFilter, closeFilter, toggleFilterRow };
}

export type FilterActions = ReturnType<typeof filterActions>;
