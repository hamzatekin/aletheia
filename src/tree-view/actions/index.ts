import type { OutlineKey } from '@/editor/outliner-keymap';
import type { Caret } from '@/store/ui-store';
import { createActionContext, type ActionDeps } from './context';
import { editorKeyHandler } from './editor-keys';
import { filterActions } from './filter';
import { navigationActions } from './navigation';
import { pageKeyHandler } from './page-keys';
import { pasteActions } from './paste';
import { selectionActions, type SelectionAction } from './selection';
import { slashActions } from './slash';

export type { SelectionAction };

/**
 * Everything the outline page can do, bound to one zoom root. Built once per
 * page (see OutlinePage) and handed to rows through the outline context.
 * Each group lives in its own file here; this only puts them together.
 */
export interface OutlineActions {
  /** Structural keys coming from the editor keymap. */
  handleKey(key: OutlineKey): boolean;
  /** Keys pressed while nothing is being edited (tree-level selection). Returns true if handled. */
  handleGlobalKey(e: KeyboardEvent): boolean;
  focusPrev(id: string, caret: Caret): void;
  focusNext(id: string, caret: Caret): void;
  createFirst(): void;
  undo(): void;
  redo(): void;
  zoomOut(): void;
  /** Collapse or expand every parent under `underId` (null: the whole page), with `underId` itself if asked. */
  setAllCollapsed(underId: string | null, collapsed: boolean, includeSelf?: boolean): void;
  /** Collapse everything on the page if anything is open, else expand everything. */
  toggleAll(): void;
  /** Show the in-place search bar and put the caret in it. */
  openFilter(): void;
  /** Leave the in-place search: the page shows everything again. */
  closeFilter(): void;
  /** While searching in place: open or close a row's children for this search only. */
  toggleFilterRow(id: string): void;
  /** Zoom to the node's parent and focus it (search results, links). */
  revealNode(id: string): void;
  /** Run the i-th command of the open slash menu. */
  runSlash(index: number): void;
  /** Keep the slash query in sync with the editor; called after each transaction. */
  syncSlash(): void;
  /** Multi-line paste: one node per line, nested by indentation. Copied nodes come back whole. */
  pasteLines(text: string, json?: string | null): boolean;
  /** Select just this node (Esc, the menu's Select, a long press on a phone). */
  selectNode(id: string): void;
  /** Shift+click: select from the edited node or the selection's anchor to this one. */
  selectTo(id: string): void;
  /** Ctrl/Cmd+click, or a tap while selecting on a phone: add or remove one node. */
  toggleSelected(id: string): void;
  /** Dragging across rows: the rows from `anchor` to `head`. */
  selectRange(anchor: string, head: string): void;
  /** Act on the selected nodes (keyboard, and the phone's selection bar). */
  selectionAction(action: SelectionAction): void;
  /** Copy (or cut) the selection into a clipboard event. Returns false when nothing is selected. */
  copySelection(data: DataTransfer | null, cut?: boolean): boolean;
  /** Paste below the selection. Returns false when nothing is selected. */
  pasteIntoSelection(text: string, json?: string | null): boolean;
}

export function createOutlineActions(deps: ActionDeps): OutlineActions {
  const ctx = createActionContext(deps);
  const navigation = navigationActions(ctx);
  const filter = filterActions(ctx);
  const slash = slashActions(ctx);
  const selection = selectionActions(ctx);
  const { pasteLines } = pasteActions(ctx);

  return {
    handleKey: editorKeyHandler(ctx, { ...navigation, ...filter, ...slash }),
    handleGlobalKey: pageKeyHandler(ctx, { ...navigation, ...filter, ...selection }),
    focusPrev: navigation.focusPrev,
    focusNext: navigation.focusNext,
    createFirst: navigation.createFirst,
    setAllCollapsed: navigation.setAllCollapsed,
    toggleAll: navigation.toggleAll,
    zoomOut: navigation.zoomOut,
    revealNode: navigation.revealNode,
    undo: () => navigation.undoRedo('undo'),
    redo: () => navigation.undoRedo('redo'),
    openFilter: filter.openFilter,
    closeFilter: filter.closeFilter,
    toggleFilterRow: filter.toggleFilterRow,
    runSlash: slash.runSlash,
    syncSlash: slash.syncSlash,
    pasteLines,
    selectNode: selection.selectNode,
    selectTo: selection.selectTo,
    toggleSelected: selection.toggleSelected,
    selectRange: (anchor, head) => {
      deps.session.flush();
      deps.ui.blur();
      ctx.selectRange(anchor, head);
    },
    selectionAction: selection.selectionAction,
    copySelection: selection.copySelection,
    pasteIntoSelection: selection.pasteIntoSelection,
  };
}
