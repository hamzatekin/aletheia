import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';

/** Where the caret should land when a node receives focus. */
export type Caret =
  | { kind: 'start' }
  | { kind: 'end' }
  /** Offset into the node's Markdown content (from command focus hints). */
  | { kind: 'offset'; offset: number }
  /** Keep the horizontal position when moving between nodes with Up/Down. */
  | { kind: 'line'; line: 'first' | 'last'; x: number }
  /** A mouse click at viewport coordinates. */
  | { kind: 'point'; x: number; y: number };

export type Field = 'content' | 'note';

export interface Focus {
  id: string;
  field: Field;
  caret: Caret;
}

/** Tree-level selection after Esc: a contiguous range of visible rows. */
export interface Selection {
  anchor: string;
  head: string;
  ids: ReadonlySet<string>;
}

/** Where a dragged node would land, drawn as a line on the target row. */
export interface DropIndicator {
  targetId: string;
  /** Vertical placement relative to the target row. */
  edge: 'above' | 'below';
  /** Depth (relative to the zoom root) the dropped node would get. */
  level: number;
}

/** The slash menu, open since a "/" was typed at document position `from`. */
export interface SlashState {
  from: number;
  query: string;
  index: number;
}

export interface UiState {
  focus: Focus | null;
  selection: Selection | null;
  slash: SlashState | null;
  searchOpen: boolean;
  helpOpen: boolean;
  dropIndicator: DropIndicator | null;
  /** Id of the node being dragged, if any. */
  dragging: string | null;
  /** Id of the node whose grip menu is open, if any. */
  menu: string | null;
  focusNode(id: string, caret?: Caret, field?: Field): void;
  blur(): void;
  setSelection(selection: Selection | null): void;
  setDropIndicator(indicator: DropIndicator | null): void;
  setDragging(id: string | null): void;
  setSlash(slash: SlashState | null): void;
  setSearchOpen(open: boolean): void;
  setHelpOpen(open: boolean): void;
  setMenu(id: string | null): void;
}

/** The store plus its actions as direct methods, for non-React callers. */
export interface UiStore extends StoreApi<UiState> {
  focusNode(id: string, caret?: Caret, field?: Field): void;
  blur(): void;
  setSelection(selection: Selection | null): void;
  setDropIndicator(indicator: DropIndicator | null): void;
  setDragging(id: string | null): void;
  setSlash(slash: SlashState | null): void;
  setSearchOpen(open: boolean): void;
  setHelpOpen(open: boolean): void;
  setMenu(id: string | null): void;
}

export function createUiStore(): UiStore {
  const store = createStore<UiState>((set, get) => ({
    focus: null,
    selection: null,
    slash: null,
    searchOpen: false,
    helpOpen: false,
    dropIndicator: null,
    dragging: null,
    menu: null,
    focusNode: (id, caret = { kind: 'end' }, field = 'content') => set({ focus: { id, field, caret }, selection: null, slash: null }),
    blur: () => set({ focus: null, slash: null }),
    setSelection: (selection) => set({ selection }),
    setDropIndicator: (indicator) => {
      const cur = get().dropIndicator;
      if (cur === indicator) return;
      if (cur && indicator && cur.targetId === indicator.targetId && cur.edge === indicator.edge && cur.level === indicator.level) return;
      set({ dropIndicator: indicator });
    },
    setDragging: (dragging) => set({ dragging }),
    setSlash: (slash) => set({ slash }),
    setSearchOpen: (searchOpen) => set({ searchOpen }),
    setHelpOpen: (helpOpen) => set({ helpOpen }),
    setMenu: (menu) => set({ menu }),
  }));
  return Object.assign(store, {
    focusNode: (id: string, caret?: Caret, field?: Field) => store.getState().focusNode(id, caret, field),
    blur: () => store.getState().blur(),
    setSelection: (selection: Selection | null) => store.getState().setSelection(selection),
    setDropIndicator: (indicator: DropIndicator | null) => store.getState().setDropIndicator(indicator),
    setDragging: (id: string | null) => store.getState().setDragging(id),
    setSlash: (slash: SlashState | null) => store.getState().setSlash(slash),
    setSearchOpen: (open: boolean) => store.getState().setSearchOpen(open),
    setHelpOpen: (open: boolean) => store.getState().setHelpOpen(open),
    setMenu: (id: string | null) => store.getState().setMenu(id),
  });
}

export function useUiStore<T>(store: UiStore, selector: (s: UiState) => T): T {
  return useStore(store, selector);
}
