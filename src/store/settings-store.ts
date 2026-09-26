import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * Look-and-feel preferences. They live on this device only (localStorage),
 * like the notes themselves, which live in this browser's IndexedDB.
 */

export type ThemeId = 'system' | 'paper' | 'sepia' | 'night' | 'custom';
export type FontId = 'inter' | 'system' | 'literata' | 'georgia' | 'mono';

export interface Settings {
  theme: ThemeId;
  /** Colors used by the "custom" theme. */
  deskColor: string;
  pageColor: string;
  textColor: string;
  accentColor: string;
  font: FontId;
  /** Row text size in px. */
  fontSize: number;
  /** Row line height as a multiple of the font size. */
  lineHeight: number;
  /** Width of the text column in px. */
  pageWidth: number;
  /** Draw the text column as a sheet of paper on a desk. */
  bookPage: boolean;
  sidebarOpen: boolean;
  /** How many levels the outline sidebar shows expanded by default. */
  outlineDepth: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  deskColor: '#e9e6df',
  pageColor: '#fffdf8',
  textColor: '#1f1d1a',
  accentColor: '#2563eb',
  font: 'inter',
  fontSize: 18,
  lineHeight: 1.35,
  pageWidth: 720,
  bookPage: true,
  sidebarOpen: true,
  outlineDepth: 2,
};

export const LIMITS = {
  fontSize: { min: 13, max: 26, step: 1 },
  lineHeight: { min: 1.1, max: 2.2, step: 0.05 },
  pageWidth: { min: 520, max: 1100, step: 20 },
  outlineDepth: { min: 1, max: 6, step: 1 },
} as const;

export const FONTS: Record<FontId, { label: string; stack: string }> = {
  inter: { label: 'Inter', stack: "'Inter Variable', Inter, system-ui, sans-serif" },
  system: { label: 'System', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  literata: { label: 'Literata (book)', stack: "'Literata Variable', Literata, Georgia, serif" },
  georgia: { label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  mono: { label: 'Monospace', stack: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
};

interface Palette {
  scheme: 'light' | 'dark';
  desk: string;
  page: string;
  text: string;
  accent: string;
}

export const THEMES: Record<Exclude<ThemeId, 'system' | 'custom'>, { label: string } & Palette> = {
  paper: { label: 'Paper', scheme: 'light', desk: '#e9e6df', page: '#fffdf8', text: '#1f1d1a', accent: '#2563eb' },
  sepia: { label: 'Sepia', scheme: 'light', desk: '#d9cfbd', page: '#f5ecd9', text: '#3b2f22', accent: '#a0522d' },
  night: { label: 'Night', scheme: 'dark', desk: '#111111', page: '#1c1c1c', text: '#e4e4e4', accent: '#60a5fa' },
};

const STORAGE_KEY = 'aletheia:settings';

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Settings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Keep only known keys with values of the right type and range. */
export function sanitize(input: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (typeof input !== 'object' || input === null) return out;
  const src = input as Record<string, unknown>;
  const color = /^#[0-9a-f]{6}$/i;
  if (typeof src.theme === 'string' && (src.theme === 'system' || src.theme === 'custom' || src.theme in THEMES)) out.theme = src.theme as ThemeId;
  if (typeof src.font === 'string' && src.font in FONTS) out.font = src.font as FontId;
  for (const k of ['deskColor', 'pageColor', 'textColor', 'accentColor'] as const) {
    if (typeof src[k] === 'string' && color.test(src[k])) out[k] = src[k];
  }
  for (const k of ['fontSize', 'lineHeight', 'pageWidth', 'outlineDepth'] as const) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(LIMITS[k].max, Math.max(LIMITS[k].min, v));
  }
  for (const k of ['bookPage', 'sidebarOpen'] as const) {
    if (typeof src[k] === 'boolean') out[k] = src[k];
  }
  return out;
}

export interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void;
  reset(): void;
}

export type SettingsStore = StoreApi<SettingsState>;

export function createSettingsStore(initial: Settings = loadSettings(), storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): SettingsStore {
  const store = createStore<SettingsState>((set) => ({
    ...initial,
    update: (patch) => set(sanitize({ ...pick(store.getState()), ...patch })),
    reset: () => set({ ...DEFAULT_SETTINGS, sidebarOpen: store.getState().sidebarOpen }),
  }));
  store.subscribe((s) => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(pick(s)));
    } catch {
      // Private mode or full storage: settings just won't persist.
    }
  });
  return store;
}

function pick(s: SettingsState): Settings {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = s[k as keyof Settings];
  return out as unknown as Settings;
}

export function useSettings<T>(store: SettingsStore, selector: (s: SettingsState) => T): T {
  return useStore(store, selector);
}

/** Resolve the theme to concrete colors; `null` colors mean "follow the OS". */
export function resolvePalette(s: Settings): Palette | null {
  if (s.theme === 'system') return null;
  if (s.theme === 'custom') {
    return { scheme: isDark(s.pageColor) ? 'dark' : 'light', desk: s.deskColor, page: s.pageColor, text: s.textColor, accent: s.accentColor };
  }
  return THEMES[s.theme];
}

function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Write settings onto the document as CSS custom properties. */
export function applySettings(s: Settings, root: HTMLElement, prefersDark: boolean): void {
  const palette = resolvePalette(s);
  const scheme = palette?.scheme ?? (prefersDark ? 'dark' : 'light');
  root.dataset.scheme = scheme;
  root.dataset.book = s.bookPage ? 'true' : 'false';
  root.style.colorScheme = scheme;
  const set = (name: string, value: string | null) => (value === null ? root.style.removeProperty(name) : root.style.setProperty(name, value));
  set('--desk', palette?.desk ?? null);
  set('--page', palette?.page ?? null);
  set('--ink', palette?.text ?? null);
  set('--accent', palette?.accent ?? null);
  set('--font', FONTS[s.font].stack);
  set('--font-size', `${s.fontSize}px`);
  set('--row-lh', `${Math.round(s.fontSize * s.lineHeight)}px`);
  set('--page-width', `${s.pageWidth}px`);
}
