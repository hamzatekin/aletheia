import { describe, expect, it } from 'vitest';
import { exportJson, exportMarkdown, exportOpml, parseBackup } from './export';
import { countItems, importItems, parseMarkdownOutline } from './import';
import { fixture, outline } from '@/test/helpers';

describe('export', () => {
  it('writes nested Markdown bullets with notes as indented paragraphs', () => {
    const f = fixture([['A', ['A1', ['A2', ['A2a']]]], 'B']);
    f.engine.execute({ type: 'updateNote', id: f.ids.A!, note: 'note line\n\nsecond' });
    expect(exportMarkdown(f.engine.tree, null)).toBe(
      ['- A', '  note line', '', '  second', '  - A1', '  - A2', '    - A2a', '- B', ''].join('\n'),
    );
    expect(exportMarkdown(f.engine.tree, f.ids.A2!)).toBe('- A2a\n');
    expect(exportMarkdown(f.engine.tree, f.ids.B!)).toBe('');
  });

  it('writes OPML with escaped attributes and _note', () => {
    const f = fixture([['A <b> & "q"', ['A1']]]);
    f.engine.execute({ type: 'updateNote', id: f.ids.A1!, note: 'n1\nn2' });
    const opml = exportOpml(f.engine.tree, null);
    expect(opml).toContain('<outline text="A &lt;b&gt; &amp; &quot;q&quot;">');
    expect(opml).toContain('<outline text="A1" _note="n1&#10;n2"/>');
    expect(opml).toContain('</outline>');
  });

  it('round-trips a JSON backup including deleted nodes', () => {
    const f = fixture(['A', 'B']);
    f.engine.execute({ type: 'deleteSubtree', id: f.ids.B! });
    const nodes = parseBackup(exportJson(f.engine.tree, 5));
    expect(nodes.map((n) => n.content).sort()).toEqual(['A', 'B']);
    expect(() => parseBackup('{"nodes":[]}')).toThrow();
  });
});

describe('parseMarkdownOutline', () => {
  it('nests by indentation, accepts -, *, + and numbers, and collects notes', () => {
    const md = ['- A', '  first note', '', '  more note', '  - A1', '\t- A1a (tab)', '* B', '1. C', '   - C1'].join('\n');
    expect(parseMarkdownOutline(md)).toEqual([
      { content: 'A', note: 'first note\n\nmore note', children: [
        { content: 'A1', note: '', children: [{ content: 'A1a (tab)', note: '', children: [] }] },
      ] },
      { content: 'B', note: '', children: [] },
      { content: 'C', note: '', children: [{ content: 'C1', note: '', children: [] }] },
    ]);
  });

  it('treats bullet-less text as one item per line and handles dedent past several levels', () => {
    expect(parseMarkdownOutline('one\n\ntwo\r\nthree')).toEqual([
      { content: 'one', note: '', children: [] },
      { content: 'two', note: '', children: [] },
      { content: 'three', note: '', children: [] },
    ]);
    const items = parseMarkdownOutline('- a\n  - b\n    - c\n- d');
    expect(items.map((i) => i.content)).toEqual(['a', 'd']);
    expect(countItems(items)).toBe(4);
  });

  it('round-trips the Markdown export', () => {
    const f = fixture([['A', ['A1', ['A2', ['A2a']]]], 'B']);
    f.engine.execute({ type: 'updateNote', id: f.ids.A2!, note: 'a note' });
    const md = exportMarkdown(f.engine.tree, null);
    const items = parseMarkdownOutline(md);
    const g = fixture([]);
    importItems(g.engine, null, items);
    expect(outline(g)).toEqual([['A', ['A1', ['A2', ['A2a']]]], 'B']);
    expect(exportMarkdown(g.engine.tree, null)).toBe(md);
  });
});

describe('importItems', () => {
  it('creates nodes under a parent after an anchor as one undo step', () => {
    const f = fixture([['P', ['x', 'z']]]);
    const r = importItems(f.engine, f.ids.P!, parseMarkdownOutline('- y\n  - y1'), f.ids.x);
    expect(r.ok).toBe(true);
    expect(outline(f)).toEqual([['P', ['x', ['y', ['y1']], 'z']]]);
    f.engine.undo();
    expect(outline(f)).toEqual([['P', ['x', 'z']]]);
  });
});
