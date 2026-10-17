import { describe, expect, it } from 'vitest';
import { isSandboxPath } from './sandbox';

describe('isSandboxPath', () => {
  it('is true for /sandbox and the routes under it, and false for everything else', () => {
    expect(['/sandbox', '/sandbox/', '/sandbox/n/abc', '/sandbox/capture'].map(isSandboxPath)).toEqual([true, true, true, true]);
    expect(['/', '/n/abc', '/sandboxes', '/n/sandbox', '/capture'].map(isSandboxPath)).toEqual([false, false, false, false, false]);
  });
});
