import { useEffect } from 'react';
import { useStore } from 'zustand';
import { useOutline } from '@/tree-view/outline-context';
import { useUiStore } from '@/store/ui-store';
import { useCoarsePointer } from '@/ui/media';
import { useTick } from '@/ui/hooks';
import { Spinner } from '@/ui/widgets';
import { MAX_RECORDING_MS, type VoiceService } from './service';

function MicIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
export function VoiceButton({ voice }: { voice: VoiceService }) {
  const { ui } = useOutline();
  const coarse = useCoarsePointer();
  const busy = useUiStore(ui, (s) => s.focus !== null || (s.selection?.ids.size ?? 0) > 0);
  const open = useStore(voice.state, (s) => s.phase !== 'idle');
  if (!coarse || busy || open || !voice.available()) return null;

  return (
    <button
      type="button"
      onClick={() => void voice.start()}
      onMouseDown={(e) => e.preventDefault()}
      className="fixed right-[22px] bottom-[calc(1.25rem+68px+env(safe-area-inset-bottom))] z-40 flex size-11 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-md active:scale-95"
      aria-label="Voice memo"
      title="Voice memo"
      data-testid="voice-memo"
    >
      <MicIcon />
    </button>
  );
}

/** The sheet at the bottom while recording, while AI writes the memo down, or when that failed. */
export function VoiceSheet({ voice }: { voice: VoiceService }) {
  const { navigate } = useOutline();
  const s = useStore(voice.state);

  const done = async (pending: Promise<string | null>) => {
    const id = await pending;
    if (id !== null) void navigate(`/n/${id}`);
  };

  // Stop at the limit, as if Done was pressed.
  const since = s.phase === 'recording' ? s.since : null;
  useEffect(() => {
    if (since === null) return;
    const t = setTimeout(() => void done(voice.finish()), Math.max(0, since + MAX_RECORDING_MS - Date.now()));
    return () => clearTimeout(t);
  });

  if (s.phase === 'idle') return null;
  return (
    <div
      role={s.phase === 'error' ? 'alert' : 'status'}
      data-testid="voice-sheet"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-ink shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {s.phase === 'recording' && (
        <div className="flex items-center gap-3">
          <span className="size-3 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden="true" />
          <span className="flex-1">
            Listening <Elapsed since={s.since} />
          </span>
          <button type="button" className="px-3 py-2 text-muted" onClick={() => voice.cancel()} data-testid="voice-cancel">
            Cancel
          </button>
          <button type="button" className="rounded-full bg-accent px-5 py-2 font-medium text-page" onClick={() => void done(voice.finish())} data-testid="voice-done">
            Done
          </button>
        </div>
      )}
      {s.phase === 'working' && (
        <div className="flex items-center gap-3 py-2">
          <Spinner />
          <span className="flex-1">Writing it down…</span>
          <button type="button" className="px-3 text-muted" onClick={() => voice.cancel()}>
            Cancel
          </button>
        </div>
      )}
      {s.phase === 'error' && (
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-danger" data-testid="voice-error">
            {s.text}
          </span>
          {s.retry && (
            <button type="button" className="px-3 py-2 font-medium" onClick={() => void done(voice.retry())} data-testid="voice-retry">
              Try again
            </button>
          )}
          <button type="button" className="px-3 py-2 text-muted" onClick={() => voice.cancel()}>
            {s.retry ? 'Discard' : 'Close'}
          </button>
        </div>
      )}
    </div>
  );
}

/** m:ss since the recording started. */
function Elapsed({ since }: { since: number }) {
  useTick(500);
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return <span className="text-muted tabular-nums">{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</span>;
}
