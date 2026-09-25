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

export interface UiState {
  focus: Focus | null;
  selection: Selection | null;
  dropIndicator: DropIndicator | null;
  /** Id of the node being dragged, if any. */
  dragging: string | null;
  focusNode(id: string, caret?: Caret, field?: Field): void;
  blur(): void;
  setSelection(selection: Selection | null): void;
  setDropIndicator(indicator: DropIndicator | null): void;
  setDragging(id: string | null): void;
}

/** The store plus its actions as direct methods, for non-React callers. */
export interface UiStore extends StoreApi<UiState> {
  focusNode(id: string, caret?: Caret, field?: Field): void;
  blur(): void;
  setSelection(selection: Selection | null): void;
  setDropIndicator(indicator: DropIndicator | null): void;
  setDragging(id: string | null): void;
}

export function createUiStore(): UiStore {
  const store = createStore<UiState>((set, get) => ({
    focus: null,
    selection: null,
    dropIndicator: null,
    dragging: null,
    focusNode: (id, caret = { kind: 'end' }, field = 'content') => set({ focus: { id, field, caret }, selection: null }),
    blur: () => set({ focus: null }),
    setSelection: (selection) => set({ selection }),
    setDropIndicator: (indicator) => {
      const cur = get().dropIndicator;
      if (cur === indicator) return;
      if (cur && indicator && cur.targetId === indicator.targetId && cur.edge === indicator.edge && cur.level === indicator.level) return;
      set({ dropIndicator: indicator });
    },
    setDragging: (dragging) => set({ dragging }),
  }));
  return Object.assign(store, {
    focusNode: (id: string, caret?: Caret, field?: Field) => store.getState().focusNode(id, caret, field),
    blur: () => store.getState().blur(),
    setSelection: (selection: Selection | null) => store.getState().setSelection(selection),
    setDropIndicator: (indicator: DropIndicator | null) => store.getState().setDropIndicator(indicator),
    setDragging: (id: string | null) => store.getState().setDragging(id),
  });
}

export function useUiStore<T>(store: UiStore, selector: (s: UiState) => T): T {
  return useStore(store, selector);
}
