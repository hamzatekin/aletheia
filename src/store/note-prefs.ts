import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * Per-device note preferences (localStorage, like the other UI settings):
 * whether notes are edited as raw Markdown, whether notes start collapsed,
 * and each note you folded or unfolded yourself.
 */
export interface NotePrefs {
  raw: boolean;
  /** Notes show only their first line until opened. */
  collapsedByDefault: boolean;
  /** Notes folded (true) or unfolded (false) by hand; the rest follow the default. */
  folded: Readonly<Record<string, boolean>>;
  setRaw(raw: boolean): void;
  setCollapsedByDefault(collapsed: boolean): void;
  toggleCollapsed(id: string, collapsed?: boolean): void;
}

/** Whether note `id` is collapsed. */
export const isNoteCollapsed = (s: NotePrefs, id: string): boolean => s.folded[id] ?? s.collapsedByDefault;

const KEY = 'aletheia:notes';

type Saved = Pick<NotePrefs, 'raw' | 'collapsedByDefault' | 'folded'>;

/**
 * Saved prefs from before version 2 also hold every note that editing opened
 * (it used to keep a note open after you left it). Notes now open only while
 * you're on their item, so those are dropped (notes folded by hand stay), and
 * notes start collapsed again, as asked for when this changed.
 */
const VERSION = 2;

function load(): Saved {
  const folded: Record<string, boolean> = {};
  const saved: Saved = { raw: false, collapsedByDefault: true, folded };
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as unknown;
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      saved.raw = o.raw === true;
      if (typeof o.collapsedByDefault === 'boolean' && o.v === VERSION) saved.collapsedByDefault = o.collapsedByDefault;
      if (typeof o.folded === 'object' && o.folded !== null) {
        for (const [id, f] of Object.entries(o.folded)) if (f === true || (f === false && o.v === VERSION)) folded[id] = f;
      }
      // Before notes started collapsed, only the collapsed ones were stored.
      if (Array.isArray(o.collapsed)) {
        for (const id of o.collapsed) if (typeof id === 'string') folded[id] = true;
      }
    }
  } catch {
    // Unreadable storage: defaults.
  }
  return saved;
}

export const notePrefs = createStore<NotePrefs>((set, get) => ({
  ...load(),
  setRaw: (raw) => set({ raw }),
  setCollapsedByDefault: (collapsedByDefault) => set({ collapsedByDefault }),
  toggleCollapsed: (id, collapsed) => {
    const state = get();
    set({ folded: { ...state.folded, [id]: collapsed ?? !isNoteCollapsed(state, id) } });
  },
}));

notePrefs.subscribe((s) => {
  try {
    const saved: Saved & { v: number } = { v: VERSION, raw: s.raw, collapsedByDefault: s.collapsedByDefault, folded: s.folded };
    globalThis.localStorage?.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Private mode or full storage: preferences just won't persist.
  }
});

export function useNotePrefs<T>(selector: (s: NotePrefs) => T): T {
  return useStore(notePrefs, selector);
}
