import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/helpers';
import { filteredRows, isFiltering, matchCount, pageRows, queryWords, toggleFilterRow, type Filter } from './filter';

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

  it('leaves out done rows and what is under them when hiding them, searching or not', () => {
    const f = fixture(spec as never);
    const tree = f.engine.tree;
    f.engine.execute({ type: 'toggleComplete', id: f.ids['Garden']! });
    f.engine.execute({ type: 'toggleComplete', id: f.ids['Tomatoes']! });
    const labels = (rows: { id: string }[]) => rows.map((r) => tree.get(r.id)!.content);
    expect(labels(pageRows(tree, null, null, true))).toEqual(['Projects', 'House', 'Paint the fence', 'Shopping', 'Bread', 'Ideas']);
    expect(labels(pageRows(tree, null, null))).toHaveLength(10);
    expect(labels(pageRows(tree, null, filter('tomato'), true))).toEqual([]);
    expect(labels(pageRows(tree, null, filter('tomato')))).toEqual(['Projects', 'Garden', 'Plant **tomatoes**', 'Shopping', 'Tomatoes']);
    // A zoomed-in done page still shows what's inside it.
    expect(labels(pageRows(tree, f.ids['Garden']!, null, true))).toEqual(['Plant **tomatoes**', 'Buy soil']);
    // Opening a match by hand shows its children, still without the done ones.
    let flt = filter('house');
    flt = toggleFilterRow(tree, null, flt, f.ids['Projects']!, true);
    flt = toggleFilterRow(tree, null, flt, f.ids['Projects']!, true);
    flt = toggleFilterRow(tree, null, flt, f.ids['House']!, true);
    f.engine.execute({ type: 'toggleComplete', id: f.ids['Paint the fence']! });
    expect(labels(filteredRows(tree, null, flt, true))).toEqual(['Projects', 'House']);
    expect(labels(filteredRows(tree, null, flt))).toEqual(['Projects', 'House', 'Paint the fence']);
  });

  it('opens or closes a row for the search as shown or hidden done rows leave it', () => {
    const f = fixture(spec as never);
    const tree = f.engine.tree;
    f.engine.execute({ type: 'toggleComplete', id: f.ids['Garden']! });
    const flt = filter('tomato');
    expect(toggleFilterRow(tree, null, flt, f.ids['Garden']!).open.get(f.ids['Garden']!)).toBe(false);
    // Hidden, the done row isn't on the page to toggle.
    expect(toggleFilterRow(tree, null, flt, f.ids['Garden']!, true)).toBe(flt);
  });

  it('shows the usual rows when the query is empty', () => {
    const f = fixture(spec as never);
    expect(pageRows(f.engine.tree, null, filter('  ')).length).toBe(pageRows(f.engine.tree, null, null).length);
  });
});

describe('in-place search filter: details', () => {
  const label = (f: ReturnType<typeof fixture>) => (id: string) => f.engine.tree.get(id)!.content;

  it('drops blank quoted phrases and trims quoted words', () => {
    expect(queryWords('" " a')).toEqual(['a']);
    expect(queryWords('"  Red  Paint " x')).toEqual(['red  paint', 'x']);
    expect(queryWords('ÄBC')).toEqual(['äbc']);
  });

  it('matches nothing for an empty query, and isFiltering says so', () => {
    const f = fixture(['A']);
    expect(filteredRows(f.engine.tree, null, filter(''))).toEqual([]);
    expect(isFiltering(null)).toBe(false);
    expect(isFiltering(filter(' " " '))).toBe(false);
    expect(isFiltering(filter('a'))).toBe(true);
  });

  it('does not match across the line between content and note', () => {
    const f = fixture(['ab']);
    f.engine.execute({ type: 'updateNote', id: f.ids.ab!, note: 'cd' });
    expect(filteredRows(f.engine.tree, null, filter('abcd'))).toEqual([]);
    expect(filteredRows(f.engine.tree, null, filter('ab cd')).map((r) => r.match)).toEqual([true]);
  });

  it('follows edits to content and note between searches', () => {
    const f = fixture(['apple']);
    const id = f.ids.apple!;
    expect(matchCount(filteredRows(f.engine.tree, null, filter('apple')))).toBe(1);
    f.engine.execute({ type: 'updateContent', id, content: 'pear' });
    expect(matchCount(filteredRows(f.engine.tree, null, filter('apple')))).toBe(0);
    expect(matchCount(filteredRows(f.engine.tree, null, filter('pear')))).toBe(1);
    f.engine.execute({ type: 'updateNote', id, note: 'plum' });
    expect(matchCount(filteredRows(f.engine.tree, null, filter('plum')))).toBe(1);
    f.engine.execute({ type: 'updateNote', id, note: 'fig' });
    expect(matchCount(filteredRows(f.engine.tree, null, filter('plum')))).toBe(0);
  });

  it('a kept or matching row without children is never open, even if opened by hand', () => {
    const f = fixture([['P', ['leaf']]]);
    const rows = filteredRows(f.engine.tree, null, filter('leaf', { open: new Map([[f.ids.leaf!, true]]) }));
    expect(rows).toEqual([
      { id: f.ids.P, depth: 0, open: true, match: false },
      { id: f.ids.leaf, depth: 1, open: false, match: true },
    ]);
  });

  it('a parent opened by hand that leads to a match still shows only the matching branch', () => {
    const f = fixture([['P', ['hit', 'miss']]]);
    const rows = filteredRows(f.engine.tree, null, filter('hit', { open: new Map([[f.ids.P!, true]]) }));
    expect(rows.map((r) => label(f)(r.id))).toEqual(['P', 'hit']);
  });

  it('a match opened by hand shows its whole visible subtree at the right depths', () => {
    const f = fixture([['Top', [['Match', [['C1', ['G1']], 'C2']]]]]);
    f.engine.execute({ type: 'toggleCollapse', id: f.ids.C2!, collapsed: true });
    const rows = filteredRows(f.engine.tree, null, filter('match', { open: new Map([[f.ids.Match!, true]]) }));
    expect(rows).toEqual([
      { id: f.ids.Top, depth: 0, open: true, match: false },
      { id: f.ids.Match, depth: 1, open: true, match: true },
      { id: f.ids.C1, depth: 2 },
      { id: f.ids.G1, depth: 3 },
      { id: f.ids.C2, depth: 2 },
    ]);
  });

  it('toggling a row the filter does not decide, or one not shown, changes nothing', () => {
    const f = fixture([['Match', ['child']], 'other']);
    let flt = filter('match');
    expect(toggleFilterRow(f.engine.tree, null, flt, f.ids.other!)).toBe(flt);
    flt = toggleFilterRow(f.engine.tree, null, flt, f.ids.Match!);
    expect(flt.open.get(f.ids.Match!)).toBe(true);
    expect(toggleFilterRow(f.engine.tree, null, flt, f.ids.child!)).toBe(flt);
    // Closing it again goes back to the default, so nothing is remembered.
    expect(toggleFilterRow(f.engine.tree, null, flt, f.ids.Match!).open.size).toBe(0);
  });
});
