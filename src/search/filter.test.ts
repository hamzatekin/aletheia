import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/helpers';
import { filteredRows, matchCount, pageRows, queryWords, toggleFilterRow, type Filter } from './filter';

const filter = (query: string, extra: Partial<Filter> = {}): Filter => ({ query, keep: new Set(), open: new Map(), ...extra });

describe('in-place search filter', () => {
  const spec = [
    ['Projects', [['Garden', ['Plant **tomatoes**', 'Buy soil']], ['House', ['Paint the fence']]]],
    ['Shopping', ['Tomatoes', 'Bread']],
    'Ideas',
  ] as const;

  it('splits words and keeps quoted phrases', () => {
    expect(queryWords('  Buy "red paint"  now ')).toEqual(['buy', 'red paint', 'now']);
    expect(queryWords('   ')).toEqual([]);
  });

  it('shows matches with the parents that lead to them, ignoring Markdown and collapsed state', () => {
    const f = fixture(spec as never);
    f.engine.execute({ type: 'toggleCollapse', id: f.ids['Projects']!, collapsed: true });
    const rows = filteredRows(f.engine.tree, null, filter('tomato'));
    const label = (id: string) => f.engine.tree.get(id)!.content;
    expect(rows.map((r) => [label(r.id), r.depth, r.match])).toEqual([
      ['Projects', 0, false],
      ['Garden', 1, false],
      ['Plant **tomatoes**', 2, true],
      ['Shopping', 0, false],
      ['Tomatoes', 1, true],
    ]);
    expect(matchCount(rows)).toBe(2);
    // The real collapsed state is untouched.
    expect(f.node('Projects').collapsed).toBe(true);
  });

  it('needs every word, and searches notes too', () => {
    const f = fixture(spec as never);
    f.engine.execute({ type: 'updateNote', id: f.ids['Bread']!, note: 'Sourdough from the corner bakery' });
    const labels = (q: string) => pageRows(f.engine.tree, null, filter(q)).filter((r) => r.match).map((r) => f.engine.tree.get(r.id)!.content);
    expect(labels('bakery')).toEqual(['Bread']);
    expect(labels('paint fence')).toEqual(['Paint the fence']);
    expect(labels('paint bread')).toEqual([]);
  });

  it('hides a match’s other children until it is opened, then shows them all', () => {
    const f = fixture(spec as never);
    const tree = f.engine.tree;
    let flt = filter('garden');
    let rows = filteredRows(tree, null, flt);
    expect(rows.map((r) => tree.get(r.id)!.content)).toEqual(['Projects', 'Garden']);
    expect(rows[1]!.open).toBe(false);

    flt = toggleFilterRow(tree, null, flt, f.ids['Garden']!);
    rows = filteredRows(tree, null, flt);
    expect(rows.map((r) => tree.get(r.id)!.content)).toEqual(['Projects', 'Garden', 'Plant **tomatoes**', 'Buy soil']);
    expect(rows[2]!.open).toBeUndefined();

    // Closing a parent that leads to a match hides it; opening it again forgets the override.
    flt = toggleFilterRow(tree, null, flt, f.ids['Projects']!);
    expect(filteredRows(tree, null, flt).map((r) => tree.get(r.id)!.content)).toEqual(['Projects']);
    flt = toggleFilterRow(tree, null, flt, f.ids['Projects']!);
    expect(flt.open.has(f.ids['Projects']!)).toBe(false);
  });

  it('keeps rows edited during the search, and searches only under the zoom root', () => {
    const f = fixture(spec as never);
    const tree = f.engine.tree;
    const rows = filteredRows(tree, f.ids['Projects']!, filter('tomato', { keep: new Set([f.ids['Paint the fence']!]) }));
    expect(rows.map((r) => [tree.get(r.id)!.content, r.depth])).toEqual([
      ['Garden', 0],
      ['Plant **tomatoes**', 1],
      ['House', 0],
      ['Paint the fence', 1],
    ]);
  });

  it('shows the usual rows when the query is empty', () => {
    const f = fixture(spec as never);
    expect(pageRows(f.engine.tree, null, filter('  ')).length).toBe(pageRows(f.engine.tree, null, null).length);
  });
});
