import { describe, expect, it } from 'vitest';
import { applySettings, DEFAULT_SETTINGS, sanitize } from './settings-store';

describe('page shape', () => {
  it('defaults to portrait and rejects unknown shapes', () => {
    expect(DEFAULT_SETTINGS.pageShape).toBe('portrait');
    expect(sanitize({ pageShape: 'square' }).pageShape).toBe('portrait');
    expect(sanitize({ pageShape: 'landscape' }).pageShape).toBe('landscape');
  });

  it('uses the width for the chosen shape', () => {
    const props = new Map<string, string>();
    const root = {
      dataset: {} as Record<string, string>,
      style: {
        colorScheme: '',
        setProperty: (k: string, v: string) => void props.set(k, v),
        removeProperty: (k: string) => void props.delete(k),
        getPropertyValue: (k: string) => props.get(k) ?? '',
      },
    } as unknown as HTMLElement;
    applySettings({ ...DEFAULT_SETTINGS, pageShape: 'landscape', landscapeWidth: 1600 }, root, false);
    expect(root.style.getPropertyValue('--page-width')).toBe('1600px');
    expect(root.dataset.shape).toBe('landscape');
    applySettings({ ...DEFAULT_SETTINGS, pageWidth: 700 }, root, false);
    expect(root.style.getPropertyValue('--page-width')).toBe('700px');
  });
});
