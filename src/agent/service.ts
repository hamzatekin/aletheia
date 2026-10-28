import { createStore, type StoreApi } from 'zustand/vanilla';
import { AI_NEEDS_SYNC, AiError, type Step } from '@/ai/client';
import type { BatchItem, Engine } from '@/commands';
import type { EditorSession } from '@/editor/session';
import { isLive, isSelfOrDescendant, newId } from '@/model';
import type { SearchIndex } from '@/search';
import { MAX_CHATS, savedTurn, type ChatStore, type SavedChat } from './chats';
import { planChanges } from './changes';
import { Refs, WEEK_QUESTION, weekLines, type ChatTurn } from './prompt';
import { runAgent } from './run';

export interface Turn extends ChatTurn {
  /** Rows the answer may cite: [n] is `rows[n - 1]`. */
  rows?: string[];
  /** What AI changed in the outline for this answer, one line each. */
  did?: string[];
  /** Changes AI asked for that named rows it couldn't find. */
  skipped?: number;
  /** AI's changes can be taken back (until they are: `undone`). */
  undoable?: boolean;
  undone?: boolean;
}

interface AgentState {
  open: boolean;
  /** The row you're on (last clicked into or selected); null means the zoomed page. */
  row: string | null;
  pageRoot: string | null;
  turns: Turn[];
  busy: boolean;
  /** While busy: what AI looked at so far ("Searching “coffee”"). */
  steps: string[];
  error: string | null;
  /** The last few chats kept on this device, newest first (the current one too, once asked in). */
  chats: SavedChat[];
  chatId: string;
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
  /** Ask how the week went, with the rows added, done and still in the Inbox in the last 7 days. */
  myWeek(): Promise<void>;
  /** Take back the changes AI made for an answer. */
  undoChanges(turn: number): void;
  /** Start a new chat. */
  clear(): void;
  /** Go back to a recent chat. */
  openChat(id: string): void;
}

interface Deps {
  engine: Engine;
  session: EditorSession;
  search: SearchIndex;
  /** This device's sync key, or null when sync is off. */
  key(): string | null;
  step: Step;
  /** Where the last few chats are kept; without it they last until reload. */
  chats?: ChatStore;
  now?: () => number;
}

/** A chat's row numbers, from its last answer (each answer lists every row numbered so far). */
function rowsOf(turns: readonly Turn[]): string[] {
  return turns.findLast((t) => t.rows !== undefined)?.rows ?? [];
}

export function createAgentService({ engine, session, search, key, step, chats: store, now = Date.now }: Deps): AgentService {
  const saved = store?.load() ?? [];
  // Reopening the app comes back to the chat you were in.
  const last = saved[0];
  const state = createStore<AgentState>(() => ({
    open: false,
    row: null,
    pageRoot: null,
    turns: last?.turns ?? [],
    busy: false,
    steps: [],
    error: null,
    chats: saved,
    chatId: last?.id ?? newId(),
  }));
  /** How to take back each answer's changes, by turn. */
  const undos = new Map<number, BatchItem[]>();
  /** Bumped by Clear, so an answer to a cleared chat is dropped. */
  let chatNo = 0;
  /** Row numbers for the whole chat: earlier answers cite rows by them. */
  let refs = Refs.of(rowsOf(last?.turns ?? []));

  /** Keep the current chat: `asked` moves it to the top of Recent chats. */
  const save = (asked: boolean) => {
    const { chatId, turns, chats } = state.getState();
    if (turns.length === 0) return;
    const prev = chats.find((c) => c.id === chatId);
    const chat: SavedChat = {
      id: chatId,
      at: asked || !prev ? Date.now() : prev.at,
      turns: turns.map(savedTurn),
    };
    const next = asked || !prev ? [chat, ...chats.filter((c) => c.id !== chatId)].slice(0, MAX_CHATS) : chats.map((c) => (c.id === chatId ? chat : c));
    state.setState({ chats: next });
    store?.save(next);
  };

  const here = () => {
    const { row, pageRoot } = state.getState();
    const id = row ?? pageRoot;
    return id && isLive(engine.tree.get(id)) ? id : null;
  };

  /** Ask AI; `context` adds rows for it to go on (My week), instead of the row you're on. */
  const run = async (question: string, context?: (refs: Refs) => string[]): Promise<void> => {
    const q = question.trim();
    const s = state.getState();
    if (q === '' || s.busy) return;
    const k = key();
    if (!k) return state.setState({ error: AI_NEEDS_SYNC });
    session.flush();
    const mine = chatNo;
    const history = s.turns;
    const steps: string[] = [];
    state.setState({
      turns: [...history, { role: 'user', text: q }],
      busy: true,
      steps,
      error: null,
    });
    save(true);
    try {
      const result = await runAgent({
        tree: engine.tree,
        search,
        step,
        key: k,
        item: context ? null : here(),
        history,
        question: q,
        ...(context ? { context: context(refs) } : {}),
        refs,
        progress: (line) => {
          if (chatNo !== mine) return;
          steps.push(line);
          state.setState({ steps: [...steps] });
        },
      });
      if (chatNo !== mine) return;
      session.flush();
      const plan = planChanges(engine.tree, result.refs, result.changes);
      const index = state.getState().turns.length;
      let did: string[] = [];
      if (plan.items.length > 0 && engine.batch(plan.items, 'ai').ok) {
        did = plan.done(engine.tree);
        undos.set(index, plan.undo());
      }
      const answer: Turn = {
        role: 'ai',
        text: result.answer || 'AI gave an empty answer.',
        rows: result.refs.list(),
        ...(did.length > 0 ? { did, undoable: true } : {}),
        ...(plan.dropped > 0 ? { skipped: plan.dropped } : {}),
      };
      state.setState({
        turns: [...state.getState().turns, answer],
        busy: false,
        steps: [],
      });
      save(false);
    } catch (e) {
      if (chatNo !== mine) return;
      state.setState({
        busy: false,
        steps: [],
        error: e instanceof AiError ? e.message : 'AI failed.',
      });
    }
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
      refs = new Refs();
      state.setState({
        turns: [],
        busy: false,
        steps: [],
        error: null,
        chatId: newId(),
      });
    },

    openChat(id) {
      const chat = state.getState().chats.find((c) => c.id === id);
      if (!chat) return;
      chatNo++;
      undos.clear();
      refs = Refs.of(rowsOf(chat.turns));
      state.setState({
        turns: chat.turns,
        busy: false,
        steps: [],
        error: null,
        chatId: chat.id,
      });
    },

    ask: (question) => run(question),

    myWeek: () => run(WEEK_QUESTION, (r) => weekLines(engine.tree, r, now())),

    undoChanges(turn) {
      const items = undos.get(turn);
      const t = state.getState().turns[turn];
      if (!items || !t || t.undone) return;
      session.flush();
      engine.batch(items, 'undo ai');
      undos.delete(turn);
      state.setState({
        turns: state.getState().turns.map((x, i) => (i === turn ? { ...x, undone: true } : x)),
      });
      save(false);
    },
  };
}
