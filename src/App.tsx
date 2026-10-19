import { BrowserRouter, Route, Routes } from 'react-router';
import type { AiService } from '@/ai/service';
import type { Engine } from '@/commands';
import { CaptureRoute } from '@/app/CaptureRoute';
import { PageRoute } from '@/app/PageRoute';
import { inSandbox, SANDBOX_PATH } from '@/app/sandbox';
import { EngineProvider } from '@/app/engine-context';
import type { EditorSession } from '@/editor/session';
import type { AgentService } from '@/agent/service';
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
  sync?: SyncService | undefined;
  ai: AiService;
  agent: AgentService;
}

export function App({ engine, ui, session, search, settings, sync, ai, agent }: Props) {
  const page = <OutlinePage ui={ui} session={session} search={search} settings={settings} sync={sync} ai={ai} agent={agent} />;
  return (
    <EngineProvider value={engine}>
      {/* In the sandbox every route sits under /sandbox, so links and navigate('/n/…') stay inside it. */}
      {/* Page changes render at once (no React transition), so zooming can animate them as a view transition (zoom-transition.ts). */}
      <BrowserRouter basename={inSandbox ? SANDBOX_PATH : '/'} useTransitions={false}>
        <Routes>
          <Route path="/" element={page} />
          <Route path="/n/:id" element={page} />
          <Route path="/share" element={<CaptureRoute ui={ui} mode="share" />} />
          <Route path="/capture" element={<CaptureRoute ui={ui} mode="capture" />} />
          <Route path="/p/:id" element={<PageRoute sync={sync} />} />
        </Routes>
      </BrowserRouter>
    </EngineProvider>
  );
}
