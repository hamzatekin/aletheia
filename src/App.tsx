import { BrowserRouter, Route, Routes } from 'react-router';
import type { Engine } from '@/commands';
import { EngineProvider } from '@/app/engine-context';
import { OutlinePage } from '@/tree-view/OutlinePage';

export function App({ engine }: { engine: Engine }) {
  return (
    <EngineProvider value={engine}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<OutlinePage />} />
          <Route path="/n/:id" element={<OutlinePage />} />
        </Routes>
      </BrowserRouter>
    </EngineProvider>
  );
}
