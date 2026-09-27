import type { Engine, Outcome } from '@/commands';
import type { EditorSession } from '@/editor/session';
import type { TreeReader } from '@/model';
import type { SearchIndex } from '@/search';
import { pageRows, type FilteredRow } from '@/search/filter';
import type { Caret, UiStore } from '@/store/ui-store';
import type { NavigateFunction } from 'react-router';

export interface ActionDeps {
  engine: Engine;
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
  /** The zoomed-in node (null: the top level). */
  rootId: string | null;
  navigate: NavigateFunction;
}

/** What every group of outline actions shares: the dependencies plus row helpers. */
export interface ActionContext extends ActionDeps {
  tree: TreeReader;
  /** The rows on screen, in order: filtered while a search is on. */
  rowsNow(): FilteredRow[];
  previousVisible(id: string): string | null;
  nextVisible(id: string): string | null;
  /** The row above, or the page title from the first row. */
  prevOf(id: string): string | null;
  /** The row below; from the page title, the first row. */
  nextOf(id: string): string | null;
  /** Focus the node an outcome asks for. Always returns true (the key was handled). */
  applyFocus(outcome: Outcome | null, fallback?: Caret): boolean;
  /** Select the rows from `anchor` to `head`, as they are on screen. */
  selectRange(anchor: string, head: string): void;
}

export function createActionContext(deps: ActionDeps): ActionContext {
  const { engine, ui, rootId } = deps;
  const tree: TreeReader = engine.tree;

  const rowsNow = () => pageRows(tree, rootId, ui.getState().filter);
  const previousVisible = (id: string): string | null => {
    const rows = rowsNow();
    const i = rows.findIndex((r) => r.id === id);
    return i > 0 ? rows[i - 1]!.id : null;
  };
  const nextVisible = (id: string): string | null => {
    const rows = rowsNow();
    const i = rows.findIndex((r) => r.id === id);
    return i >= 0 && i < rows.length - 1 ? rows[i + 1]!.id : null;
  };

  return {
    ...deps,
    tree,
    rowsNow,
    previousVisible,
    nextVisible,
    prevOf: (id) => previousVisible(id) ?? rootId,
    nextOf: (id) => (id === rootId ? (rowsNow()[0]?.id ?? null) : nextVisible(id)),
    applyFocus(outcome, fallback) {
      if (outcome?.ok && outcome.focus) {
        ui.focusNode(outcome.focus.id, fallback ?? { kind: 'offset', offset: outcome.focus.offset });
      }
      return true;
    },
    selectRange(anchor, head) {
      const rows = rowsNow().map((r) => r.id);
      const a = rows.indexOf(anchor);
      const h = rows.indexOf(head);
      if (a < 0 || h < 0) return ui.setSelection(null);
      const ids = new Set(rows.slice(Math.min(a, h), Math.max(a, h) + 1));
      ui.setSelection({ anchor, head, ids });
    },
  };
}
