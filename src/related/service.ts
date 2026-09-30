import { createStore, type StoreApi } from 'zustand/vanilla';
import { AiError, type Complete } from '@/ai/client';
import type { Engine } from '@/commands';
import type { EditorSession } from '@/editor/session';
import { importCommands } from '@/io';
import { descendantIds, isSelfOrDescendant, previousSibling, type TreeReader } from '@/model';
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
  /** The row you're on (last edited, selected, or picked from its menu); null means the zoomed item. */
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
  /** The page zoomed to another item (null = Home). The current row stays if it's on the new page. */
  setPageRoot(id: string | null): void;
  /** You moved to another row (clicked into it, selected it): the panel is about that row now. */
  setCurrentRow(id: string): void;
  /** Open the panel, about `id` when given (a row's menu), else the current row or the zoomed item. */
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
/** Wait this long on a row before asking AI about it, so moving through rows doesn't ask about each one. */
const SETTLE_MS = 700;
/** AI's picks are kept on this device, per item, for this many items. */
const SAVED_ITEMS = 300;
const STORAGE_KEY = 'aletheia:related';

interface Saved {
  /** Fingerprint of the item when AI looked: its title, note and rows. A change makes AI look again. */
  fp: string;
  at: number;
  items: RelatedItem[];
}

/** A short hash of what the item says; the rest of the outline is not part of it (Look again covers that). */
export function fingerprint(tree: TreeReader, id: string): string {
  const node = tree.get(id);
  if (!node) return '';
  const text = [node.content, node.note, ...descendantIds(tree, id).slice(0, 80).map((d) => tree.get(d)?.content ?? '')].join('\n');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}.${text.length}`;
}

function readSaved(): Record<string, Saved> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Saved>) : {};
  } catch {
    return {};
  }
}

function writeSaved(saved: Record<string, Saved>): void {
  const entries = Object.entries(saved).sort((a, b) => b[1].at - a[1].at).slice(0, SAVED_ITEMS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // storage full or blocked: the picks just aren't kept
  }
}

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
  /** AI's picks from earlier visits, kept while the item itself is unchanged. */
  const savedFound = (id: string): Found | undefined => {
    const saved = readSaved()[id];
    return saved && saved.fp === fingerprint(engine.tree, id) ? { status: 'done', items: saved.items } : undefined;
  };
  let settle: ReturnType<typeof setTimeout> | null = null;
  const findSoon = () => {
    if (settle) clearTimeout(settle);
    settle = setTimeout(() => void service.findMore(), SETTLE_MS);
  };

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
    let f: Found | undefined;
    if (id) {
      // A finished answer holds only while the item is unchanged; one in flight or failed stays as it is.
      const mem = found.get(id);
      f = mem && mem.status !== 'done' ? mem : savedFound(id);
      if (f) found.set(id, f);
      else found.delete(id);
    }
    state.setState({ ai: f ?? idle(), chat: (id && chats.get(id)) || emptyChat(), moved: new Map() });
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
    // While AI is still to look, word matches wait: showing them first only to tuck most away reads as a flash.
    if (key() !== null && (ai.status === 'idle' || ai.status === 'busy')) return { main: all.filter((i) => ai.items.some((a) => a.id === i.id)), more: [] };
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
      if (s.pageRoot === id) return;
      // Zooming out keeps the row you were on; zooming elsewhere is about the new page.
      const onPage = s.pinned !== null && s.pinned !== id && (id === null || isSelfOrDescendant(engine.tree, id, s.pinned));
      const before = target();
      state.setState({ pageRoot: id, pinned: onPage ? s.pinned : null });
      if (target() === before) return;
      load();
      if (s.open) findSoon();
    },

    setCurrentRow(id) {
      const s = state.getState();
      const pinned = id === s.pageRoot ? null : id;
      if (pinned === s.pinned) return;
      state.setState({ pinned });
      load();
      if (s.open) findSoon();
    },

    show(id) {
      session.flush();
      if (id !== undefined) state.setState({ pinned: id === state.getState().pageRoot ? null : id });
      state.setState({ open: true });
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
        const fp = fingerprint(engine.tree, id);
        const items = parseRelated(engine.tree, id, await complete(k, prompt), rows);
        setFound(id, { status: 'done', items });
        writeSaved({ ...readSaved(), [id]: { fp, at: Date.now(), items } });
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
