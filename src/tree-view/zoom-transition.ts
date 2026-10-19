import { flushSync } from 'react-dom';
import type { NavigateFunction, NavigateOptions } from 'react-router';
import { isSelfOrDescendant, type TreeReader } from '@/model';

type Direction = 'in' | 'out';

/** The page a path shows: a node's id, null for Home, or undefined for another route. */
function pageOf(path: string): string | null | undefined {
  if (path === '/') return null;
  const m = /^\/n\/([^/?#]+)$/.exec(path);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

/** Zooming in goes to something inside the page, out to something around it; anything else is a jump. */
function zoomDirection(tree: TreeReader, from: string | null, to: string | null): Direction | null {
  if (from === to) return null;
  if (to !== null && (from === null || isSelfOrDescendant(tree, from, to))) return 'in';
  if (from !== null && (to === null || isSelfOrDescendant(tree, to, from))) return 'out';
  return null;
}

/** The text of a row on the page (not the title). */
const rowText = (id: string) => document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]:not([data-title]) .node-content`);
/** The zoomed page's title text. */
const titleText = () => document.querySelector<HTMLElement>('header[data-title] .node-content');

/**
 * `navigate`, but zooming in or out of the outline animates like WorkFlowy:
 * the item you zoom into glides up and grows into the page's title, and
 * zooming out drops the title back into its row, while the rest cross-fades.
 * Uses the browser's view transitions; without them, or with reduced motion
 * asked for, it just navigates.
 */
export function zoomingNavigate(navigate: NavigateFunction, tree: TreeReader, rootId: string | null): NavigateFunction {
  const go = (to: unknown, options?: NavigateOptions) => {
    const target = typeof to === 'string' ? pageOf(to) : undefined;
    const direction = target === undefined ? null : zoomDirection(tree, rootId, target);
    if (
      direction === null ||
      typeof document.startViewTransition !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return (navigate as (to: unknown, options?: NavigateOptions) => void | Promise<void>)(to, options);
    }
    // The text that moves: the row zoomed into becomes the title; zooming out, the title becomes a row again.
    const before = direction === 'in' ? rowText(target!) : titleText();
    const after = () => (direction === 'in' ? titleText() : rootId !== null ? rowText(rootId) : null);
    if (before) before.style.viewTransitionName = 'zoom-title';
    document.documentElement.dataset.zoom = direction;
    let moved: HTMLElement | null = null;
    const transition = document.startViewTransition(() => {
      // The router updates synchronously (BrowserRouter useTransitions={false}), so the new page is in the DOM after this.
      flushSync(() => void navigate(to as string, options));
      if (before) before.style.viewTransitionName = '';
      moved = after();
      if (moved) moved.style.viewTransitionName = 'zoom-title';
    });
    void transition.finished.finally(() => {
      if (moved) moved.style.viewTransitionName = '';
      delete document.documentElement.dataset.zoom;
    });
  };
  return go as NavigateFunction;
}
