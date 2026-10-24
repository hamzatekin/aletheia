import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * Per-device note preferences (localStorage, like the other UI settings):
 * whether notes are edited as raw Markdown, whether notes start collapsed,
 * and each note you folded or unfolded yourself.
 */
interface NotePrefs {
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

/** Saved with each save; prefs saved without it (before notes started collapsed) are ignored. */
const VERSION = 2;

function load(): Saved {
  const folded: Record<string, boolean> = {};
  const saved: Saved = { raw: false, collapsedByDefault: true, folded };
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as unknown;
    if (typeof v === 'object' && v !== null && (v as Record<string, unknown>).v === VERSION) {
      const o = v as Record<string, unknown>;
      saved.raw = o.raw === true;
      if (typeof o.collapsedByDefault === 'boolean') saved.collapsedByDefault = o.collapsedByDefault;
      if (typeof o.folded === 'object' && o.folded !== null) {
        for (const [id, f] of Object.entries(o.folded)) if (typeof f === 'boolean') folded[id] = f;
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
