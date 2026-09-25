import { createContext, useContext } from 'react';
import type { Engine } from '@/commands';

const EngineContext = createContext<Engine | null>(null);

export const EngineProvider = EngineContext.Provider;

export function useEngine(): Engine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine: no EngineProvider above this component');
  return engine;
}
