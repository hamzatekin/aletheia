import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { bootstrap } from './app/bootstrap';
import { EditorSession } from './editor/session';
import { createUiStore } from './store/ui-store';

// Loading from IndexedDB takes a few ms; render once, with data, no spinner.
const engine = await bootstrap();
const ui = createUiStore();
const session = new EditorSession(engine);
if (import.meta.env.DEV) {
  // Test hook: Playwright drives the engine directly to build large trees.
  (window as unknown as { __aletheia: unknown }).__aletheia = { engine, ui, session };
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App engine={engine} ui={ui} session={session} />
  </StrictMode>,
);
