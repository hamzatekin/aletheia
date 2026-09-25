import { describe, expect, it } from 'vitest';
import { canDropOn, itemMode, minReparentLevel, resolveInstruction } from './dnd';
import { fixture, ok, outline } from '@/test/helpers';

const base = { currentLevel: 0, indentPerLevel: 24 };

describe('dnd resolution', () => {
  it('reorders above and below, and makes a child', () => {
    const f = fixture(['A', ['B', ['B1']], 'C']);
    const tree = f.engine.tree;

    const above = resolveInstruction(tree, f.ids.A!, 0, { type: 'reorder-above', ...base })!;
    ok(f.engine.execute(above.command(f.ids.C!)));
    expect(f.kids(null)).toEqual(['C', 'A', 'B']);
    expect(above.indicator).toEqual({ targetId: f.ids.A, edge: 'above', level: 0 });

    const below = resolveInstruction(tree, f.ids.B!, 0, { type: 'reorder-below', ...base })!;
    ok(f.engine.execute(below.command(f.ids.C!)));
    expect(f.kids(null)).toEqual(['A', 'B', 'C']);

    const child = resolveInstruction(tree, f.ids.B!, 0, { type: 'make-child', ...base })!;
    ok(f.engine.execute(child.command(f.ids.C!)));
    expect(outline(f)).toEqual(['A', ['B', ['C', 'B1']]]);
    expect(child.indicator).toEqual({ targetId: f.ids.B, edge: 'below', level: 1 });
  });

  it('reparents after the ancestor at the desired level, clamped to what is visually honest', () => {
    const f = fixture([['A', [['A1', ['A1a']], 'A2']], 'X']);
    const tree = f.engine.tree;
    // A1a is last in A1 but A1 is not last in A → can outdent to level 1 only.
    expect(minReparentLevel(tree, f.ids.A1a!, 2)).toBe(1);
    const r = resolveInstruction(tree, f.ids.A1a!, 2, { type: 'reparent', desiredLevel: 0, currentLevel: 2, indentPerLevel: 24 })!;
    expect(r.indicator).toEqual({ targetId: f.ids.A1a, edge: 'below', level: 1 });
    ok(f.engine.execute(r.command(f.ids.X!)));
    expect(outline(f)).toEqual([['A', [['A1', ['A1a']], 'X', 'A2']]]);

    // A2 is last in A, and A is a top-level node → can reparent to level 0.
    const r2 = resolveInstruction(tree, f.ids.A2!, 1, { type: 'reparent', desiredLevel: 0, currentLevel: 1, indentPerLevel: 24 })!;
    ok(f.engine.execute(r2.command(f.ids.X!)));
    expect(outline(f)).toEqual([['A', [['A1', ['A1a']], 'A2']], 'X']);
  });

  it('item modes and drop guards', () => {
    const f = fixture([['A', ['A1', 'A2']], 'B']);
    const tree = f.engine.tree;
    expect(itemMode(tree, f.ids.A!, 0)).toBe('expanded');
    expect(itemMode(tree, f.ids.A1!, 1)).toBe('standard');
    expect(itemMode(tree, f.ids.A2!, 1)).toBe('last-in-group');
    expect(itemMode(tree, f.ids.B!, 0)).toBe('standard');
    f.engine.execute({ type: 'toggleCollapse', id: f.ids.A! });
    expect(itemMode(tree, f.ids.A!, 0)).toBe('standard');
    expect(canDropOn(tree, f.ids.A!, f.ids.A1!)).toBe(false);
    expect(canDropOn(tree, f.ids.A!, f.ids.A!)).toBe(false);
    expect(canDropOn(tree, f.ids.A1!, f.ids.B!)).toBe(true);
    expect(resolveInstruction(tree, f.ids.B!, 0, { type: 'instruction-blocked', desired: { type: 'make-child', ...base } })).toBeNull();
  });
});
