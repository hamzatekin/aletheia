import { createContext, useContext } from 'solid-js';
import type { Engine } from '@/commands';

/** The command engine, provided once at the top of the app (`<EngineContext value={engine}>`). */
export const EngineContext = createContext<Engine>();

export function useEngine(): Engine {
  return useContext(EngineContext);
}
