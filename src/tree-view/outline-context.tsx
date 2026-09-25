import { createContext, useContext } from 'react';
import type { Engine } from '@/commands';
import type { EditorSession } from '@/editor/session';
import type { SearchIndex } from '@/search';
import type { UiStore } from '@/store/ui-store';
import type { OutlineActions } from './actions';

export interface OutlineContextValue {
  engine: Engine;
  ui: UiStore;
  session: EditorSession;
  search: SearchIndex;
  actions: OutlineActions;
  rootId: string | null;
}

const OutlineContext = createContext<OutlineContextValue | null>(null);

export const OutlineProvider = OutlineContext.Provider;

export function useOutline(): OutlineContextValue {
  const v = useContext(OutlineContext);
  if (!v) throw new Error('useOutline: no OutlineProvider above this component');
  return v;
}
