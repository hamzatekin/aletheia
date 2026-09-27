import { slashCommands } from '@/editor/slash-registry';
import type { ActionContext } from './context';

/** The "/" command menu inside the editor. */
export function slashActions(ctx: ActionContext) {
  const { engine, ui, session, search, rootId, navigate } = ctx;

  const closeSlash = () => ui.setSlash(null);

  const syncSlash = () => {
    const slash = ui.getState().slash;
    if (!slash) return;
    const text = session.textFrom(slash.from);
    if (text === null || !text.startsWith('/') || text.includes('/', 1)) return closeSlash();
    const query = text.slice(1);
    if (query !== slash.query) ui.setSlash({ from: slash.from, query, index: 0 });
  };

  const runSlash = (index: number) => {
    const slash = ui.getState().slash;
    const focus = ui.getState().focus;
    if (!slash || !focus) return;
    const item = slashCommands(slash.query)[index];
    closeSlash();
    if (!item) return;
    session.deleteRange(slash.from, session.caretPos());
    void item.run({ engine, session, ui, search, navigate, rootId, nodeId: focus.id });
  };

  return { closeSlash, syncSlash, runSlash };
}

export type SlashActions = ReturnType<typeof slashActions>;
