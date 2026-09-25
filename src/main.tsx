import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { bootstrap } from './app/bootstrap';

// Loading from IndexedDB takes a few ms; render once, with data, no spinner.
const engine = await bootstrap();
if (import.meta.env.DEV) {
  // Test hook: Playwright drives the engine directly to build large trees.
  (window as unknown as { __aletheia: unknown }).__aletheia = engine;
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App engine={engine} />
  </StrictMode>,
);
