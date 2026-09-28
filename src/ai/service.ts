import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Engine } from '@/commands';
import type { EditorSession } from '@/editor/session';
import { AiError, type Complete } from './client';
import { cleanTitle, titlePrompt } from './suggest-title';

/** What the AI notice at the top of the page shows. */
export interface AiNotice {
  kind: 'busy' | 'done' | 'error';
  text: string;
  /** A button next to the text (Undo, or Use when the row changed meanwhile). */
  action?: { label: string; run(): void };
}

export interface AiState {
  notice: AiNotice | null;
  /** Nodes waiting for an answer. */
  busy: ReadonlySet<string>;
}

export interface AiService {
  readonly state: StoreApi<AiState>;
  /** Whether AI can be used here: the Worker only answers devices with sync on. */
  available(): boolean;
  /** Ask AI for a title from the node's note and children, and put it in the row (undoable). */
  suggestTitle(id: string): Promise<void>;
  dismiss(): void;
}

interface Deps {
  engine: Engine;
  session: EditorSession;
  /** This device's sync key, or null when sync is off. */
  key(): string | null;
  complete: Complete;
}

/** How long a finished notice stays up. Errors stay until dismissed. */
const DONE_MS = 8_000;

export function createAiService({ engine, session, key, complete }: Deps): AiService {
  const state = createStore<AiState>(() => ({ notice: null, busy: new Set() }));
  let timer: ReturnType<typeof setTimeout> | null = null;

  const show = (notice: AiNotice | null) => {
    if (timer) clearTimeout(timer);
    timer = notice?.kind === 'done' ? setTimeout(() => state.setState({ notice: null }), DONE_MS) : null;
    state.setState({ notice });
  };
  const setBusy = (id: string, on: boolean) => {
    const busy = new Set(state.getState().busy);
    if (on) busy.add(id);
    else busy.delete(id);
    state.setState({ busy });
  };
  const setContent = (id: string, content: string) => {
    session.flush();
    if (engine.tree.get(id)) engine.execute({ type: 'updateContent', id, content });
  };

  return {
    state,
    available: () => key() !== null,
    dismiss: () => show(null),
    async suggestTitle(id) {
      const k = key();
      if (!k) return show({ kind: 'error', text: 'Turn on sync in Settings to use AI on this device.' });
      if (state.getState().busy.has(id)) return;
      session.flush();
      const prompt = titlePrompt(engine.tree, id);
      if (!prompt) return show({ kind: 'error', text: 'Add a note or items under it first, then ask for a title.' });
      const before = engine.tree.get(id)!.content;
      setBusy(id, true);
      show({ kind: 'busy', text: 'Suggesting a title…' });
      try {
        const title = cleanTitle(await complete(k, prompt));
        if (title === '') return show({ kind: 'error', text: 'AI gave an empty title.' });
        session.flush();
        const node = engine.tree.get(id);
        if (!node || node.deletedAt !== null) return show(null);
        if (node.content !== before) {
          // The row was edited while waiting: offer the title instead of overwriting the edit.
          return show({ kind: 'done', text: `Suggested: ${title}`, action: { label: 'Use', run: () => (setContent(id, title), show(null)) } });
        }
        setContent(id, title);
        show({ kind: 'done', text: 'Title suggested.', action: { label: 'Undo', run: () => (setContent(id, before), show(null)) } });
      } catch (e) {
        show({ kind: 'error', text: e instanceof AiError ? e.message : 'AI failed.' });
      } finally {
        setBusy(id, false);
      }
    },
  };
}
