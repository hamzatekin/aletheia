import { createStore, type StoreApi } from 'zustand/vanilla';
import { AI_NEEDS_SYNC, AiError, type Step } from '@/ai/client';
import type { BatchItem, Engine } from '@/commands';
import type { EditorSession } from '@/editor/session';
import { isLive, isSelfOrDescendant } from '@/model';
import type { SearchIndex } from '@/search';
import { planChanges } from './changes';
import type { ChatTurn } from './prompt';
import { runAgent } from './run';

export interface Turn extends ChatTurn {
  /** Rows the answer may cite: [n] is `rows[n - 1]`. */
  rows?: string[];
  /** What AI changed in the outline for this answer, one line each. */
  did?: string[];
  /** AI's changes can be taken back (until they are: `undone`). */
  undoable?: boolean;
  undone?: boolean;
}

export interface AgentState {
  open: boolean;
  /** The row you're on (last clicked into or selected); null means the zoomed page. */
  row: string | null;
  pageRoot: string | null;
  turns: Turn[];
  busy: boolean;
  /** While busy: what AI looked at so far ("Searching “coffee”"). */
  steps: string[];
  error: string | null;
}

/** One chat for the whole app: it stays as you move around, and starts from the row you're on. */
export interface AgentService {
  readonly state: StoreApi<AgentState>;
  /** Whether AI can be used here: the Worker only answers devices with sync on. */
  available(): boolean;
  /** The row questions start from: the one you're on, else the zoomed item; null on Home. */
  here(): string | null;
  setPageRoot(id: string | null): void;
  setCurrentRow(id: string): void;
  show(): void;
  hide(): void;
  ask(question: string): Promise<void>;
  /** Take back the changes AI made for an answer. */
  undoChanges(turn: number): void;
  /** Start a new chat. */
  clear(): void;
}

interface Deps {
  engine: Engine;
  session: EditorSession;
  search: SearchIndex;
  /** This device's sync key, or null when sync is off. */
  key(): string | null;
  step: Step;
}

export function createAgentService({ engine, session, search, key, step }: Deps): AgentService {
  const state = createStore<AgentState>(() => ({ open: false, row: null, pageRoot: null, turns: [], busy: false, steps: [], error: null }));
  /** How to take back each answer's changes, by turn. */
  const undos = new Map<number, BatchItem[]>();
  /** Bumped by Clear, so an answer to a cleared chat is dropped. */
  let chatNo = 0;

  const here = () => {
    const { row, pageRoot } = state.getState();
    const id = row ?? pageRoot;
    return id && isLive(engine.tree.get(id)) ? id : null;
  };

  return {
    state,
    available: () => key() !== null,
    here,

    setPageRoot(id) {
      const { row } = state.getState();
      // Zooming out keeps the row you were on; zooming elsewhere is about the new page.
      const onPage = row !== null && row !== id && (id === null || isSelfOrDescendant(engine.tree, id, row));
      state.setState({ pageRoot: id, row: onPage ? row : null });
    },

    setCurrentRow(id) {
      state.setState({ row: id === state.getState().pageRoot ? null : id });
    },

    show: () => state.setState({ open: true }),
    hide: () => state.setState({ open: false }),

    clear() {
      chatNo++;
      undos.clear();
      state.setState({ turns: [], busy: false, steps: [], error: null });
    },

    async ask(question) {
      const q = question.trim();
      const s = state.getState();
      if (q === '' || s.busy) return;
      const k = key();
      if (!k) return state.setState({ error: AI_NEEDS_SYNC });
      session.flush();
      const mine = chatNo;
      const history = s.turns;
      const steps: string[] = [];
      state.setState({ turns: [...history, { role: 'user', text: q }], busy: true, steps, error: null });
      try {
        const run = await runAgent({
          tree: engine.tree,
          search,
          step,
          key: k,
          item: here(),
          history,
          question: q,
          progress: (line) => {
            if (chatNo !== mine) return;
            steps.push(line);
            state.setState({ steps: [...steps] });
          },
        });
        if (chatNo !== mine) return;
        session.flush();
        const plan = planChanges(engine.tree, run.refs, run.changes);
        const index = state.getState().turns.length;
        let did: string[] = [];
        if (plan.items.length > 0 && engine.batch(plan.items, 'ai').ok) {
          did = plan.done(engine.tree);
          undos.set(index, plan.undo());
        }
        const undoable = did.length > 0;
        if (plan.dropped > 0) did.push(`Skipped ${plan.dropped === 1 ? 'a change' : `${plan.dropped} changes`} naming rows it couldn't find.`);
        const answer: Turn = {
          role: 'ai',
          text: run.answer || 'AI gave an empty answer.',
          rows: run.refs.list(),
          ...(did.length > 0 ? { did } : {}),
          ...(undoable ? { undoable } : {}),
        };
        state.setState({ turns: [...state.getState().turns, answer], busy: false, steps: [] });
      } catch (e) {
        if (chatNo !== mine) return;
        state.setState({ busy: false, steps: [], error: e instanceof AiError ? e.message : 'AI failed.' });
      }
    },

    undoChanges(turn) {
      const items = undos.get(turn);
      const t = state.getState().turns[turn];
      if (!items || !t || t.undone) return;
      session.flush();
      engine.batch(items, 'undo ai');
      undos.delete(turn);
      state.setState({ turns: state.getState().turns.map((x, i) => (i === turn ? { ...x, undone: true } : x)) });
    },
  };
}
