import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/literata';
import './index.css';
import { App } from './App';
import { httpComplete } from './ai/client';
import { registerAiSlashCommands } from './ai/slash-commands';
import { createAiService } from './ai/service';
import { bootstrap } from './app/bootstrap';
import { createRelatedService } from './related/service';
import { EditorSession } from './editor/session';
import { SearchIndex } from './search';
import { applySettings, createSettingsStore, loadSettings } from './store/settings-store';
import { createUiStore } from './store/ui-store';
import './editor/default-slash-commands';
import { DexieRepository } from './persistence';
import { httpSyncApi, SyncService } from './sync/service';
import { tabLock, takeKeyFromLocation, watchBrowser } from './sync/browser';
import { createClock } from './sync/clock';
import { connectTabs } from './sync/tabs';

// Loading from IndexedDB takes a few ms; render once, with data, no spinner.
const repository = new DexieRepository();
// Edits are stamped by this clock, which never runs behind a change it has seen.
const clock = createClock();
const engine = await bootstrap(repository, clock.now);
for (const n of engine.tree.all()) clock.observe(n.updatedAt);
const ui = createUiStore();
const session = new EditorSession(engine);
const search = new SearchIndex(engine);
const sync = new SyncService(engine, repository, httpSyncApi(), {
  clock,
  lock: tabLock(),
  afterReplace: () => {
    ui.blur();
    search.rebuild();
  },
  // Save the row being typed in before a pulled change to it lands, so the typing is not lost.
  beforeApply: (ids) => {
    if (session.nodeId !== null && ids.includes(session.nodeId)) session.flush();
  },
});
await sync.start();
sync.setPendingJoin(takeKeyFromLocation());
watchBrowser(sync);
connectTabs(engine, sync);
const syncKey = () => sync.state.getState().key;
const complete = httpComplete();
const ai = createAiService({ engine, session, key: syncKey, complete });
const related = createRelatedService({ engine, session, search, key: syncKey, complete });
registerAiSlashCommands(ai);
// On narrow screens the sidebar would cover the page, so start with it hidden (without saving that).
const saved = loadSettings();
const settings = createSettingsStore({ ...saved, sidebarOpen: saved.sidebarOpen && window.innerWidth >= 1024 });
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
const apply = () => {
  applySettings(settings.getState(), document.documentElement, darkQuery.matches);
  // The phone's status bar (installed app) matches the page's background.
  if (themeColor) themeColor.content = getComputedStyle(document.body).backgroundColor;
};
apply();
settings.subscribe(apply);
darkQuery.addEventListener('change', apply);
if (import.meta.env.DEV) {
  // Test hook: Playwright drives the engine directly to build large trees.
  (window as unknown as { __aletheia: unknown }).__aletheia = { engine, ui, session, search, settings, sync, ai, related };
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App engine={engine} ui={ui} session={session} search={search} settings={settings} sync={sync} ai={ai} related={related} />
  </StrictMode>,
);
// Installed app (PWA): lets it open offline. See pwa/sw.js.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
}
