import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/helpers';
import { hasOpenParent, setAllCollapsedCommands } from './collapse-all';

const spec = [['A', [['A1', ['A1a']], 'A2']], ['B', ['B1']], 'C'] as never;

describe('setAllCollapsedCommands', () => {
  it('collapses every open parent in the document, leaves leaves alone', () => {
    const f = fixture(spec);
    const cmds = setAllCollapsedCommands(f.engine.tree, null, true);
    expect(cmds).toHaveLength(3);
    expect(cmds).toEqual(expect.arrayContaining([
      { type: 'toggleCollapse', id: f.ids.A, collapsed: true },
      { type: 'toggleCollapse', id: f.ids.A1, collapsed: true },
      { type: 'toggleCollapse', id: f.ids.B, collapsed: true },
    ]));
  });

  it('skips parents already in the wanted state and deleted nodes', () => {
    const f = fixture(spec);
    f.engine.execute({ type: 'toggleCollapse', id: f.ids.A1!, collapsed: true });
    f.engine.execute({ type: 'deleteSubtree', id: f.ids.B! });
    expect(setAllCollapsedCommands(f.engine.tree, null, true)).toEqual([{ type: 'toggleCollapse', id: f.ids.A, collapsed: true }]);
    expect(setAllCollapsedCommands(f.engine.tree, null, false)).toEqual([{ type: 'toggleCollapse', id: f.ids.A1, collapsed: false }]);
  });

  it('under a node, covers only its descendants unless asked to include it', () => {
    const f = fixture(spec);
    expect(setAllCollapsedCommands(f.engine.tree, f.ids.A!, true)).toEqual([{ type: 'toggleCollapse', id: f.ids.A1, collapsed: true }]);
    expect(setAllCollapsedCommands(f.engine.tree, f.ids.A!, true, true)).toEqual([
      { type: 'toggleCollapse', id: f.ids.A, collapsed: true },
      { type: 'toggleCollapse', id: f.ids.A1, collapsed: true },
    ]);
    expect(setAllCollapsedCommands(f.engine.tree, f.ids.C!, true, true)).toEqual([]);
  });
});

describe('hasOpenParent', () => {
  it('is true while a visible parent is open, false once all are collapsed or there are none', () => {
    const f = fixture(spec);
    expect(hasOpenParent(f.engine.tree, null)).toBe(true);
    f.engine.batch(setAllCollapsedCommands(f.engine.tree, null, true));
    expect(hasOpenParent(f.engine.tree, null)).toBe(false);
    expect(hasOpenParent(f.engine.tree, f.ids.C!)).toBe(false);
    // Under A, A1 is visible and collapsed; opening A1 makes it true again.
    f.engine.execute({ type: 'toggleCollapse', id: f.ids.A1!, collapsed: false });
    expect(hasOpenParent(f.engine.tree, f.ids.A!)).toBe(true);
    expect(hasOpenParent(f.engine.tree, f.ids.B!)).toBe(false);
  });

  it('ignores open parents hidden inside a collapsed one', () => {
    const f = fixture(spec);
    f.engine.execute({ type: 'toggleCollapse', id: f.ids.A!, collapsed: true });
    f.engine.execute({ type: 'toggleCollapse', id: f.ids.B!, collapsed: true });
    expect(hasOpenParent(f.engine.tree, null)).toBe(false);
  });
});
