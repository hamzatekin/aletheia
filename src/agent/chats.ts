import type { Turn } from './service';

/** How many chats are kept; the oldest drops off. */
export const MAX_CHATS = 5;

/** A chat kept on this device, to reopen from Recent chats. */
export interface SavedChat {
  id: string;
  /** When it was last asked in. */
  at: number;
  turns: Turn[];
}

/** Where chats are kept: this device's localStorage, one key per outline (the sandbox has its own). */
export interface ChatStore {
  load(): SavedChat[];
  save(chats: SavedChat[]): void;
}

/** A turn as saved: Undo can't outlive the page, so only whether it was undone is kept. */
export function savedTurn({ undoable: _, ...t }: Turn): Turn {
  return t;
}

const isTurn = (t: unknown): t is Turn => {
  const o = t as Record<string, unknown> | null;
  return typeof o === 'object' && o !== null && (o.role === 'user' || o.role === 'ai') && typeof o.text === 'string';
};

const isChat = (c: unknown): c is SavedChat => {
  const o = c as Record<string, unknown> | null;
  return typeof o === 'object' && o !== null && typeof o.id === 'string' && typeof o.at === 'number' && Array.isArray(o.turns) && o.turns.every(isTurn);
};

export function localChats(key: string): ChatStore {
  return {
    load() {
      try {
        const v = JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]') as unknown;
        return Array.isArray(v) ? v.filter(isChat).slice(0, MAX_CHATS) : [];
      } catch {
        return [];
      }
    },
    save(chats) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(chats));
      } catch {
        // Storage full or blocked: chats stay for this visit only.
      }
    },
  };
}

/** The chat's name in Recent chats: its first question. */
export function chatTitle(chat: SavedChat): string {
  return (
    chat.turns
      .find((t) => t.role === 'user')
      ?.text.replace(/\s+/g, ' ')
      .trim() || 'Untitled chat'
  );
}
