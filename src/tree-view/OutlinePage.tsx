import { useEffect, useMemo, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { hasOpenParent, type Engine } from '@/commands';
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
import type { SyncService } from '@/sync/service';
import { useSettings, type SettingsStore } from '@/store/settings-store';
import { useUiStore, type UiStore } from '@/store/ui-store';
import { createOutlineActions } from './actions';
import { Breadcrumbs } from './Breadcrumbs';
import { Outline } from './Outline';
import { MobileToolbar, SelectionBar } from './MobileToolbar';
import { CLIP_TYPE } from '@/io/clipboard';
import { OutlineProvider } from './outline-context';
import { OutlineSidebar, SidebarIcon } from './OutlineSidebar';
import { PageResizeHandles } from './PageResizeHandles';
import { useNode, useVisibleRows } from './use-outline';

interface Props {
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
  settings: SettingsStore;
  sync?: SyncService | undefined;
}

/** `/` shows the top level; `/n/:id` zooms into a node. */
export function OutlinePage({ ui, session, search, settings, sync }: Props) {
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

  // Ctrl+C / Ctrl+X / Ctrl+V on selected nodes. Nothing is focused then, so the events land on the page.
  useEffect(() => {
    const inField = (e: Event) => (e.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]') != null;
    const onCopy = (cut: boolean) => (e: ClipboardEvent) => {
      if (inField(e) || !e.clipboardData) return;
      if (actions.copySelection(e.clipboardData, cut)) e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (inField(e) || !e.clipboardData) return;
      if (actions.pasteIntoSelection(e.clipboardData.getData('text/plain'), e.clipboardData.getData(CLIP_TYPE) || null)) e.preventDefault();
    };
    const copy = onCopy(false);
    const cut = onCopy(true);
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', onPaste);
    };
  }, [actions]);

  // Dragging with the mouse from one row into others selects whole rows, as in WorkFlowy.
  useEffect(() => {
    let start: string | null = null;
    let active = false;
    const rowAt = (x: number, y: number): string | null => {
      const row = document.elementFromPoint(x, y)?.closest('[data-node-id]:not([data-title])');
      return row instanceof HTMLElement ? (row.dataset.nodeId ?? null) : null;
    };
    const onDown = (e: globalThis.MouseEvent) => {
      start = null;
      active = false;
      if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
      const t = e.target as Element;
      if (!t.closest?.('.row-text') || t.closest('a, button')) return;
      start = rowAt(e.clientX, e.clientY);
    };
    const onMove = (e: globalThis.MouseEvent) => {
      if (start === null) return;
      if ((e.buttons & 1) === 0) {
        start = null;
        return;
      }
      const over = rowAt(e.clientX, e.clientY);
      if (over === null || (!active && over === start)) return;
      active = true;
      document.getSelection()?.removeAllRanges();
      const sel = ui.getState().selection;
      if (sel?.anchor !== start || sel.head !== over || ui.getState().focus) actions.selectRange(start, over);
    };
    const onUp = () => {
      start = null;
      active = false;
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [actions, ui]);

  useEffect(() => {
    document.title = root && !missing ? plainText(root.content) || 'Untitled' : 'Aletheia';
  }, [root, missing]);

  // Visible rows change whenever a parent opens or closes, so this follows every toggle.
  const pageRows = useVisibleRows(rootId);
  const anyOpen = useMemo(() => hasOpenParent(engine.tree, rootId), [engine, rootId, pageRows]); // eslint-disable-line react-hooks/exhaustive-deps
  const anyParent = pageRows.some((r) => engine.tree.children(r.id).length > 0);

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
          onClick={() => actions.toggleAll()}
          onMouseDown={(e) => e.preventDefault()}
          disabled={!anyParent}
          className="fixed top-3 right-33 z-40 flex size-[34px] items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink disabled:opacity-40"
          aria-label={anyOpen ? 'Collapse all' : 'Expand all'}
          title={(anyOpen ? 'Collapse all' : 'Expand all') + ' (Ctrl+Shift+.)'}
          data-testid="toggle-all"
          data-state={anyOpen ? 'open' : 'collapsed'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {anyOpen ? <path d="m7 20 5-5 5 5M7 4l5 5 5-5" /> : <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />}
          </svg>
        </button>
        <button
          type="button"
          onClick={() => {
            session.flush();
            ui.blur();
            ui.setSearchOpen(true);
          }}
          className="fixed top-3 right-23 z-40 flex size-[34px] items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
          aria-label="Find"
          title="Search (Ctrl+K)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4.2-4.2" />
          </svg>
        </button>
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
        <SettingsPanel settings={settings} sync={sync} />
        <TutorialDialog ui={ui} />
        <div className="desk min-h-screen" onMouseDown={onBackgroundMouseDown}>
          <main className="book-page" onMouseDown={onBackgroundMouseDown}>
            <PageResizeHandles settings={settings} />
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
        <MobileToolbar />
        <SelectionBar />
      </div>
    </OutlineProvider>
  );
}
