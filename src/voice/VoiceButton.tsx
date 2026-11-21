import { createEffect, createMemo, Show } from 'solid-js';
import { useOutline } from '@/tree-view/outline-context';
import { useBottomBarUp } from '@/tree-view/use-outline';
import { useCoarsePointer } from '@/ui/media';
import { useTick } from '@/ui/hooks';
import { useStoreValue } from '@/ui/store';
import { Spinner } from '@/ui/widgets';
import { MAX_RECORDING_MS, type VoiceService } from './service';

function MicIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={1.8} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/**
 * A small round mic above the phone's + button: say a memo and it lands at the
 * top of the Inbox, titled and tidied by AI. Shown where AI works (sync on)
 * and hidden with the + while the editing or selection bar is up.
 */
export function VoiceButton(props: { voice: VoiceService }) {
  const coarse = useCoarsePointer();
  const busy = useBottomBarUp();
  const open = useStoreValue(props.voice.state, (s) => s.phase !== 'idle');

  return (
    <Show when={coarse() && !busy() && !open() && props.voice.available()}>
      <button
        type="button"
        onClick={() => void props.voice.start()}
        onMouseDown={(e) => e.preventDefault()}
        class="fixed right-[22px] bottom-[calc(1.25rem+68px+env(safe-area-inset-bottom))] z-40 flex size-11 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-md active:scale-95"
        aria-label="Voice memo"
        title="Voice memo"
        data-testid="voice-memo"
      >
        <MicIcon />
      </button>
    </Show>
  );
}

/** The sheet at the bottom while recording, while AI writes the memo down, or when that failed. */
export function VoiceSheet(props: { voice: VoiceService }) {
  const { navigate } = useOutline();
  const s = useStoreValue(props.voice.state);
  const phase = useStoreValue(props.voice.state, (v) => v.phase);
  const recording = createMemo(() => {
    const v = s();
    return v.phase === 'recording' ? v : undefined;
  });
  const failed = createMemo(() => {
    const v = s();
    return v.phase === 'error' ? v : undefined;
  });

  const done = async (pending: Promise<string | null>) => {
    const id = await pending;
    if (id !== null) navigate(`/n/${id}`);
  };

  // Stop at the limit, as if Done was pressed.
  createEffect(
    () => recording()?.since ?? null,
    (since) => {
      if (since === null) return;
      const t = setTimeout(() => void done(props.voice.finish()), Math.max(0, since + MAX_RECORDING_MS - Date.now()));
      return () => clearTimeout(t);
    },
  );

  return (
    <Show when={phase() !== 'idle'}>
      <div
        role={phase() === 'error' ? 'alert' : 'status'}
        data-testid="voice-sheet"
        class="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-ink shadow-lg"
        onMouseDown={(e) => e.preventDefault()}
      >
        <Show when={recording()}>
          {(r) => (
            <div class="flex items-center gap-3">
              <span class="size-3 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden="true" />
              <span class="flex-1">
                Listening <Elapsed since={r().since} />
              </span>
              <button type="button" class="px-3 py-2 text-muted" onClick={() => props.voice.cancel()} data-testid="voice-cancel">
                Cancel
              </button>
              <button type="button" class="rounded-full bg-accent px-5 py-2 font-medium text-page" onClick={() => void done(props.voice.finish())} data-testid="voice-done">
                Done
              </button>
            </div>
          )}
        </Show>
        <Show when={phase() === 'working'}>
          <div class="flex items-center gap-3 py-2">
            <Spinner />
            <span class="flex-1">Writing it down…</span>
            <button type="button" class="px-3 text-muted" onClick={() => props.voice.cancel()}>
              Cancel
            </button>
          </div>
        </Show>
        <Show when={failed()}>
          {(f) => (
            <div class="flex items-center gap-3">
              <span class="min-w-0 flex-1 text-danger" data-testid="voice-error">
                {f().text}
              </span>
              <Show when={f().retry}>
                <button type="button" class="px-3 py-2 font-medium" onClick={() => void done(props.voice.retry())} data-testid="voice-retry">
                  Try again
                </button>
              </Show>
              <button type="button" class="px-3 py-2 text-muted" onClick={() => props.voice.cancel()}>
                {f().retry ? 'Discard' : 'Close'}
              </button>
            </div>
          )}
        </Show>
      </div>
    </Show>
  );
}

/** m:ss since the recording started. */
function Elapsed(props: { since: number }) {
  const tick = useTick(500);
  const secs = () => {
    tick();
    return Math.max(0, Math.floor((Date.now() - props.since) / 1000));
  };
  return <span class="text-muted tabular-nums">{`${Math.floor(secs() / 60)}:${String(secs() % 60).padStart(2, '0')}`}</span>;
}
