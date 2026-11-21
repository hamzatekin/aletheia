import { createContext, useContext, type Accessor } from 'solid-js';
import type { AiService } from '@/ai/service';
import type { Engine } from '@/commands';
import type { EditorSession } from '@/editor/session';
import type { SearchIndex } from '@/search';
import type { SettingsStore } from '@/store/settings-store';
import type { UiStore } from '@/store/ui-store';
import type { Navigate } from '@/app/routing';
import type { OutlineActions } from './actions';

interface OutlineContextValue {
  engine: Engine;
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
  actions: OutlineActions;
  /** The zoomed-in node (null: the top level). The page stays mounted while it changes. */
  rootId: Accessor<string | null>;
  settings: SettingsStore;
  /** Goes to another page; zooming in or out animates (zoom-transition.ts). */
  navigate: Navigate;
  ai: AiService;
}

/** Provided by OutlinePage (`<OutlineContext value={...}>`). */
export const OutlineContext = createContext<OutlineContextValue>();

export function useOutline(): OutlineContextValue {
  return useContext(OutlineContext);
}
