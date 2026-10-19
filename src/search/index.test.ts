import { describe, expect, it } from 'vitest';
import { SearchIndex } from './index';
import { fixture } from '@/test/helpers';

describe('SearchIndex', () => {
  it('finds by content and note, ignoring Markdown syntax, and follows edits and deletes', () => {
    const f = fixture(['Buy **groceries**', 'Call the plumber', 'Read a book']);
    const index = new SearchIndex(f.engine);
    expect(index.size).toBe(3);
    expect(index.search('grocer').map((h) => h.id)).toEqual([f.ids['Buy **groceries**']]);
    expect(index.search('plumbr').map((h) => h.id)).toEqual([f.ids['Call the plumber']]); // fuzzy

    f.engine.execute({ type: 'updateNote', id: f.ids['Read a book']!, note: 'about volcanoes' });
    expect(index.search('volcano').map((h) => h.id)).toEqual([f.ids['Read a book']]);

    f.engine.execute({ type: 'updateContent', id: f.ids['Read a book']!, content: 'Watch a film' });
    expect(index.search('book')).toEqual([]);
    expect(index.search('film')).toHaveLength(1);

    f.engine.execute({ type: 'deleteSubtree', id: f.ids['Call the plumber']! });
    expect(index.search('plumber')).toEqual([]);
    f.engine.undo();
    expect(index.search('plumber')).toHaveLength(1);
    expect(index.search('   ')).toEqual([]);
    index.destroy();
  });
});

describe('SearchIndex details', () => {
  it('leaves deleted nodes out from the start and rebuilds without duplicates', () => {
    const f = fixture(['apple pie', 'apple tart']);
    f.engine.execute({ type: 'deleteSubtree', id: f.ids['apple tart']! });
    const index = new SearchIndex(f.engine);
    expect(index.size).toBe(1);
    index.rebuild();
    index.rebuild();
    expect(index.size).toBe(1);
    expect(index.search('apple').map((h) => h.id)).toEqual([f.ids['apple pie']]);
  });

  it('needs every word, trims the query and caps the results', () => {
    const f = fixture(['other', 'zebra', 'zebra crossing', 'zebra three']);
    f.engine.execute({ type: 'updateNote', id: f.ids.other!, note: 'zebra' });
    const index = new SearchIndex(f.engine);
    expect(index.search('zebra crossing').map((h) => h.id)).toEqual([f.ids['zebra crossing']]);
    const hits = index.search('  zebra  ');
    expect(hits).toHaveLength(4);
    expect(hits.every((h) => h.score > 0)).toBe(true);
    expect(index.search('zebra', 2)).toHaveLength(2);
  });

  it('stops following edits once destroyed', () => {
    const f = fixture(['A']);
    const index = new SearchIndex(f.engine);
    index.destroy();
    f.engine.execute({ type: 'createNode', id: 'x', parentId: null, content: 'walrus' });
    expect(index.search('walrus')).toEqual([]);
  });

  it('searchAny matches any term, by prefix only from 5 letters and fuzzily only from 6', () => {
    const f = fixture(['garden tools', 'kitchen', 'gardening club', 'the cat', 'catalog', 'planets']);
    const index = new SearchIndex(f.engine);
    const ids = (terms: string[], limit?: number) =>
      index.searchAny(terms, limit).map((h) => f.engine.tree.get(h.id)!.content);
    expect(ids([])).toEqual([]);
    expect(new Set(ids(['kitchen', 'tools']))).toEqual(new Set(['kitchen', 'garden tools']));
    expect(new Set(ids(['garde']))).toEqual(new Set(['garden tools', 'gardening club']));
    expect(ids(['cat'])).toEqual(['the cat']);
    expect(ids(['planet'])).toEqual(['planets']);
    expect(ids(['plnets'])).toEqual(['planets']);
    expect(ids(['kitchn'])).toEqual(['kitchen']);
    expect(ids(['tols'])).toEqual([]);
    expect(ids(['kitchen', 'tools'], 1)).toHaveLength(1);
  });
});
