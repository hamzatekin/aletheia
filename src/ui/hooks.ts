import { createSignal, onCleanup, onSettled, type Accessor } from 'solid-js';
import { isWide } from './media';

/** A counter that goes up every `ms`; read it where a label must stay right ("synced 2 min ago"). */
export function useTick(ms: number): Accessor<number> {
  const [tick, setTick] = createSignal(0);
  onSettled(() => {
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  });
  return tick;
}

/** A flag that `flash()` turns on for `ms` ("Copied" after a copy); flashing again restarts the wait. */
export function useFlash(ms: number): [on: Accessor<boolean>, flash: () => void] {
  const [on, setOn] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const flash = () => {
    clearTimeout(timer);
    setOn(true);
    timer = setTimeout(() => setOn(false), ms);
  };
  return [on, flash];
}

/**
 * Esc closes a side panel. As a drawer (narrow screens) any Esc does; docked,
 * only while focus is in the panel, so Esc still clears a selection or ends
 * editing on the page.
 */
export function useEscToClose(open: Accessor<boolean>, panel: () => HTMLElement | undefined, close: () => void): void {
  onSettled(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open() || e.key !== 'Escape') return;
      if (isWide() && !panel()?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
}

/** Height of the on-screen keyboard (or anything else covering the bottom of the window). */
export function useKeyboardInset(): Accessor<number> {
  const [inset, setInset] = createSignal(0);
  onSettled(() => {
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
  });
  return inset;
}
