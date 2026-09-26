import { BrowserRouter, Route, Routes } from 'react-router';
import type { Engine } from '@/commands';
import { EngineProvider } from '@/app/engine-context';
import type { EditorSession } from '@/editor/session';
import type { SearchIndex } from '@/search';
import type { SettingsStore } from '@/store/settings-store';
import type { SyncService } from '@/sync/service';
import type { UiStore } from '@/store/ui-store';
import { OutlinePage } from '@/tree-view/OutlinePage';

interface Props {
  engine: Engine;
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
  settings: SettingsStore;
  sync?: SyncService;
}

export function App({ engine, ui, session, search, settings, sync }: Props) {
  const page = <OutlinePage ui={ui} session={session} search={search} settings={settings} sync={sync} />;
  return (
    <EngineProvider value={engine}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={page} />
          <Route path="/n/:id" element={page} />
        </Routes>
      </BrowserRouter>
    </EngineProvider>
  );
}
