import { createEffect, onSettled, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { createStore } from 'zustand/vanilla';
import { AiNotice } from '@/ai/AiNotice';
import type { AiService } from '@/ai/service';
import type { Engine } from '@/commands';
import { plainText } from '@/editor/markdown';
import type { EditorSession } from '@/editor/session';
import type { SearchIndex } from '@/search';
import { SearchPalette } from '@/search/SearchPalette';
import { FilterBar } from '@/search/FilterBar';
import { useEngine } from '@/app/engine-context';
import { appPath, useAppNavigate } from '@/app/routing';
import { HOME_LABEL, inSandbox } from '@/app/sandbox';
import { AgentButton, AgentPanel } from '@/agent/AgentPanel';
import type { AgentService } from '@/agent/service';
import { TutorialDialog } from '@/help/TutorialDialog';
import { SettingsPanel } from '@/settings/SettingsPanel';
import { SyncIndicator } from '@/settings/SyncIndicator';
import type { SyncService } from '@/sync/service';
import { useSettings, type SettingsStore } from '@/store/settings-store';
import { useUiStore, type UiStore } from '@/store/ui-store';
import { useStoreValue } from '@/ui/store';
import { createOutlineActions } from './actions';
import { AddToInboxButton, AddToInboxTopButton } from './AddToInboxButton';
import { Breadcrumbs } from './Breadcrumbs';
import { Outline } from './Outline';
import { TopBar } from './TopBar';
import { MobileToolbar, SelectionBar } from './MobileToolbar';
import { OutlineContext } from './outline-context';
import { OutlineSidebar, SidebarIcon } from './OutlineSidebar';
import { PageResizeHandles } from './PageResizeHandles';
import { PageTitle } from './PageTitle';
import { PageToolbar } from './PageToolbar';
import { useNode } from './use-outline';
import { usePageEvents } from './use-page-events';
import { zoomingNavigate } from './zoom-transition';
import { VoiceButton, VoiceSheet } from '@/voice/VoiceButton';
import type { VoiceService } from '@/voice/service';

interface Props {
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
  settings: SettingsStore;
  sync?: SyncService | undefined;
  ai: AiService;
  agent: AgentService;
  voice: VoiceService;
}

/** Stands in for sync's state in the sandbox, which has no sync. */
const noSync = createStore(() => ({ key: null as string | null }));

/** `/` shows the top level; `/n/:id` zooms into a node. The router keeps this mounted while you zoom, so `rootId` changes under it. */
export function OutlinePage(props: Props) {
  const engine: Engine = useEngine();
  const params = useParams<{ id?: string }>();
  const rootId = (): string | null => params.id ?? null;
  const root = useNode(rootId);
  const navigate = zoomingNavigate(useAppNavigate(), engine.tree, rootId);
  const missing = () => {
    const r = root();
    return rootId() !== null && (!r || r.deletedAt !== null);
  };

  const actions = createOutlineActions({ engine, ui: props.ui, session: props.session, rootId, navigate, settings: props.settings });
  const context = { engine, ui: props.ui, session: props.session, search: props.search, actions, rootId, settings: props.settings, ai: props.ai, navigate };

  usePageEvents(actions, props.session, props.ui, props.settings);

  // A search belongs to the page it was typed on; zooming elsewhere leaves it.
  createEffect(rootId, () => () => props.ui.setFilter(null));

  // AI questions start from the zoomed item...
  createEffect(rootId, (id) => {
    props.agent.setPageRoot(id);
  });

  // AI and Settings share the right side: opening one closes the other.
  onSettled(() => {
    const { agent, ui } = props;
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
  });

  createEffect(
    () => {
      const r = root();
      return r && !missing() ? plainText(r.content) || 'Untitled' : inSandbox ? HOME_LABEL : 'Aletheia';
    },
    (title) => {
      document.title = title;
    },
  );

  const sidebarOpen = useSettings(props.settings, (s) => s.sidebarOpen);
  const settingsOpen = useUiStore(props.ui, (s) => s.settingsOpen);
  const aiOpen = useStoreValue(props.agent.state, (s) => s.open);
  const syncOn = useStoreValue(props.sync?.state ?? noSync, (s) => s.key !== null);

  const onBackgroundMouseDown = (e: MouseEvent & { currentTarget: HTMLElement; target: Element }) => {
    if (e.target !== e.currentTarget) return;
    props.session.flush();
    props.ui.blur();
    props.ui.setSelection(null);
  };

  return (
    <OutlineContext value={context}>
      <div class="app-shell" data-sidebar={sidebarOpen() ? 'open' : 'closed'} data-settings={settingsOpen() ? 'open' : 'closed'} data-ai={aiOpen() ? 'open' : 'closed'}>
        <TopBar />
        <OutlineSidebar settings={props.settings} />
        <Show when={!sidebarOpen()}>
          <button
            type="button"
            onClick={() => props.settings.getState().update({ sidebarOpen: true })}
            class="fixed top-3 left-3 z-30 rounded-md p-2 text-muted hover:bg-hover hover:text-ink"
            aria-label="Show outline"
            title="Show outline (Ctrl+\)"
          >
            <SidebarIcon />
          </button>
        </Show>
        <PageToolbar />
        <Show when={props.sync} keyed>{(sync) => <SyncIndicator sync={sync} />}</Show>
        <AddToInboxTopButton syncOn={syncOn()} />
        <SettingsPanel settings={props.settings} ui={props.ui} sync={props.sync} />
        <TutorialDialog ui={props.ui} />
        <AgentButton agent={props.agent} />
        <AgentPanel agent={props.agent} />
        <AiNotice ai={props.ai} />
        <div class="desk min-h-screen" onMouseDown={onBackgroundMouseDown}>
          <main class="book-page" onMouseDown={onBackgroundMouseDown}>
            <PageResizeHandles settings={props.settings} />
            <FilterBar />
            <Show when={rootId()}>{(id) => <Breadcrumbs rootId={id()} />}</Show>
            <Show when={rootId() === null}>
              <HomeTitle />
            </Show>
            <Show
              when={!missing()}
              fallback={
                <div class="text-muted">
                  This node does not exist.{' '}
                  <a href={appPath('/')} noscroll class="underline">
                    Go home
                  </a>
                </div>
              }
            >
              <Show when={root()}>{(r) => <PageTitle root={r()} />}</Show>
              <Outline rootId={rootId()} />
            </Show>
            <SearchPalette />
          </main>
        </div>
        <AddToInboxButton />
        <VoiceButton voice={props.voice} />
        <VoiceSheet voice={props.voice} />
        <MobileToolbar />
        <SelectionBar />
      </div>
    </OutlineContext>
  );
}

/** Home's title, where a zoomed page has its own. The sandbox says it never syncs, so it never passes for the real notes. */
function HomeTitle() {
  return (
    <header class="mb-4" data-testid={inSandbox ? 'sandbox-header' : 'home-title'}>
      <h1 class="page-title font-normal tracking-tight">{HOME_LABEL}</h1>
      {inSandbox && (
        <p class="mt-1 text-sm text-muted">
          Only in this browser. It never syncs, so nothing here touches your notes.{' '}
          <a href="/" class="underline underline-offset-2 hover:text-ink">
            Back to my notes
          </a>
        </p>
      )}
    </header>
  );
}
