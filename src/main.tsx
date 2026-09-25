import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { bootstrap } from './app/bootstrap';
import { EditorSession } from './editor/session';
import { SearchIndex } from './search';
import { createUiStore } from './store/ui-store';
import './editor/default-slash-commands';

// Loading from IndexedDB takes a few ms; render once, with data, no spinner.
const engine = await bootstrap();
const ui = createUiStore();
const session = new EditorSession(engine);
const search = new SearchIndex(engine);
if (import.meta.env.DEV) {
  // Test hook: Playwright drives the engine directly to build large trees.
  (window as unknown as { __aletheia: unknown }).__aletheia = { engine, ui, session, search };
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App engine={engine} ui={ui} session={session} search={search} />
  </StrictMode>,
);
