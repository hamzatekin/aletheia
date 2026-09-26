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
import { TutorialDialog } from '@/help/TutorialDialog';
import { SettingsPanel } from '@/settings/SettingsPanel';
import { useSettings, type SettingsStore } from '@/store/settings-store';
import { useUiStore, type UiStore } from '@/store/ui-store';
import { createOutlineActions } from './actions';
import { Breadcrumbs } from './Breadcrumbs';
import { Outline } from './Outline';
import { OutlineProvider } from './outline-context';
import { OutlineSidebar, SidebarIcon } from './OutlineSidebar';
import { useNode } from './use-outline';

interface Props {
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
  settings: SettingsStore;
}

/** `/` shows the top level; `/n/:id` zooms into a node. */
export function OutlinePage({ ui, session, search, settings }: Props) {
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
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        const s = settings.getState();
        s.update({ sidebarOpen: !s.sidebarOpen });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        session.flush();
        ui.blur();
        ui.setHelpOpen(!ui.getState().helpOpen);
        return;
      }
      actions.handleGlobalKey(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, settings, session, ui]);

  useEffect(() => {
    document.title = root && !missing ? plainText(root.content) || 'Untitled' : 'Aletheia';
  }, [root, missing]);

  const titleFocus = useUiStore(ui, (s) => (rootId !== null && s.focus?.id === rootId ? s.focus.field : null));

  const sidebarOpen = useSettings(settings, (s) => s.sidebarOpen);

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
      <div className="app-shell" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
        <OutlineSidebar settings={settings} rootId={rootId} />
        {!sidebarOpen && (
          <button
            type="button"
            onClick={() => settings.getState().update({ sidebarOpen: true })}
            className="fixed top-3 left-3 z-30 rounded-md p-2 text-muted hover:bg-hover hover:text-ink"
            aria-label="Show outline"
            title="Show outline (Ctrl+\)"
          >
            <SidebarIcon />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            session.flush();
            ui.blur();
            ui.setHelpOpen(true);
          }}
          className="fixed top-3 right-13 z-40 flex size-[34px] items-center justify-center rounded-md text-[15px] font-semibold text-muted hover:bg-hover hover:text-ink"
          aria-label="Tutorial"
          title="Tutorial (Ctrl+/)"
        >
          ?
        </button>
        <SettingsPanel settings={settings} />
        <TutorialDialog ui={ui} />
        <div className="desk min-h-screen" onMouseDown={onBackgroundMouseDown}>
          <main className="book-page" onMouseDown={onBackgroundMouseDown}>
            {rootId !== null && <Breadcrumbs rootId={rootId} />}
            {missing ? (
              <div className="text-muted">
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
                      <NodeEditor id={rootId} className="node-content page-title font-normal tracking-tight wrap-break-word" />
                    ) : (
                      <h1
                        className="node-content page-title cursor-text font-normal tracking-tight wrap-break-word"
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
                          className="prose-note mt-1 cursor-text text-sm text-muted"
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
        </div>
      </div>
    </OutlineProvider>
  );
}
