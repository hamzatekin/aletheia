import { opensSlashMenu, slashCommands } from '@/editor/slash-registry';
import type { ActionContext } from './context';

/** The "/" command menu inside a node's text. */
export function slashActions(ctx: ActionContext) {
  const { engine, ui, session } = ctx;

  const closeSlash = () => ui.setSlash(null);

  /** A "/" was just typed before the caret: open the menu if it starts a command. */
  const openSlash = () => {
    const from = session.caretPos() - 1;
    if (!ui.getState().slash && opensSlashMenu(session.editor, from)) ui.setSlash({ from, query: '', index: 0 });
  };

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
    const item = slashCommands(slash.query, 'content')[index];
    closeSlash();
    if (!item) return;
    session.deleteRange(slash.from, session.caretPos());
    void item.run({ engine, editor: session.editor, field: 'content', nodeId: focus.id });
  };

  return { closeSlash, openSlash, syncSlash, runSlash };
}

export type SlashActions = ReturnType<typeof slashActions>;
