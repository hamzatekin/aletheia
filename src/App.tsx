import { BrowserRouter, Route, Routes } from 'react-router';
import type { AiService } from '@/ai/service';
import type { Engine } from '@/commands';
import { CaptureRoute } from '@/app/CaptureRoute';
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
  ai?: AiService;
}

export function App({ engine, ui, session, search, settings, sync, ai }: Props) {
  const page = <OutlinePage ui={ui} session={session} search={search} settings={settings} sync={sync} ai={ai} />;
  return (
    <EngineProvider value={engine}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={page} />
          <Route path="/n/:id" element={page} />
          <Route path="/share" element={<CaptureRoute ui={ui} mode="share" />} />
          <Route path="/capture" element={<CaptureRoute ui={ui} mode="capture" />} />
        </Routes>
      </BrowserRouter>
    </EngineProvider>
  );
}
