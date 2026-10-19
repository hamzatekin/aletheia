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
import { HOME_LABEL, inSandbox } from '@/app/sandbox';
import { AgentButton, AgentPanel } from '@/agent/AgentPanel';
import type { AgentService } from '@/agent/service';
import { TutorialDialog } from '@/help/TutorialDialog';
import { SettingsPanel } from '@/settings/SettingsPanel';
import { SyncIndicator } from '@/settings/SyncIndicator';
import type { SyncService } from '@/sync/service';
import { useSettings, type SettingsStore } from '@/store/settings-store';
import { useUiStore, type UiStore } from '@/store/ui-store';
import { createOutlineActions } from './actions';
import { AddToInboxButton, AddToInboxTopButton } from './AddToInboxButton';
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
  agent?: AgentService | undefined;
}

/** Stand in for the AI panel's and sync's state when there are none (tests). */
const closedPanel = createStore(() => ({ open: false }));
const noSync = createStore(() => ({ key: null as string | null }));

/** `/` shows the top level; `/n/:id` zooms into a node. */
export function OutlinePage({ ui, session, search, settings, sync, ai, agent }: Props) {
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
    () => ({ engine, ui, session, search, actions, rootId, settings, ai }),
    [engine, ui, session, search, actions, rootId, settings, ai],
  );

  usePageEvents(actions, session, ui, settings);

  // A search belongs to the page it was typed on; zooming elsewhere leaves it.
  useEffect(() => () => ui.setFilter(null), [ui, rootId]);

  // AI questions start from the zoomed item...
  useEffect(() => agent?.setPageRoot(rootId), [agent, rootId]);

  // AI and Settings share the right side: opening one closes the other.
  useEffect(() => {
    if (!agent) return;
    const offAgent = agent.state.subscribe((s, prev) => {
      if (s.open && !prev.open) ui.setSettingsOpen(false);
    });
    const offUi = ui.subscribe((s, prev) => {
      if (s.settingsOpen && !prev.settingsOpen) agent.hide();
      // ...or the row you're on: the one you clicked into or selected.
      const row = s.focus?.id ?? s.selection?.head;
      if (row && row !== (prev.focus?.id ?? prev.selection?.head)) agent.setCurrentRow(row);
    });
    return () => {
      offAgent();
      offUi();
    };
  }, [agent, ui]);

  useEffect(() => {
    document.title = root && !missing ? plainText(root.content) || 'Untitled' : inSandbox ? HOME_LABEL : 'Aletheia';
  }, [root, missing]);

  const sidebarOpen = useSettings(settings, (s) => s.sidebarOpen);
  const settingsOpen = useUiStore(ui, (s) => s.settingsOpen);
  const aiOpen = useStore(agent?.state ?? closedPanel, (s) => s.open);
  const syncOn = useStore(sync?.state ?? noSync, (s) => s.key !== null);

  const onBackgroundMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    session.flush();
    ui.blur();
    ui.setSelection(null);
  };

  return (
    <OutlineProvider value={context}>
      <div className="app-shell" data-sidebar={sidebarOpen ? 'open' : 'closed'} data-settings={settingsOpen ? 'open' : 'closed'} data-ai={aiOpen ? 'open' : 'closed'}>
        <TopBar />
        <OutlineSidebar settings={settings} />
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
        <AddToInboxTopButton syncOn={syncOn} />
        <SettingsPanel settings={settings} ui={ui} sync={sync} />
        <TutorialDialog ui={ui} />
        {agent && <AgentButton agent={agent} />}
        {agent && <AgentPanel agent={agent} />}
        {ai && <AiNotice ai={ai} />}
        <div className="desk min-h-screen" onMouseDown={onBackgroundMouseDown}>
          <main className="book-page" onMouseDown={onBackgroundMouseDown}>
            <PageResizeHandles settings={settings} />
            <FilterBar />
            {rootId !== null && <Breadcrumbs rootId={rootId} />}
            {rootId === null && <HomeTitle />}
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
        <AddToInboxButton />
        <MobileToolbar />
        <SelectionBar />
      </div>
    </OutlineProvider>
  );
}

/** Home's title, where a zoomed page has its own. The sandbox says it never syncs, so it never passes for the real notes. */
function HomeTitle() {
  return (
    <header className="mb-4" data-testid={inSandbox ? 'sandbox-header' : 'home-title'}>
      <h1 className="page-title font-normal tracking-tight">{HOME_LABEL}</h1>
      {inSandbox && (
        <p className="mt-1 text-sm text-muted">
          Only in this browser. It never syncs, so nothing here touches your notes.{' '}
          <a href="/" className="underline underline-offset-2 hover:text-ink">
            Back to my notes
          </a>
        </p>
      )}
    </header>
  );
}
