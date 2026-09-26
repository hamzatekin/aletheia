import { describe, expect, it } from 'vitest';
import { createSettingsStore, DEFAULT_SETTINGS, loadSettings, sanitize } from './settings-store';

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

describe('settings store', () => {
  it('falls back to defaults for missing or broken data', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ getItem: () => '{not json' })).toEqual(DEFAULT_SETTINGS);
  });

  it('drops unknown keys and clamps out-of-range values', () => {
    const s = sanitize({ fontSize: 400, lineHeight: 0, theme: 'neon', font: 'georgia', pageColor: 'red', evil: 1 });
    expect(s.fontSize).toBe(26);
    expect(s.lineHeight).toBe(1.1);
    expect(s.theme).toBe('system');
    expect(s.font).toBe('georgia');
    expect(s.pageColor).toBe(DEFAULT_SETTINGS.pageColor);
    expect('evil' in s).toBe(false);
  });

  it('persists updates and reloads them', () => {
    const storage = memoryStorage();
    const store = createSettingsStore(loadSettings(storage), storage);
    store.getState().update({ theme: 'sepia', fontSize: 20 });
    const reloaded = loadSettings(storage);
    expect(reloaded.theme).toBe('sepia');
    expect(reloaded.fontSize).toBe(20);
  });

  it('reset keeps the sidebar where it is', () => {
    const storage = memoryStorage();
    const store = createSettingsStore(DEFAULT_SETTINGS, storage);
    store.getState().update({ sidebarOpen: false, fontSize: 22 });
    store.getState().reset();
    expect(store.getState().fontSize).toBe(18);
    expect(store.getState().sidebarOpen).toBe(false);
  });
});
