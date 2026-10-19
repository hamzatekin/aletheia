import { useSyncExternalStore } from 'react';

/** Wide enough for the sidebars to dock beside the page (matches `lg` and the CSS breakpoints). */
const WIDE = '(min-width: 1024px)';
const COARSE = '(pointer: coarse)';

/** Wide screen: sidebars and panels dock instead of covering the page. */
export const isWide = (): boolean => window.matchMedia(WIDE).matches;

/** Touch screen (phone, tablet), checked once; components use `useCoarsePointer`. */
export const isCoarsePointer = (): boolean => window.matchMedia(COARSE).matches;

/** Shortcut labels use ⌘ and ⌥ on Apple devices. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function subscribeCoarse(onChange: () => void): () => void {
  const mq = window.matchMedia(COARSE);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** True on touch screens (phones, tablets), where there is no hover and no Tab key. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribeCoarse, isCoarsePointer, () => false);
}

/** A plain left click, not one meant to open the link in a new tab or window. */
export const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
