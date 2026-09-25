import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { plainText } from '@/editor/markdown';
import { renderBlock, renderInline } from '@/editor/render';
import { Breadcrumbs } from './Breadcrumbs';
import { Outline } from './Outline';
import { useNode } from './use-outline';

/** `/` shows the top level; `/n/:id` zooms into a node. */
export function OutlinePage() {
  const { id } = useParams<{ id: string }>();
  const rootId = id ?? null;
  const root = useNode(rootId);
  const navigate = useNavigate();
  const missing = rootId !== null && (!root || root.deletedAt !== null);

  useEffect(() => {
    document.title = root && !missing ? plainText(root.content) || 'Untitled' : 'Aletheia';
  }, [root, missing]);

  // Cmd/Ctrl+, zooms out one level. (Cmd/Ctrl+. needs a focused node; step 3.)
  useEffect(() => {
    if (rootId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        navigate(root?.parentId ? `/n/${root.parentId}` : '/');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rootId, root?.parentId, navigate]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 pl-16 sm:px-10 sm:pl-20">
      {rootId !== null && <Breadcrumbs rootId={rootId} />}
      {missing ? (
        <div className="text-neutral-500">
          This node does not exist.{' '}
          <Link to="/" className="underline">
            Go home
          </Link>
        </div>
      ) : (
        <>
          {root && (
            <header className="mb-4">
              <h1
                className="node-content text-2xl font-semibold leading-tight wrap-break-word"
                dangerouslySetInnerHTML={{ __html: renderInline(root.content) || '&nbsp;' }}
              />
              {root.note !== '' && (
                <div
                  className="prose-note mt-1 text-sm text-neutral-500 dark:text-neutral-400"
                  dangerouslySetInnerHTML={{ __html: renderBlock(root.note) }}
                />
              )}
            </header>
          )}
          <Outline rootId={rootId} />
        </>
      )}
    </main>
  );
}
