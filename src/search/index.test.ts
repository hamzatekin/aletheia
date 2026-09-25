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
