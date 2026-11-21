import { createRouter } from '@solidjs/router';
import type { AiService } from '@/ai/service';
import type { Engine } from '@/commands';
import { CaptureRoute } from '@/app/CaptureRoute';
import { PageRoute } from '@/app/PageRoute';
import { inSandbox, SANDBOX_PATH } from '@/app/sandbox';
import { EngineContext } from '@/app/engine-context';
import type { EditorSession } from '@/editor/session';
import type { AgentService } from '@/agent/service';
import type { SearchIndex } from '@/search';
import type { SettingsStore } from '@/store/settings-store';
import type { SyncService } from '@/sync/service';
import type { UiStore } from '@/store/ui-store';
import { OutlinePage } from '@/tree-view/OutlinePage';
import type { VoiceService } from '@/voice/service';

interface Props {
  engine: Engine;
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
  settings: SettingsStore;
  sync?: SyncService | undefined;
  ai: AiService;
  agent: AgentService;
  voice: VoiceService;
}

export function App(props: Props) {
  const Page = () => (
    <OutlinePage ui={props.ui} session={props.session} search={props.search} settings={props.settings} sync={props.sync} ai={props.ai} agent={props.agent} voice={props.voice} />
  );
  const Router = createRouter({
    // In the sandbox every route sits under /sandbox; links and navigate add it through appPath (app/routing.ts).
    ...(inSandbox ? { base: SANDBOX_PATH } : {}),
    routes: [
      // One route for Home and zoomed pages: the page stays mounted while you zoom, as it did before.
      { path: ['/', '/n/:id'], component: Page },
      { path: '/share', component: () => <CaptureRoute ui={props.ui} mode="share" /> },
      { path: '/capture', component: () => <CaptureRoute ui={props.ui} mode="capture" /> },
      { path: '/p/:id', component: () => <PageRoute sync={props.sync} /> },
    ],
  });
  return (
    <EngineContext value={props.engine}>
      <Router>{(router) => router.children}</Router>
    </EngineContext>
  );
}
