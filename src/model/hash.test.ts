import { describe, expect, it } from 'vitest';
import { contentHash } from './hash';

describe('contentHash', () => {
  it('is stable, 16 hex chars, and sensitive to small changes', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'));
    expect(contentHash('hello')).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash('hello')).not.toBe(contentHash('hellp'));
    expect(contentHash('')).not.toBe(contentHash(' '));
    expect(contentHash('ab')).not.toBe(contentHash('ba'));
  });
});
