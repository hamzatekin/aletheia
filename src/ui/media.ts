import { createSignal, runWithOwner, type Accessor } from 'solid-js';

/** Wide enough for the sidebars to dock beside the page (matches `lg` and the CSS breakpoints). */
const WIDE = '(min-width: 1024px)';
const COARSE = '(pointer: coarse)';

/** Wide screen: sidebars and panels dock instead of covering the page. */
export const isWide = (): boolean => window.matchMedia(WIDE).matches;

/** Touch screen (phone, tablet), checked once; components use `useCoarsePointer`. */
export const isCoarsePointer = (): boolean => window.matchMedia(COARSE).matches;

/** Shortcut labels use ⌘ and ⌥ on Apple devices. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

let coarse: Accessor<boolean> | undefined;

/**
 * True on touch screens (phones, tablets), where there is no hover and no Tab key. Follows a change (a tablet's
 * keyboard docked). Every row asks, so it is one signal and one listener for the page, made on first use.
 */
export function useCoarsePointer(): Accessor<boolean> {
  if (!coarse) {
    const mq = window.matchMedia(COARSE);
    // Not owned by the component that asked first: it lives as long as the page.
    const [read, write] = runWithOwner(null, () => createSignal(mq.matches));
    mq.addEventListener('change', () => write(mq.matches));
    coarse = read;
  }
  return coarse;
}

/** A plain left click, not one meant to open the link in a new tab or window. */
export const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
