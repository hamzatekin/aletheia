import { createEffect, createMemo, createSignal, onSettled, type Accessor } from 'solid-js';
import {
  observeWindowOffset,
  observeWindowRect,
  Virtualizer,
  windowScroll,
  type PartialKeys,
  type VirtualItem,
  type VirtualizerOptions,
} from '@tanstack/virtual-core';

export { defaultRangeExtractor, type Range } from '@tanstack/virtual-core';

type Options = PartialKeys<VirtualizerOptions<Window, HTMLElement>, 'getScrollElement' | 'observeElementRect' | 'observeElementOffset' | 'scrollToFn'>;

export interface WindowVirtualizer {
  /** The virtualizer itself (scrollToIndex, options...); its options follow the accessor given. Reading it does not track. */
  readonly instance: Virtualizer<Window, HTMLElement>;
  /** The items to render now. */
  items: Accessor<VirtualItem[]>;
  /** Height of the whole list. */
  totalSize: Accessor<number>;
  /** Ref for each rendered item (it must carry `data-index`): measures it once it is in the page. */
  measure(el: HTMLElement): void;
}

/**
 * A virtualizer over the window's scroll, as TanStack's React adapter's
 * `useWindowVirtualizer` (TanStack's Solid adapter is for Solid 1). Call it
 * in a component body.
 */
export function createWindowVirtualizer(options: Accessor<Options>): WindowVirtualizer {
  // Bumped whenever the virtualizer says its items or size changed (scroll, resize, measure).
  const [version, setVersion] = createSignal(0, { ownedWrite: true });
  const resolve = (o: Options): VirtualizerOptions<Window, HTMLElement> => ({
    getScrollElement: () => window,
    observeElementRect: observeWindowRect,
    observeElementOffset: observeWindowOffset,
    scrollToFn: windowScroll,
    initialOffset: () => window.scrollY,
    ...o,
    onChange: (v, sync) => {
      setVersion((n) => n + 1);
      o.onChange?.(v, sync);
    },
  });
  let instance: Virtualizer<Window, HTMLElement> | undefined;
  // The same virtualizer throughout. Its options are read again on every change
  // it reports (scroll, resize, measure), as React's adapter did on each render:
  // values the options read from the page, like where the list starts, stay current.
  const current = createMemo(
    () => {
      version();
      const o = resolve(options());
      if (instance) instance.setOptions(o);
      else instance = new Virtualizer(o);
      return instance;
    },
    { equals: false },
  );
  // `current` changes on every bump, so these follow it.
  const items = createMemo(() => current().getVirtualItems(), { equals: false });
  const totalSize = createMemo(() => current().getTotalSize());
  // Start watching the window's size and scroll (_willUpdate only acts when the scroll element changes, so once).
  onSettled(() => {
    const v = current();
    const stop = v._didMount();
    v._willUpdate();
    return stop;
  });
  // After each render, forget rows that left the page.
  createEffect(
    () => {
      items();
      return current();
    },
    (v) => v.measureElement(null),
  );
  return {
    // Untracked once made: it is the same object throughout, and reading it should not re-run on every scroll.
    get instance() {
      return instance ?? current();
    },
    items,
    totalSize,
    measure(el) {
      // Refs run before the element is in the page, where it would measure 0 high.
      queueMicrotask(() => {
        if (el.isConnected) current().measureElement(el);
      });
    },
  };
}
