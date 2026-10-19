import { createContext, useContext } from 'react';
import type { AiService } from '@/ai/service';
import type { Engine } from '@/commands';
import type { EditorSession } from '@/editor/session';
import type { SearchIndex } from '@/search';
import type { SettingsStore } from '@/store/settings-store';
import type { UiStore } from '@/store/ui-store';
import type { NavigateFunction } from 'react-router';
import type { OutlineActions } from './actions';

export interface OutlineContextValue {
  engine: Engine;
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
  actions: OutlineActions;
  rootId: string | null;
  settings: SettingsStore;
  /** Goes to another page; zooming in or out animates (zoom-transition.ts). */
  navigate: NavigateFunction;
  /** AI actions; missing in tests that render the page without them. */
  ai?: AiService | undefined;
}

const OutlineContext = createContext<OutlineContextValue | null>(null);

export const OutlineProvider = OutlineContext.Provider;

export function useOutline(): OutlineContextValue {
  const v = useContext(OutlineContext);
  if (!v) throw new Error('useOutline: no OutlineProvider above this component');
  return v;
}
