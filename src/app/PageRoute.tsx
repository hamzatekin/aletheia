import { createEffect, createSignal, Match, Show, Switch } from 'solid-js';
import { useParams } from '@solidjs/router';
import { appPath } from '@/app/routing';
import type { SyncService } from '@/sync/service';
import { useStoreValue } from '@/ui/store';
import { Spinner } from '@/ui/widgets';
import { fetchPage, type SentPage } from './pages';

/**
 * /p/:id: a page sent with a capture, full screen under a slim bar. The frame
 * is sandboxed without allow-same-origin, so the page's scripts (charts,
 * diagrams) run but can't reach this app's storage or the sync key.
 */
export function PageRoute(props: { sync: SyncService | undefined }) {
  return (
    <Show when={props.sync} keyed fallback={<Frame message={NEEDS_SYNC} />}>
      {(sync) => <SyncedPage sync={sync} />}
    </Show>
  );
}

const NEEDS_SYNC = 'This page opens only where sync is on. Turn it on in Settings.';

function SyncedPage(props: { sync: SyncService }) {
  const params = useParams();
  const key = useStoreValue(props.sync.state, (s) => s.key);
  const [page, setPage] = createSignal<SentPage | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);

  createEffect(
    () => [params.id ?? '', key()] as const,
    ([id, key]) => {
      if (!key) return;
      let current = true;
      setPage(null);
      setProblem(null);
      fetchPage(key, id).then(
        (p) => current && setPage(p),
        (error: unknown) => current && setProblem(error instanceof TypeError ? 'Could not reach the server. Are you online?' : (error as Error).message),
      );
      return () => {
        current = false;
      };
    },
  );

  createEffect(page, (p) => {
    if (p?.title) document.title = p.title;
  });

  return <Frame page={page()} message={key() ? problem() : NEEDS_SYNC} />;
}

function Frame(props: { page?: SentPage | null; message: string | null }) {
  return (
    <div class="flex h-dvh flex-col bg-desk text-ink">
      <div class="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2 text-sm">
        <a href={appPath('/')} noscroll class="text-muted hover:text-ink">
          ← Aletheia
        </a>
        <span class="min-w-0 truncate font-medium" data-testid="page-title">
          {props.page?.title}
        </span>
      </div>
      <Switch
        fallback={
          <div class="p-6">
            <Spinner />
          </div>
        }
      >
        <Match when={props.message}>
          {(message) => (
            <p role="alert" class="p-6 text-sm text-muted">
              {message()}
            </p>
          )}
        </Match>
        <Match when={props.page}>
          {(page) => (
            <iframe
              title={page().title || 'Page'}
              srcdoc={page().html}
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              referrerpolicy="no-referrer"
              class="min-h-0 w-full flex-1 border-0 bg-white"
              data-testid="page-frame"
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}
