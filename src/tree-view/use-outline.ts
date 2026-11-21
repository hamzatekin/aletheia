import { createMemo, type Accessor } from 'solid-js';
import { ancestorIds, visibleRows, type Node, type VisibleRow } from '@/model';
import { useEngine } from '@/app/engine-context';
import { pageRows, type FilteredRow } from '@/search/filter';
import { useTreeStore } from '@/store/tree-store';
import { useSettings } from '@/store/settings-store';
import { useUiStore } from '@/store/ui-store';
import { useOutline } from './outline-context';

/*
 * Reads of the tree for components. Each takes the id as an accessor
 * (`useNode(() => props.id)`) and returns an accessor to read in JSX, a memo
 * or an effect.
 */

/** Whether done rows are hidden (Settings → Show completed off). */
function useHideCompleted(): Accessor<boolean> {
  const { settings } = useOutline();
  return useSettings(settings, (s) => !s.showCompleted);
}

/** Visible rows under `rootId`, recomputed only when the structure changes. */
export function useVisibleRows(rootId: Accessor<string | null>): Accessor<VisibleRow[]> {
  const engine = useEngine();
  const structureVersion = useTreeStore(engine.store, (s) => s.structureVersion);
  const hide = useHideCompleted();
  return createMemo(() => {
    structureVersion();
    return visibleRows(engine.tree, rootId(), hide());
  });
}

/** The rows the page shows: filtered while an in-place search is on. */
export function usePageRows(rootId: Accessor<string | null>): Accessor<FilteredRow[]> {
  const engine = useEngine();
  const { ui } = useOutline();
  const structureVersion = useTreeStore(engine.store, (s) => s.structureVersion);
  const filter = useUiStore(ui, (s) => s.filter);
  const hide = useHideCompleted();
  return createMemo(() => {
    structureVersion();
    return pageRows(engine.tree, rootId(), filter(), hide());
  });
}

/** Whether a phone's editing or selection bar is up: the floating + and mic hide then. */
export function useBottomBarUp(): Accessor<boolean> {
  const { ui } = useOutline();
  return useUiStore(ui, (s) => s.focus !== null || (s.selection?.ids.size ?? 0) > 0);
}

/** The node as stored; a new object after each change to it. */
export function useNode(id: Accessor<string | null>): Accessor<Node | undefined> {
  const engine = useEngine();
  return useTreeStore(engine.store, (s) => {
    const i = id();
    return i === null ? undefined : s.nodes.get(i);
  });
}

export function useHasChildren(id: Accessor<string>): Accessor<boolean> {
  const engine = useEngine();
  return useTreeStore(engine.store, (s) => (s.childrenByParent.get(id())?.length ?? 0) > 0);
}

/** Ancestor chain of `id` from the top level down, as nodes. */
export function useAncestors(id: Accessor<string | null>): Accessor<Node[]> {
  const engine = useEngine();
  const version = useTreeStore(engine.store, (s) => s.version);
  return createMemo(
    () => {
      version();
      const i = id();
      if (i === null) return [];
      return ancestorIds(engine.tree, i)
        .reverse()
        .map((a) => engine.tree.get(a))
        .filter((n): n is Node => n !== undefined);
    },
    // The same while no ancestor changed (nodes are new objects only when they change), so saves elsewhere don't count.
    { equals: (a, b) => a.length === b.length && a.every((n, i) => n === b[i]) },
  );
}
