import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/literata';
import './index.css';
import { App } from './App';
import { bootstrap } from './app/bootstrap';
import { EditorSession } from './editor/session';
import { SearchIndex } from './search';
import { applySettings, createSettingsStore, loadSettings } from './store/settings-store';
import { createUiStore } from './store/ui-store';
import './editor/default-slash-commands';

// Loading from IndexedDB takes a few ms; render once, with data, no spinner.
const engine = await bootstrap();
const ui = createUiStore();
const session = new EditorSession(engine);
const search = new SearchIndex(engine);
// On narrow screens the sidebar would cover the page, so start with it hidden (without saving that).
const saved = loadSettings();
const settings = createSettingsStore({ ...saved, sidebarOpen: saved.sidebarOpen && window.innerWidth >= 1024 });
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const apply = () => applySettings(settings.getState(), document.documentElement, darkQuery.matches);
apply();
settings.subscribe(apply);
darkQuery.addEventListener('change', apply);
if (import.meta.env.DEV) {
  // Test hook: Playwright drives the engine directly to build large trees.
  (window as unknown as { __aletheia: unknown }).__aletheia = { engine, ui, session, search, settings };
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App engine={engine} ui={ui} session={session} search={search} settings={settings} />
  </StrictMode>,
);
