import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { keyFromHash, syncLink, type SyncService, type SyncState } from '@/sync/service';

interface Props {
  sync: SyncService;
}

/** Settings drawer section: turn sync on, share the link, join from a link. */
export function SyncSection({ sync }: Props) {
  const state = useStore(sync.state);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(error instanceof TypeError ? 'Could not reach the sync server. Are you online?' : (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (state.pendingJoinKey && state.pendingJoinKey !== state.key) {
    const key = state.pendingJoinKey;
    const join = (mode: 'replace' | 'merge') =>
      run(async () => {
        if (state.key) await sync.disable();
        await sync.join(key, mode);
      });
    body = (
      <>
        <p className="mb-2">Join sync from this link?</p>
        <p className="mb-3 text-xs text-muted">
          Use synced notes replaces the notes in this browser with your synced ones. Merge keeps this browser's notes and adds them to your synced
          notes.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button primary disabled={busy} onClick={() => join('replace')}>
            Use synced notes
          </Button>
          <Button disabled={busy} onClick={() => join('merge')}>
            Merge
          </Button>
          <Button disabled={busy} onClick={() => sync.setPendingJoin(null)}>
            Cancel
          </Button>
        </div>
      </>
    );
  } else if (state.key) {
    body = <SyncOn sync={sync} state={state} busy={busy} run={run} />;
  } else {
    body = <SyncOff sync={sync} busy={busy} run={run} />;
  }

  return (
    <section data-testid="sync-section" className="mb-4 border-b border-line pb-4">
      <h2 className="mb-2 font-semibold">Sync</h2>
      {body}
      {problem && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          {problem}
        </p>
      )}
    </section>
  );
}

function SyncOff({ sync, busy, run }: { sync: SyncService; busy: boolean; run: (w: () => Promise<unknown>) => Promise<void> }) {
  const [link, setLink] = useState('');
  const pasted = link.trim();
  const key = keyFromHash(pasted.includes('#') ? pasted.slice(pasted.indexOf('#')) : `#sync=${pasted}`);
  return (
    <>
      <p className="mb-3 text-xs text-muted">Off. Your notes are only in this browser. Turn sync on to open them on your phone or another computer.</p>
      <Button primary disabled={busy} onClick={() => run(() => sync.enable())}>
        Turn on sync
      </Button>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (key) sync.setPendingJoin(key);
        }}
      >
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Or paste a sync link"
          aria-label="Sync link"
          className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1 text-xs"
        />
        <Button disabled={!key}>Join</Button>
      </form>
    </>
  );
}

function SyncOn({
  sync,
  state,
  busy,
  run,
}: {
  sync: SyncService;
  state: SyncState;
  busy: boolean;
  run: (w: () => Promise<unknown>) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const link = syncLink(window.location.origin, state.key!);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', link);
    }
  };
  return (
    <>
      <p className="mb-3 text-xs" data-testid="sync-status">
        <StatusLine state={state} />
      </p>
      <p className="mb-1.5 text-xs text-muted">To continue on your phone, open this link there:</p>
      <div className="mb-3 flex gap-2">
        <input readOnly value={link} aria-label="Your sync link" onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1 text-xs text-muted" />
        <Button primary onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted">Anyone with this link can read and change your notes. Keep it to yourself.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={state.status === 'syncing'} onClick={() => void sync.sync()}>
          Sync now
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            if (window.confirm('Stop syncing in this browser? Your notes stay here and on your other devices.')) void run(() => sync.disable());
          }}
        >
          Turn off here
        </Button>
      </div>
    </>
  );
}

function StatusLine({ state }: { state: SyncState }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);
  switch (state.status) {
    case 'syncing':
      return <span className="text-muted">Syncing…</span>;
    case 'offline':
      return <span className="text-muted">Offline. Changes will upload when you are back online.</span>;
    case 'error':
      return <span className="text-red-500">Sync failed: {state.error}</span>;
    default:
      return <span className="text-muted">{state.lastSyncedAt ? `On. Synced ${ago(state.lastSyncedAt)}.` : 'On.'}</span>;
  }
}

function ago(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return new Date(at).toLocaleString();
}

function Button({ primary, disabled, onClick, children }: { primary?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      disabled={disabled}
      onClick={onClick}
      className={
        'rounded border px-2.5 py-1 text-xs disabled:opacity-50 ' +
        (primary ? 'border-accent bg-selection text-accent hover:opacity-90' : 'border-line hover:bg-hover')
      }
    >
      {children}
    </button>
  );
}
