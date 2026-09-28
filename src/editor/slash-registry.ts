import type { NavigateFunction } from 'react-router';
import type { Engine } from '@/commands';
import type { SearchIndex } from '@/search';
import type { UiStore } from '@/store/ui-store';
import type { EditorSession } from './session';

/** Everything a slash command may act on. */
export interface SlashContext {
  engine: Engine;
  session: EditorSession;
  ui: UiStore;
  search: SearchIndex;
  navigate: NavigateFunction;
  rootId: string | null;
  /** The node whose editor the menu was opened from. */
  nodeId: string;
}

export interface SlashCommand {
  id: string;
  title: string;
  /** Extra words the filter matches on. */
  keywords?: string;
  /** Section label shown in the menu. */
  group?: string;
  /** Hide the command when this returns false (e.g. AI while sync is off). */
  available?(): boolean;
  run(ctx: SlashContext): void | Promise<void>;
}

const registry: SlashCommand[] = [];

/** Plug in a command. Future commands (including AI) register the same way. */
export function registerSlashCommand(command: SlashCommand): () => void {
  registry.push(command);
  return () => {
    const i = registry.indexOf(command);
    if (i >= 0) registry.splice(i, 1);
  };
}

export function slashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  const shown = registry.filter((c) => c.available?.() ?? true);
  if (q === '') return shown;
  return shown.filter((c) => `${c.title} ${c.keywords ?? ''}`.toLowerCase().includes(q));
}
