import { useEffect, useMemo, type MouseEvent } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { Link, useNavigate, useParams } from 'react-router';
import { AiNotice } from '@/ai/AiNotice';
import type { AiService } from '@/ai/service';
import type { Engine } from '@/commands';
import { plainText } from '@/editor/markdown';
import type { EditorSession } from '@/editor/session';
import type { SearchIndex } from '@/search';
import { SearchPalette } from '@/search/SearchPalette';
import { FilterBar } from '@/search/FilterBar';
import { useEngine } from '@/app/engine-context';
import { RelatedButton, RelatedPanel } from '@/related/RelatedPanel';
import type { RelatedService } from '@/related/service';
import { TutorialDialog } from '@/help/TutorialDialog';
import { SettingsPanel } from '@/settings/SettingsPanel';
import { SyncIndicator } from '@/settings/SyncIndicator';
import type { SyncService } from '@/sync/service';
import { useSettings, type SettingsStore } from '@/store/settings-store';
import { useUiStore, type UiStore } from '@/store/ui-store';
import { createOutlineActions } from './actions';
import { Breadcrumbs } from './Breadcrumbs';
import { Outline } from './Outline';
import { TopBar } from './TopBar';
import { MobileToolbar, SelectionBar } from './MobileToolbar';
import { OutlineProvider } from './outline-context';
import { OutlineSidebar, SidebarIcon } from './OutlineSidebar';
import { PageResizeHandles } from './PageResizeHandles';
import { PageTitle } from './PageTitle';
import { PageToolbar } from './PageToolbar';
import { useNode } from './use-outline';
import { usePageEvents } from './use-page-events';

interface Props {
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
  settings: SettingsStore;
  sync?: SyncService | undefined;
  ai?: AiService | undefined;
  related?: RelatedService | undefined;
}

/** Stands in for the Related panel's state when there is none (tests). */
const closedPanel = createStore(() => ({ open: false }));

/** `/` shows the top level; `/n/:id` zooms into a node. */
export function OutlinePage({ ui, session, search, settings, sync, ai, related }: Props) {
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
    () => ({ engine, ui, session, search, actions, rootId, ai, related }),
    [engine, ui, session, search, actions, rootId, ai, related],
  );

  usePageEvents(actions, session, ui, settings);

  // A search belongs to the page it was typed on; zooming elsewhere leaves it.
  useEffect(() => () => ui.setFilter(null), [ui, rootId]);

  // The Related panel follows the zoomed item.
  useEffect(() => related?.setPageRoot(rootId), [related, rootId]);

  // Related and Settings share the right side: opening one closes the other.
  useEffect(() => {
    if (!related) return;
    const offRelated = related.state.subscribe((s, prev) => {
      if (s.open && !prev.open) ui.setSettingsOpen(false);
    });
    const offUi = ui.subscribe((s, prev) => {
      if (s.settingsOpen && !prev.settingsOpen) related.hide();
      // The panel is about the row you're on: the one you clicked into or selected.
      const row = s.focus?.id ?? s.selection?.head;
      if (row && row !== (prev.focus?.id ?? prev.selection?.head)) related.setCurrentRow(row);
    });
    return () => {
      offRelated();
      offUi();
    };
  }, [related, ui]);

  useEffect(() => {
    document.title = root && !missing ? plainText(root.content) || 'Untitled' : 'Aletheia';
  }, [root, missing]);

  const sidebarOpen = useSettings(settings, (s) => s.sidebarOpen);
  const settingsOpen = useUiStore(ui, (s) => s.settingsOpen);
  const relatedOpen = useStore(related?.state ?? closedPanel, (s) => s.open);

  const onBackgroundMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    session.flush();
    ui.blur();
    ui.setSelection(null);
  };

  return (
    <OutlineProvider value={context}>
      <div className="app-shell" data-sidebar={sidebarOpen ? 'open' : 'closed'} data-settings={settingsOpen ? 'open' : 'closed'} data-related={relatedOpen ? 'open' : 'closed'}>
        <TopBar />
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
        <PageToolbar />
        {sync && <SyncIndicator sync={sync} />}
        <SettingsPanel settings={settings} ui={ui} sync={sync} />
        <TutorialDialog ui={ui} />
        {related && <RelatedButton related={related} />}
        {related && <RelatedPanel related={related} />}
        {ai && <AiNotice ai={ai} />}
        <div className="desk min-h-screen" onMouseDown={onBackgroundMouseDown}>
          <main className="book-page" onMouseDown={onBackgroundMouseDown}>
            <PageResizeHandles settings={settings} />
            <FilterBar />
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
                {root && rootId !== null && <PageTitle rootId={rootId} root={root} />}
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
