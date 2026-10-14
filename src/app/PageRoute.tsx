import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useStore } from 'zustand';
import type { SyncService } from '@/sync/service';
import { Spinner } from '@/ui/widgets';
import { fetchPage, type SentPage } from './pages';

/**
 * /p/:id: a page sent with a capture, full screen under a slim bar. The frame
 * is sandboxed without allow-same-origin, so the page's scripts (charts,
 * diagrams) run but can't reach this app's storage or the sync key.
 */
export function PageRoute({ sync }: { sync: SyncService | undefined }) {
  return sync ? <SyncedPage sync={sync} /> : <Frame message={NEEDS_SYNC} />;
}

const NEEDS_SYNC = 'This page opens only where sync is on. Turn it on in Settings.';

function SyncedPage({ sync }: { sync: SyncService }) {
  const { id = '' } = useParams();
  const key = useStore(sync.state, (s) => s.key);
  const [page, setPage] = useState<SentPage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
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
  }, [id, key]);

  useEffect(() => {
    if (page?.title) document.title = page.title;
  }, [page]);

  return <Frame page={page} message={key ? problem : NEEDS_SYNC} />;
}

function Frame({ page = null, message }: { page?: SentPage | null; message: string | null }) {
  return (
    <div className="flex h-dvh flex-col bg-desk text-ink">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2 text-sm">
        <Link to="/" className="text-muted hover:text-ink">
          ← Aletheia
        </Link>
        <span className="min-w-0 truncate font-medium" data-testid="page-title">
          {page?.title}
        </span>
      </div>
      {message ? (
        <p role="alert" className="p-6 text-sm text-muted">
          {message}
        </p>
      ) : page ? (
        <iframe
          title={page.title || 'Page'}
          srcDoc={page.html}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0 bg-white"
          data-testid="page-frame"
        />
      ) : (
        <div className="p-6">
          <Spinner />
        </div>
      )}
    </div>
  );
}
