import { createEffect, createMemo, createSignal, Show, type Accessor } from 'solid-js';
import type { SyncService, SyncState } from '@/sync/service';
import { useStoreValue } from '@/ui/store';
import { useTick } from '@/ui/hooks';
import { ago, Spinner, TOP_BANNER } from '@/ui/widgets';

/** Short syncs (the 30s check) finish before this; only longer ones show the spinner. */
const SPIN_DELAY_MS = 500;

/**
 * Sync status at the top right, like Dynalist's: synced, syncing, offline or
 * failed. Click to sync now. Hidden while sync is off, so it sits leftmost
 * (left of Ask AI) and leaves no gap. While joining, a bar at the top of the
 * page counts the notes as they arrive.
 */
export function SyncIndicator(props: { sync: SyncService }) {
  const state = useStoreValue(props.sync.state);
  const syncing = useDelayed(() => state().status === 'syncing', SPIN_DELAY_MS);
  const tick = useTick(30_000);
  const text = () => (tick(), label(state(), syncing()));

  return (
    <>
      <Show when={state().download}>{(download) => <DownloadBar received={download().received} />}</Show>
      <Show when={state().key}>
        <button
          type="button"
          onClick={() => void props.sync.sync()}
          onMouseDown={(e) => e.preventDefault()}
          class={[
            'top-icon fixed top-3 right-53 z-40 flex size-[34px] items-center justify-center rounded-md hover:bg-hover hover:text-ink',
            state().status === 'error' ? 'text-danger' : 'text-muted',
          ]}
          aria-label={text()}
          title={text() + (syncing() ? '' : ' Click to sync now.')}
          data-testid="sync-indicator"
          data-state={syncing() || state().download ? 'syncing' : state().status}
        >
          <Icon kind={syncing() || state().download ? 'syncing' : state().status} />
        </button>
      </Show>
    </>
  );
}

function DownloadBar(props: { received: number }) {
  return (
    <div
      role="status"
      data-testid="sync-download"
      class={TOP_BANNER}
    >
      <Spinner />
      <span class="min-w-0 truncate">
        Getting your notes from sync…{props.received > 0 ? ` ${props.received.toLocaleString()} so far` : ''}
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
function useDelayed(onOf: Accessor<boolean>, ms: number): Accessor<boolean> {
  // A memo, so the delay restarts only when `on` flips: effects never compare, and `on` may re-run on every state change.
  const on = createMemo(onOf);
  const [shown, setShown] = createSignal(false);
  createEffect(on, (isOn) => {
    if (!isOn) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  });
  return () => on() && shown();
}

function Icon(props: { kind: 'syncing' | SyncState['status'] }) {
  const cloud = 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z';
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={props.kind === 'syncing' ? 'animate-spin' : undefined}
    >
      {props.kind === 'syncing' ? (
        <>
          <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
          <path d="M21 21v-5h-5" />
        </>
      ) : props.kind === 'offline' ? (
        <>
          <path d="m2 2 20 20" />
          <path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193" />
          <path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07" />
        </>
      ) : props.kind === 'error' ? (
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
