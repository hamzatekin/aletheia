import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { SyncService, SyncState } from '@/sync/service';
import { ago } from './SyncSection';

/** Short syncs (the 30s check) finish before this; only longer ones show the spinner. */
const SPIN_DELAY_MS = 500;

/**
 * Sync status at the top right, like Dynalist's: synced, syncing, offline or
 * failed. Click to sync now. Hidden while sync is off. While joining, a bar
 * at the top of the page counts the notes as they arrive.
 */
export function SyncIndicator({ sync }: { sync: SyncService }) {
  const state = useStore(sync.state);
  const syncing = useDelayed(state.status === 'syncing', SPIN_DELAY_MS);
  // Re-render now and then so "synced 2 min ago" stays right.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      {state.download && <DownloadBar received={state.download.received} />}
      {state.key && (
        <button
          type="button"
          onClick={() => void sync.sync()}
          onMouseDown={(e) => e.preventDefault()}
          className={
            'top-icon fixed top-3 right-43 z-40 flex size-[34px] items-center justify-center rounded-md hover:bg-hover hover:text-ink ' +
            (state.status === 'error' ? 'text-danger' : 'text-muted')
          }
          aria-label={label(state, syncing)}
          title={label(state, syncing) + (syncing ? '' : ' Click to sync now.')}
          data-testid="sync-indicator"
          data-state={syncing || state.download ? 'syncing' : state.status}
        >
          <Icon kind={syncing || state.download ? 'syncing' : state.status} />
        </button>
      )}
    </>
  );
}

function DownloadBar({ received }: { received: number }) {
  return (
    <div
      role="status"
      data-testid="sync-download"
      className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink shadow-lg"
    >
      <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-faint border-t-transparent" aria-hidden="true" />
      <span className="min-w-0 truncate">
        Getting your notes from sync…{received > 0 ? ` ${received.toLocaleString()} so far` : ''}
      </span>
    </div>
  );
}

function label(state: SyncState, syncing: boolean): string {
  if (state.download || syncing) return 'Syncing…';
  switch (state.status) {
    case 'offline':
      return 'Offline. Changes will upload when you are back online.';
    case 'error':
      return `Sync failed: ${state.error ?? 'unknown error'}.`;
    default:
      return state.lastSyncedAt ? `Synced ${ago(state.lastSyncedAt)}.` : 'Sync is on.';
  }
}

/** True once `on` has stayed true for `ms`; false as soon as it turns false. */
function useDelayed(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && shown;
}

function Icon({ kind }: { kind: 'syncing' | SyncState['status'] }) {
  const cloud = 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z';
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={kind === 'syncing' ? 'animate-spin' : undefined}
    >
      {kind === 'syncing' ? (
        <>
          <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
          <path d="M21 21v-5h-5" />
        </>
      ) : kind === 'offline' ? (
        <>
          <path d="m2 2 20 20" />
          <path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193" />
          <path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07" />
        </>
      ) : kind === 'error' ? (
        <>
          <path d={cloud} />
          <path d="M12 10.5v3" />
          <path d="M12 16.2h.01" />
        </>
      ) : (
        <>
          <path d={cloud} />
          <path d="m9.5 14 2 2 3.5-3.5" />
        </>
      )}
    </svg>
  );
}
