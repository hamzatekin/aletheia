import { useNavigate } from '@solidjs/router';
import { inSandbox, SANDBOX_PATH } from './sandbox';

interface NavigateOptions {
  replace?: boolean;
  /** Read back as `useLocation().state` on the new page. */
  state?: unknown;
}

/** Goes to an app path such as `/n/:id`; inside the sandbox it stays under /sandbox. */
export type Navigate = (to: string, options?: NavigateOptions) => void;

/**
 * An app path as a URL path. The router's base only matches routes: a path
 * starting with "/" is never prefixed with it, so links and navigation go
 * through this to stay inside the sandbox.
 */
export function appPath(path: string): string {
  if (!inSandbox) return path;
  return path === '/' ? SANDBOX_PATH : SANDBOX_PATH + path;
}

/**
 * The router's navigate, for app paths. It never scrolls: the outline decides
 * where a new page starts (Outline.tsx), as it did before.
 */
export function useAppNavigate(): Navigate {
  const navigate = useNavigate();
  return (to, options) => navigate(appPath(to), { scroll: false, ...(options?.replace ? { replace: true } : {}), ...(options?.state !== undefined ? { state: options.state } : {}) });
}

let lastNavigation: 'push' | 'replace' | 'traverse' | 'reload' = 'push';

/** Whether the latest navigation was Back or Forward (the browser restores the scroll then). */
export function wasTraversal(): boolean {
  return lastNavigation === 'traverse';
}

/** Start watching navigations; call once before the router starts. */
export function watchNavigations(): void {
  type NavigateEvent = Event & { navigationType: typeof lastNavigation };
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  if (navigation) {
    navigation.addEventListener('navigate', (e) => (lastNavigation = (e as NavigateEvent).navigationType));
    return;
  }
  // Without the Navigation API: Back and Forward fire popstate; anything after a click or key is a push.
  window.addEventListener('popstate', () => (lastNavigation = 'traverse'));
  const push = () => (lastNavigation = 'push');
  window.addEventListener('click', push, true);
  window.addEventListener('keydown', push, true);
}
