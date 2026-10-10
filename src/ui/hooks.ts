import { useEffect, useState, type RefObject } from 'react';
import { isWide } from './media';

/** Re-render every `ms` (so "synced 2 min ago" stays right). */
export function useTick(ms: number): void {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/**
 * Esc closes a side panel. As a drawer (narrow screens) any Esc does; docked,
 * only while focus is in the panel, so Esc still clears a selection or ends
 * editing on the page.
 */
export function useEscToClose(open: boolean, panelRef: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isWide() && !panelRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, panelRef, close]);
}

/** Height of the on-screen keyboard (or anything else covering the bottom of the window). */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}
