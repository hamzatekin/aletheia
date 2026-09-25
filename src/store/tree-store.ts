import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { parentKey, type Node, type NodeChange, type TreeReader } from '@/model';

/**
 * Normalized tree state.
 *
 * The maps are mutated in place (copying a 10k-entry map per keystroke is not
 * "instant"), but every `Node` object and every children array is replaced
 * immutably, and `version` bumps on each change. Selectors such as
 * `s.nodes.get(id)` therefore return stable references and components
 * re-render only when the node they read actually changed.
 */
export interface TreeState {
  /** Every node, including soft-deleted ones (needed for restore/undo). */
  readonly nodes: ReadonlyMap<string, Node>;
  /** Live children per parent key (`ROOT` for top level), in sibling order. */
  readonly childrenByParent: ReadonlyMap<string, readonly string[]>;
  /** Increments on every change; subscribe to this for "anything changed". */
  readonly version: number;
  /** Replace the whole tree (initial load). */
  load(nodes: Iterable<Node>): void;
  /** Apply a batch of node changes atomically. */
  applyChanges(changes: readonly NodeChange[]): void;
}

const EMPTY: readonly string[] = Object.freeze([]);

function insertSorted(list: readonly string[], id: string, nodes: ReadonlyMap<string, Node>): string[] {
  const order = nodes.get(id)!.order;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (nodes.get(list[mid]!)!.order < order) lo = mid + 1;
    else hi = mid;
  }
  const out = list.slice();
  out.splice(lo, 0, id);
  return out;
}

function buildIndex(nodes: ReadonlyMap<string, Node>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const node of nodes.values()) {
    if (node.deletedAt !== null) continue;
    const key = parentKey(node.parentId);
    let list = index.get(key);
    if (!list) index.set(key, (list = []));
    list.push(node.id);
  }
  for (const list of index.values()) {
    list.sort((a, b) => {
      const oa = nodes.get(a)!.order;
      const ob = nodes.get(b)!.order;
      return oa < ob ? -1 : oa > ob ? 1 : 0;
    });
  }
  return index;
}

export type TreeStore = StoreApi<TreeState>;

export function createTreeStore(): TreeStore {
  return createStore<TreeState>((set, get) => ({
    nodes: new Map(),
    childrenByParent: new Map(),
    version: 0,

    load(iter) {
      const nodes = new Map<string, Node>();
      for (const n of iter) nodes.set(n.id, n);
      set({ nodes, childrenByParent: buildIndex(nodes), version: get().version + 1 });
    },

    applyChanges(changes) {
      if (changes.length === 0) return;
      const nodes = get().nodes as Map<string, Node>;
      const index = get().childrenByParent as Map<string, readonly string[]>;
      const touched = new Set<string>();

      // Pass 1: detach every changed node from its old parent list.
      for (const { id, before } of changes) {
        if (before && before.deletedAt === null) {
          const key = parentKey(before.parentId);
          touched.add(key);
          index.set(key, (index.get(key) ?? EMPTY).filter((x) => x !== id));
        }
      }
      // Pass 2: write new versions.
      for (const { id, after } of changes) {
        if (after) nodes.set(id, after);
        else nodes.delete(id);
      }
      // Pass 3: attach live nodes to their new parent list.
      for (const { id, after } of changes) {
        if (after && after.deletedAt === null) {
          const key = parentKey(after.parentId);
          touched.add(key);
          index.set(key, insertSorted(index.get(key) ?? EMPTY, id, nodes));
        }
      }
      for (const key of touched) {
        if (index.get(key)?.length === 0) index.delete(key);
      }
      set({ version: get().version + 1 });
    },
  }));
}

/** A `TreeReader` over the store's current state. Cheap; reads live. */
export function readerOf(store: TreeStore): TreeReader {
  return {
    get: (id) => store.getState().nodes.get(id),
    children: (parentId) => store.getState().childrenByParent.get(parentKey(parentId)) ?? EMPTY,
    all: () => store.getState().nodes.values(),
  };
}

export function useTreeStore<T>(store: TreeStore, selector: (s: TreeState) => T): T {
  return useStore(store, selector);
}
