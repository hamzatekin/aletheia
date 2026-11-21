import { createMemo, createSignal, runWithOwner, type Accessor } from 'solid-js';
import type { StoreApi } from 'zustand/vanilla';

/**
 * The stores are plain zustand stores (actions, sync and tests read them
 * outside any component); components read them through these accessors.
 */

const mirrors = new WeakMap<object, Accessor<unknown>>();

/** One signal per store holding its whole state, set on every change. */
function mirror<S>(store: StoreApi<S>): Accessor<S> {
  let state = mirrors.get(store) as Accessor<S> | undefined;
  if (!state) {
    // Not owned by the component that asked first: the mirror outlives it.
    // A store can change while Solid is running a component or effect (an action called from one), hence ownedWrite.
    const [read, write] = runWithOwner(null, () => createSignal<S>(store.getState() as Exclude<S, Function>, { equals: false, ownedWrite: true }));
    store.subscribe((s) => write(() => s));
    mirrors.set(store, read);
    state = read;
  }
  return state;
}

/**
 * A slice of a zustand store as an accessor, like zustand's `useStore` in
 * React: it changes only when the selected value does (`===`). Call it in a
 * component body (or another owner) and read the accessor in JSX, a memo or
 * an effect.
 */
export function useStoreValue<S>(store: StoreApi<S>): Accessor<S>;
export function useStoreValue<S, T>(store: StoreApi<S>, selector: (s: S) => T): Accessor<T>;
export function useStoreValue<S, T>(store: StoreApi<S>, selector?: (s: S) => T): Accessor<S | T> {
  const state = mirror(store);
  if (!selector) return state;
  return createMemo(() => selector(state()));
}

/**
 * Makes the memo or effect running now re-run when `store` changes. For
 * values a service reads with `getState()` (the sync key behind
 * `ai.available()`): the read stays exact, and the UI showing it follows.
 */
export function dependOn(store: StoreApi<unknown>): void {
  mirror(store)();
}
