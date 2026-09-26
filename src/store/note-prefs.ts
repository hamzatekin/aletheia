import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * Per-device note preferences (localStorage, like the other UI settings):
 * whether notes are edited as raw Markdown, and which notes are collapsed.
 */
export interface NotePrefs {
  raw: boolean;
  collapsed: ReadonlySet<string>;
  setRaw(raw: boolean): void;
  toggleCollapsed(id: string, collapsed?: boolean): void;
}

const KEY = 'aletheia:notes';

function load(): { raw: boolean; collapsed: string[] } {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as unknown;
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      return {
        raw: o.raw === true,
        collapsed: Array.isArray(o.collapsed) ? o.collapsed.filter((x): x is string => typeof x === 'string') : [],
      };
    }
  } catch {
    // Unreadable storage: defaults.
  }
  return { raw: false, collapsed: [] };
}

const initial = load();

export const notePrefs = createStore<NotePrefs>((set, get) => ({
  raw: initial.raw,
  collapsed: new Set(initial.collapsed),
  setRaw: (raw) => set({ raw }),
  toggleCollapsed: (id, collapsed) => {
    const next = new Set(get().collapsed);
    if (collapsed ?? !next.has(id)) next.add(id);
    else next.delete(id);
    set({ collapsed: next });
  },
}));

notePrefs.subscribe((s) => {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ raw: s.raw, collapsed: [...s.collapsed] }));
  } catch {
    // Private mode or full storage: preferences just won't persist.
  }
});

export function useNotePrefs<T>(selector: (s: NotePrefs) => T): T {
  return useStore(notePrefs, selector);
}
