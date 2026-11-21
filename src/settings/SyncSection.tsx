import { createMemo, createSignal, Match, Show, Switch } from 'solid-js';
import { keyFromHash, syncLink, type SyncService, type SyncState } from '@/sync/service';
import { useStoreValue } from '@/ui/store';
import { useFlash, useTick } from '@/ui/hooks';
import { ago, Button } from '@/ui/widgets';
import { ClaudeCodeSection } from './ClaudeCodeSection';

interface Props {
  sync: SyncService;
}

type Run = (w: () => Promise<unknown>) => Promise<void>;

/** Settings drawer section: turn sync on, share the link, join from a link. */
export function SyncSection(props: Props) {
  const state = useStoreValue(props.sync.state);
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const run: Run = async (work) => {
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

  /** The key from a sync link that is waiting for a yes, unless this browser already syncs with it. */
  const pendingJoin = () => {
    const s = state();
    return s.pendingJoinKey && s.pendingJoinKey !== s.key ? s.pendingJoinKey : null;
  };
  const join = (mode: 'replace' | 'merge') => {
    // Read before the first await: `state()` follows the store, so after it the key may be gone.
    const key = pendingJoin()!;
    const hadKey = state().key;
    void run(async () => {
      if (hadKey) await props.sync.disable();
      await props.sync.join(key, mode);
    });
  };

  return (
    <section data-testid="sync-section" class="mb-4 border-b border-line pb-4">
      <h2 class="mb-2 font-semibold">Sync</h2>
      <Switch fallback={<SyncOff sync={props.sync} lastKey={state().lastKey} busy={busy()} run={run} />}>
        <Match when={pendingJoin()}>
          <p class="mb-2">Join sync from this link?</p>
          <p class="mb-3 text-xs text-muted">
            Use synced notes replaces the notes in this browser with your synced ones. Merge keeps this browser's notes and adds them to your synced
            notes.
          </p>
          <div class="flex flex-wrap gap-2">
            <Button primary disabled={busy()} onClick={() => join('replace')}>
              Use synced notes
            </Button>
            <Button disabled={busy()} onClick={() => join('merge')}>
              Merge
            </Button>
            <Button disabled={busy()} onClick={() => props.sync.setPendingJoin(null)}>
              Cancel
            </Button>
          </div>
        </Match>
        <Match when={state().key}>
          <SyncOn sync={props.sync} state={state()} busy={busy()} run={run} />
        </Match>
      </Switch>
      <Show when={problem()}>
        <p role="alert" class="mt-2 text-xs text-red-500">
          {problem()}
        </p>
      </Show>
    </section>
  );
}

function SyncOff(props: { sync: SyncService; lastKey: string | null; busy: boolean; run: Run }) {
  const [link, setLink] = createSignal('');
  const key = createMemo(() => {
    const pasted = link().trim();
    return keyFromHash(pasted.includes('#') ? pasted.slice(pasted.indexOf('#')) : `#sync=${pasted}`);
  });
  return (
    <>
      <Show
        when={props.lastKey}
        fallback={
          <>
            <p class="mb-3 text-xs text-muted">Off. Your notes are only in this browser. Turn sync on to open them on your phone or another computer.</p>
            <Button primary disabled={props.busy} onClick={() => props.run(() => props.sync.enable())}>
              Turn on sync
            </Button>
          </>
        }
      >
        <p class="mb-3 text-xs text-muted">Off in this browser. Turning it back on merges this browser's notes with your synced ones.</p>
        <Button primary disabled={props.busy} onClick={() => props.run(() => props.sync.resume())}>
          Turn sync back on
        </Button>
      </Show>
      <form
        class="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const k = key();
          if (k) props.sync.setPendingJoin(k);
        }}
      >
        <input
          value={link()}
          onInput={(e) => setLink(e.currentTarget.value)}
          placeholder="Or paste a sync link"
          aria-label="Sync link"
          class="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1 text-xs"
        />
        <Button disabled={!key()}>Join</Button>
      </form>
    </>
  );
}

function SyncOn(props: { sync: SyncService; state: SyncState; busy: boolean; run: Run }) {
  const [copied, flashCopied] = useFlash(2000);
  const link = () => syncLink(window.location.origin, props.state.key!);
  const copy = async () => {
    const text = link();
    try {
      await navigator.clipboard.writeText(text);
      flashCopied();
    } catch {
      window.prompt('Copy this link', text);
    }
  };
  return (
    <>
      <p class="mb-3 text-xs" data-testid="sync-status">
        <StatusLine state={props.state} />
      </p>
      <p class="mb-1.5 text-xs text-muted">To continue on your phone, open this link there:</p>
      <div class="mb-3 flex gap-2">
        <input readonly value={link()} aria-label="Your sync link" onFocus={(e) => e.currentTarget.select()} class="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1 text-xs text-muted" />
        <Button primary onClick={copy}>
          {copied() ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <p class="mb-3 text-xs text-muted">Anyone with this link can read and change your notes. Keep it to yourself.</p>
      <div class="flex flex-wrap gap-2">
        <Button disabled={props.state.status === 'syncing'} onClick={() => void props.sync.sync()}>
          Sync now
        </Button>
        <Button
          disabled={props.busy}
          onClick={() => {
            if (window.confirm('Stop syncing in this browser? Your notes stay here and on your other devices, and you can turn sync back on here later.')) void props.run(() => props.sync.disable());
          }}
        >
          Turn off here
        </Button>
      </div>
      <ClaudeCodeSection syncKey={props.state.key!} />
    </>
  );
}

function StatusLine(props: { state: SyncState }) {
  const tick = useTick(10_000);
  return (
    <Switch
      fallback={<span class="text-muted">{(tick(), props.state.lastSyncedAt ? `On. Synced ${ago(props.state.lastSyncedAt)}.` : 'On.')}</span>}
    >
      <Match when={props.state.status === 'syncing'}>
        <span class="text-muted">Syncing…</span>
      </Match>
      <Match when={props.state.status === 'offline'}>
        <span class="text-muted">Offline. Changes will upload when you are back online.</span>
      </Match>
      <Match when={props.state.status === 'error'}>
        <span class="text-red-500">Sync failed: {props.state.error}</span>
      </Match>
    </Switch>
  );
}
