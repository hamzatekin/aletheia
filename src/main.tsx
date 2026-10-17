import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/literata';
import './index.css';
import { App } from './App';
import { httpComplete, httpStep } from './ai/client';
import { registerAiSlashCommands } from './ai/slash-commands';
import { createAiService } from './ai/service';
import { bootstrap } from './app/bootstrap';
import { liftCaptureTitles } from './app/capture';
import { inSandbox, mainSyncKey, sandboxDb } from './app/sandbox';
import { nameAllFromNotes, watchNameFromNote } from './editor/first-line';
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
// /sandbox is a second outline in its own database that starts blank and never syncs.
const repository = new DexieRepository(inSandbox ? sandboxDb() : undefined);
// Edits are stamped by this clock, which never runs behind a change it has seen.
const clock = createClock();
const engine = await bootstrap(repository, clock.now, !inSandbox);
for (const n of engine.tree.all()) clock.observe(n.updatedAt);
const ui = createUiStore();
const session = new EditorSession(engine);
const search = new SearchIndex(engine);
const sync = inSandbox
  ? undefined
  : new SyncService(engine, repository, httpSyncApi(), {
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
if (sync) {
  await sync.start();
  sync.setPendingJoin(takeKeyFromLocation());
  watchBrowser(sync);
}
connectTabs(engine, sync ?? null, inSandbox ? { channel: 'aletheia-sandbox-tabs' } : {});
// An item typed as one block takes its first line as its name when the caret leaves it
// (or, if the app was closed while in it, on the next start).
watchNameFromNote(engine, ui, session);
nameAllFromNotes(engine);
// Once per device: old quick adds, named with their date, take their note's first line as the name.
try {
  if (!inSandbox && localStorage.getItem('aletheia.liftedCaptureTitles') === null) {
    liftCaptureTitles(engine);
    localStorage.setItem('aletheia.liftedCaptureTitles', '1');
  }
} catch {
  // Storage blocked: skip it, the old names stay.
}
// The sandbox borrows the real notes' sync key for AI (read once; reopen it after turning sync on).
const sandboxKey = inSandbox ? await mainSyncKey() : null;
const syncKey = () => (sync ? sync.state.getState().key : sandboxKey);
const complete = httpComplete();
const ai = createAiService({ engine, session, key: syncKey, complete });
const related = createRelatedService({ engine, session, search, key: syncKey, complete, step: httpStep() });
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
