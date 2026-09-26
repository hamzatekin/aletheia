import { useEffect, useMemo, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Engine } from '@/commands';
import { plainText } from '@/editor/markdown';
import { renderBlock, renderInline } from '@/editor/render';
import { NodeEditor } from '@/editor/NodeEditor';
import { NoteEditor } from '@/editor/NoteEditor';
import type { EditorSession } from '@/editor/session';
import type { SearchIndex } from '@/search';
import { SearchPalette } from '@/search/SearchPalette';
import { useEngine } from '@/app/engine-context';
import { useUiStore, type UiStore } from '@/store/ui-store';
import { createOutlineActions } from './actions';
import { Breadcrumbs } from './Breadcrumbs';
import { Outline } from './Outline';
import { OutlineProvider } from './outline-context';
import { useNode } from './use-outline';

interface Props {
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
}

/** `/` shows the top level; `/n/:id` zooms into a node. */
export function OutlinePage({ ui, session, search }: Props) {
  const engine: Engine = useEngine();
  const { id } = useParams<{ id: string }>();
  const rootId = id ?? null;
  const root = useNode(rootId);
  const navigate = useNavigate();
  const missing = rootId !== null && (!root || root.deletedAt !== null);

  const actions = useMemo(
    () => createOutlineActions({ engine, ui, session, search, rootId, navigate }),
    [engine, ui, session, search, rootId, navigate],
  );
  const context = useMemo(
    () => ({ engine, ui, session, search, actions, rootId }),
    [engine, ui, session, search, actions, rootId],
  );

  useEffect(() => {
    session.setKeyHandler(actions.handleKey);
    session.pasteHandler = actions.pasteLines;
    const off = session.onTransaction(actions.syncSlash);
    return () => {
      session.setKeyHandler(null);
      session.pasteHandler = null;
      off();
    };
  }, [session, actions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      actions.handleGlobalKey(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);

  useEffect(() => {
    document.title = root && !missing ? plainText(root.content) || 'Untitled' : 'Aletheia';
  }, [root, missing]);

  const titleFocus = useUiStore(ui, (s) => (rootId !== null && s.focus?.id === rootId ? s.focus.field : null));

  const onBackgroundMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    session.flush();
    ui.blur();
    ui.setSelection(null);
  };

  const onTitleMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (rootId === null || (e.target as HTMLElement).closest('a') || e.button !== 0) return;
    e.preventDefault();
    ui.focusNode(rootId, { kind: 'point', x: e.clientX, y: e.clientY });
  };

  return (
    <OutlineProvider value={context}>
      <main className="mx-auto min-h-screen max-w-2xl px-6 py-12 pl-16 sm:px-10 sm:pl-20" onMouseDown={onBackgroundMouseDown}>
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
            {root && rootId !== null && (
              <header className="mb-4" data-node-id={rootId} data-title="true">
                {titleFocus === 'content' ? (
                  <NodeEditor id={rootId} className="node-content text-[1.75rem] font-normal leading-tight tracking-tight wrap-break-word" />
                ) : (
                  <h1
                    className="node-content cursor-text text-[1.75rem] font-normal leading-tight tracking-tight wrap-break-word"
                    onMouseDown={onTitleMouseDown}
                    dangerouslySetInnerHTML={{ __html: renderInline(root.content) || '<br>' }}
                  />
                )}
                {titleFocus === 'note' ? (
                  <div className="mt-1">
                    <NoteEditor id={rootId} />
                  </div>
                ) : (
                  root.note !== '' && (
                    <div
                      className="prose-note mt-1 cursor-text text-sm text-neutral-500 dark:text-neutral-400"
                      onMouseDown={(e) => {
                        if ((e.target as HTMLElement).closest('a')) return;
                        e.preventDefault();
                        ui.focusNode(rootId, { kind: 'end' }, 'note');
                      }}
                      dangerouslySetInnerHTML={{ __html: renderBlock(root.note) }}
                    />
                  )
                )}
              </header>
            )}
            <Outline rootId={rootId} />
          </>
        )}
        <SearchPalette />
      </main>
    </OutlineProvider>
  );
}
