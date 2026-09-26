import { afterEach, describe, expect, it, vi } from 'vitest';

async function prefsWith(saved: unknown) {
  const data = new Map<string, string>(saved === undefined ? [] : [['aletheia:notes', JSON.stringify(saved)]]);
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
  vi.resetModules();
  const mod = await import('./note-prefs');
  return { ...mod, data };
}

afterEach(() => vi.unstubAllGlobals());

describe('note prefs', () => {
  it('start collapsed, and a note opened by hand stays open', async () => {
    const { notePrefs, isNoteCollapsed, data } = await prefsWith(undefined);
    expect(isNoteCollapsed(notePrefs.getState(), 'a')).toBe(true);
    notePrefs.getState().toggleCollapsed('a');
    expect(isNoteCollapsed(notePrefs.getState(), 'a')).toBe(false);
    expect(isNoteCollapsed(notePrefs.getState(), 'b')).toBe(true);
    expect(JSON.parse(data.get('aletheia:notes')!)).toEqual({ raw: false, collapsedByDefault: true, folded: { a: false } });
  });

  it('keeps hand-folded notes when the default changes', async () => {
    const { notePrefs, isNoteCollapsed } = await prefsWith({ collapsedByDefault: true, folded: { a: false } });
    notePrefs.getState().setCollapsedByDefault(false);
    expect(isNoteCollapsed(notePrefs.getState(), 'a')).toBe(false);
    expect(isNoteCollapsed(notePrefs.getState(), 'b')).toBe(false);
    notePrefs.getState().toggleCollapsed('b', true);
    notePrefs.getState().setCollapsedByDefault(true);
    expect(isNoteCollapsed(notePrefs.getState(), 'a')).toBe(false);
    expect(isNoteCollapsed(notePrefs.getState(), 'b')).toBe(true);
  });

  it('reads the older list of collapsed notes', async () => {
    const { notePrefs } = await prefsWith({ raw: true, collapsed: ['x'] });
    expect(notePrefs.getState()).toMatchObject({ raw: true, collapsedByDefault: true, folded: { x: true } });
  });
});
