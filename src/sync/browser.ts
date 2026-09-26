import { keyFromHash, type SyncService } from './service';

const POLL_MS = 30_000;

/**
 * When to sync in a browser: on start, when the tab becomes visible again,
 * when the network comes back, and every 30s while the tab is visible (to
 * pick up edits from other devices). Edits schedule their own sync.
 */
export function watchBrowser(sync: SyncService): () => void {
  const visible = () => document.visibilityState === 'visible';
  const onVisible = () => {
    if (visible()) void sync.sync();
  };
  const onOnline = () => void sync.sync();
  // Upload right away when the tab is hidden (switching apps on a phone).
  const onHidden = () => {
    if (!visible()) void sync.sync();
  };
  // A sync link pasted into the address bar of an open tab.
  const onHash = () => {
    const key = takeKeyFromLocation();
    if (key) sync.setPendingJoin(key);
  };
  window.addEventListener('hashchange', onHash);
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('online', onOnline);
  const timer = setInterval(() => {
    if (visible() && navigator.onLine) void sync.sync();
  }, POLL_MS);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('hashchange', onHash);
    clearInterval(timer);
  };
}

/** Take a sync key out of the address bar (`#sync=...`), so it is not left in history. */
export function takeKeyFromLocation(): string | null {
  const key = keyFromHash(window.location.hash);
  if (key) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return key;
}
