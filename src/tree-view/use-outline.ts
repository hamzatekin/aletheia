import { useMemo } from 'react';
import { ancestorIds, visibleRows, type Node, type VisibleRow } from '@/model';
import { useEngine } from '@/app/engine-context';
import { useTreeStore } from '@/store/tree-store';

/** Visible rows under `rootId`, recomputed only when the structure changes. */
export function useVisibleRows(rootId: string | null): VisibleRow[] {
  const engine = useEngine();
  const structureVersion = useTreeStore(engine.store, (s) => s.structureVersion);
  return useMemo(() => visibleRows(engine.tree, rootId), [engine, rootId, structureVersion]);
}

export function useNode(id: string | null): Node | undefined {
  const engine = useEngine();
  return useTreeStore(engine.store, (s) => (id === null ? undefined : s.nodes.get(id)));
}

export function useHasChildren(id: string): boolean {
  const engine = useEngine();
  return useTreeStore(engine.store, (s) => (s.childrenByParent.get(id)?.length ?? 0) > 0);
}

/** Ancestor chain of `id` from the top level down, as nodes. */
export function useAncestors(id: string | null): Node[] {
  const engine = useEngine();
  const structureVersion = useTreeStore(engine.store, (s) => s.structureVersion);
  const version = useTreeStore(engine.store, (s) => s.version);
  return useMemo(() => {
    if (id === null) return [];
    return ancestorIds(engine.tree, id)
      .reverse()
      .map((a) => engine.tree.get(a))
      .filter((n): n is Node => n !== undefined);
  }, [engine, id, structureVersion, version]);
}
