import { useEffect, useMemo, type MouseEvent } from 'react';
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
import { TutorialDialog } from '@/help/TutorialDialog';
import { SettingsPanel } from '@/settings/SettingsPanel';
import { SyncIndicator } from '@/settings/SyncIndicator';
import type { SyncService } from '@/sync/service';
import { useSettings, type SettingsStore } from '@/store/settings-store';
import { useUiStore, type UiStore } from '@/store/ui-store';
import { createOutlineActions } from './actions';
import { Breadcrumbs } from './Breadcrumbs';
import { Outline } from './Outline';
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
}

/** `/` shows the top level; `/n/:id` zooms into a node. */
export function OutlinePage({ ui, session, search, settings, sync, ai }: Props) {
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
    () => ({ engine, ui, session, search, actions, rootId, ai }),
    [engine, ui, session, search, actions, rootId, ai],
  );

  usePageEvents(actions, session, ui, settings);

  // A search belongs to the page it was typed on; zooming elsewhere leaves it.
  useEffect(() => () => ui.setFilter(null), [ui, rootId]);

  useEffect(() => {
    document.title = root && !missing ? plainText(root.content) || 'Untitled' : 'Aletheia';
  }, [root, missing]);

  const sidebarOpen = useSettings(settings, (s) => s.sidebarOpen);
  const settingsOpen = useUiStore(ui, (s) => s.settingsOpen);

  const onBackgroundMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    session.flush();
    ui.blur();
    ui.setSelection(null);
  };

  return (
    <OutlineProvider value={context}>
      <div className="app-shell" data-sidebar={sidebarOpen ? 'open' : 'closed'} data-settings={settingsOpen ? 'open' : 'closed'}>
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
