import { createStore, type StoreApi } from 'zustand/vanilla';
import { AiError, type Complete } from '@/ai/client';
import type { Engine } from '@/commands';
import type { EditorSession } from '@/editor/session';
import { importCommands } from '@/io';
import { previousSibling } from '@/model';
import type { SearchIndex } from '@/search';
import { excludedIds, textMatches, type RelatedItem } from './find';
import { answerItems, chatPrompt, parseRelated, relatedPrompt, type ChatTurn } from './prompts';

/** AI's search for related rows by meaning, for one item. */
export interface Found {
  status: 'idle' | 'busy' | 'done' | 'error';
  items: RelatedItem[];
  error?: string;
}

export interface Turn extends ChatTurn {
  /** What the chat shows for a one-tap question, instead of its full wording. */
  label?: string;
  /** Rows the answer may cite: [0] is the item, [n] is `rows[n]`. */
  rows?: string[];
  /** The items this answer added to the outline, while they can be taken back. */
  added?: string[];
}

export interface Chat {
  turns: Turn[];
  busy: boolean;
  error?: string;
}

export interface RelatedState {
  open: boolean;
  /** The item a row's menu asked about; null follows the zoomed item. */
  pinned: string | null;
  pageRoot: string | null;
  /** Rows sharing the item's words, found at once. */
  text: RelatedItem[];
  ai: Found;
  chat: Chat;
  /** Rows pulled under the item from the panel, with where they came from, for Undo. */
  moved: ReadonlyMap<string, { parentId: string | null; after: string | null }>;
}

export interface RelatedService {
  readonly state: StoreApi<RelatedState>;
  /** The item the panel is about: the one picked from a row menu, else the zoomed item. */
  target(): string | null;
  /** Whether AI can be used here: the Worker only answers devices with sync on. */
  aiAvailable(): boolean;
  /** The page zoomed to another item (null = Home). */
  setPageRoot(id: string | null): void;
  /** Open the panel, about `id` when given (a row's menu), else the zoomed item. */
  show(id?: string): void;
  hide(): void;
  /** Ask AI for rows related by meaning; cached per item until asked again with `again`. */
  findMore(again?: boolean): Promise<void>;
  /** Ask AI about the item and its related rows; `label` is shown in place of a one-tap question's wording. */
  ask(question: string, label?: string): Promise<void>;
  /** Add an answer's bullets as items under the item (Undo takes them back). */
  insertAnswer(turn: number): void;
  undoInsert(turn: number): void;
  /** Move a related row (with what's under it) to the end of the item. */
  pullHere(id: string): void;
  undoPull(id: string): void;
  /** Related rows in the order the panel lists them: AI's picks, then the other text matches. */
  list(): RelatedItem[];
  /** The list split for showing: once AI has looked, rows it did not pick only share words, so they go under `more`. */
  shown(): { main: RelatedItem[]; more: RelatedItem[] };
}

interface Deps {
  engine: Engine;
  session: EditorSession;
  search: SearchIndex;
  /** This device's sync key, or null when sync is off. */
  key(): string | null;
  complete: Complete;
}

/** Wait this long after the last edit before looking for text matches again. */
const RECOMPUTE_MS = 500;

const idle = (): Found => ({ status: 'idle', items: [] });
const emptyChat = (): Chat => ({ turns: [], busy: false });

export function createRelatedService({ engine, session, search, key, complete }: Deps): RelatedService {
  const state = createStore<RelatedState>(() => ({
    open: false,
    pinned: null,
    pageRoot: null,
    text: [],
    ai: idle(),
    chat: emptyChat(),
    moved: new Map(),
  }));
  // Answers and chats per item, so coming back to an item shows them again.
  const found = new Map<string, Found>();
  const chats = new Map<string, Chat>();

  const target = () => {
    const { pinned, pageRoot } = state.getState();
    return pinned ?? pageRoot;
  };
  const live = (id: string) => {
    const n = engine.tree.get(id);
    return n !== undefined && n.deletedAt === null;
  };

  const recompute = () => {
    const id = target();
    state.setState({ text: id && live(id) ? textMatches(engine.tree, search, id) : [] });
  };
  const load = () => {
    const id = target();
    state.setState({ ai: (id && found.get(id)) || idle(), chat: (id && chats.get(id)) || emptyChat(), moved: new Map() });
    recompute();
  };
  const setFound = (id: string, f: Found) => {
    found.set(id, f);
    if (target() === id) state.setState({ ai: f });
  };
  const setChat = (id: string, c: Chat) => {
    chats.set(id, c);
    if (target() === id) state.setState({ chat: c });
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  engine.onOperation(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(recompute, RECOMPUTE_MS);
  });

  const list = (): RelatedItem[] => {
    const id = target();
    if (!id || !live(id)) return [];
    const { text, ai, moved } = state.getState();
    const skip = excludedIds(engine.tree, id);
    const out: RelatedItem[] = [];
    for (const item of [...ai.items, ...text]) {
      if (out.some((o) => o.id === item.id) || !live(item.id)) continue;
      if (skip.has(item.id) && !moved.has(item.id)) continue;
      out.push(item);
    }
    return out;
  };

  const shown = () => {
    const all = list();
    const { ai, moved } = state.getState();
    if (ai.status !== 'done') return { main: all, more: [] };
    const picked = new Set(ai.items.map((i) => i.id));
    const main = all.filter((i) => picked.has(i.id) || moved.has(i.id));
    return { main, more: all.filter((i) => !main.includes(i)) };
  };

  const service: RelatedService = {
    state,
    target,
    aiAvailable: () => key() !== null,
    list,
    shown,

    setPageRoot(id) {
      const s = state.getState();
      if (s.pageRoot === id && s.pinned === null) return;
      state.setState({ pageRoot: id, pinned: null });
      load();
      if (s.open) void service.findMore();
    },

    show(id) {
      session.flush();
      const pinned = id === undefined || id === state.getState().pageRoot ? null : id;
      state.setState({ open: true, pinned });
      load();
      void service.findMore();
    },

    hide: () => state.setState({ open: false }),

    async findMore(again = false) {
      const id = target();
      const k = key();
      if (!id || !k || !live(id)) return;
      const cur = found.get(id);
      if (cur?.status === 'busy' || (cur?.status === 'done' && !again)) return;
      session.flush();
      recompute();
      setFound(id, { status: 'busy', items: cur?.items ?? [] });
      try {
        const { prompt, rows } = relatedPrompt(engine.tree, id, state.getState().text.map((t) => t.id));
        const items = parseRelated(engine.tree, id, await complete(k, prompt), rows);
        setFound(id, { status: 'done', items });
      } catch (e) {
        setFound(id, { status: 'error', items: cur?.items ?? [], error: e instanceof Error ? e.message : 'AI failed.' });
      }
    },

    async ask(question, label) {
      const id = target();
      const k = key();
      const q = question.trim();
      if (!id || q === '' || !live(id)) return;
      const chat = chats.get(id) ?? emptyChat();
      if (chat.busy) return;
      if (!k) return setChat(id, { ...chat, error: 'Turn on sync in Settings to use AI on this device.' });
      session.flush();
      const rows = list().map((r) => r.id);
      const history = chat.turns;
      setChat(id, { turns: [...history, { role: 'user', text: q, ...(label ? { label } : {}) }], busy: true });
      try {
        const answer = (await complete(k, chatPrompt(engine.tree, id, rows, history, q))).trim();
        const c = chats.get(id)!;
        setChat(id, { turns: [...c.turns, { role: 'ai', text: answer || 'AI gave an empty answer.', rows }], busy: false });
      } catch (e) {
        const c = chats.get(id)!;
        setChat(id, { turns: c.turns, busy: false, error: e instanceof AiError ? e.message : 'AI failed.' });
      }
    },

    insertAnswer(turn) {
      const id = target();
      if (!id || !live(id)) return;
      const chat = chats.get(id);
      const t = chat?.turns[turn];
      if (!chat || !t || t.role !== 'ai' || t.added) return;
      const items = answerItems(t.text);
      if (items.length === 0) return;
      session.flush();
      const commands = importCommands(id, items);
      if (!engine.batch(commands, 'import').ok) return;
      // Show the new items even when the item is folded.
      if (engine.tree.get(id)?.collapsed) engine.execute({ type: 'toggleCollapse', id, collapsed: false });
      const added = commands.flatMap((c) => (c.type === 'createNode' && c.parentId === id ? [c.id] : []));
      setChat(id, { ...chat, turns: chat.turns.map((x, i) => (i === turn ? { ...x, added } : x)) });
    },

    undoInsert(turn) {
      const id = target();
      const chat = id ? chats.get(id) : undefined;
      const t = chat?.turns[turn];
      if (!id || !chat || !t?.added) return;
      session.flush();
      engine.batch(t.added.filter(live).map((a) => ({ type: 'deleteSubtree' as const, id: a })), 'delete');
      const { added: _, ...rest } = t;
      setChat(id, { ...chat, turns: chat.turns.map((x, i) => (i === turn ? rest : x)) });
    },

    pullHere(rowId) {
      const id = target();
      const node = engine.tree.get(rowId);
      if (!id || !node || !live(id)) return;
      session.flush();
      const from = { parentId: node.parentId, after: previousSibling(engine.tree, rowId) };
      if (!engine.execute({ type: 'moveNode', id: rowId, parentId: id, at: 'last' }).ok) return;
      if (engine.tree.get(id)?.collapsed) engine.execute({ type: 'toggleCollapse', id, collapsed: false });
      state.setState({ moved: new Map([...state.getState().moved, [rowId, from]]) });
    },

    undoPull(rowId) {
      const from = state.getState().moved.get(rowId);
      if (!from) return;
      session.flush();
      const after = from.after && live(from.after) ? from.after : null;
      engine.execute({ type: 'moveNode', id: rowId, parentId: from.parentId, at: after ? { after } : 'first' });
      const moved = new Map(state.getState().moved);
      moved.delete(rowId);
      state.setState({ moved });
    },
  };
  return service;
}
