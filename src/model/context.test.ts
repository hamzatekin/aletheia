import { describe, expect, it } from 'vitest';
import { nodeContextText } from './context';
import { fixture } from '@/test/helpers';

describe('nodeContextText', () => {
  it('includes path, content, note and direct children only', () => {
    const f = fixture([['A', [['B', [['C', ['C1', ['C2', ['C2a']]]]]]]]]);
    f.engine.execute({ type: 'updateNote', id: f.ids.C!, note: 'line one\n\nline two' });
    expect(nodeContextText(f.engine.tree, f.ids.C!)).toBe(
      ['Path: A > B', '', '- C', '  line one', '', '  line two', '  - C1', '  - C2'].join('\n'),
    );
    expect(nodeContextText(f.engine.tree, f.ids.A!)).toBe('- A\n  - B');
    expect(nodeContextText(f.engine.tree, 'ghost')).toBe('');
  });
});
