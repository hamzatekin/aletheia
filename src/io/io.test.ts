import { describe, expect, it } from 'vitest';
import { bulletLine, exportJson, exportMarkdown, exportOpml, noteBlock, parseBackup } from './export';
import { countItems, importAsTopNode, importCommands, importItems, importTitle, parseMarkdownOutline } from './import';
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

describe('importAsTopNode', () => {
  it('puts the import under one new node at the top of Home, as one undo step', () => {
    const f = fixture(['A', 'B']);
    const id = importAsTopNode(f.engine, importTitle('notes.md', new Date(2026, 8, 29)), parseMarkdownOutline('- y\n  - y1\n- z'));
    expect(id).not.toBeNull();
    expect(outline(f)).toEqual([['Imported from notes.md, 29 Sep 2026', [['y', ['y1']], 'z']], 'A', 'B']);
    f.engine.undo();
    expect(outline(f)).toEqual(['A', 'B']);
  });
});

describe('export details', () => {
  it('writes the whole OPML document exactly, nesting children and closing tags', () => {
    const f = fixture([['A', [['A1', ['A1a']]]], 'B']);
    f.engine.execute({ type: 'updateNote', id: f.ids.B!, note: 'x > y' });
    expect(exportOpml(f.engine.tree, null, 'My <notes>')).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<opml version="2.0">',
        '  <head><title>My &lt;notes&gt;</title></head>',
        '  <body>',
        '    <outline text="A">',
        '      <outline text="A1">',
        '        <outline text="A1a"/>',
        '      </outline>',
        '    </outline>',
        '    <outline text="B" _note="x &gt; y"/>',
        '  </body>',
        '</opml>',
        '',
      ].join('\n'),
    );
    expect(exportOpml(f.engine.tree, f.ids.B!)).toContain('<head><title>Aletheia</title></head>\n  <body>\n  </body>');
  });

  it('writes a JSON backup with its format, version, time and every node', () => {
    const f = fixture(['A']);
    const backup = JSON.parse(exportJson(f.engine.tree, 1234)) as Record<string, unknown>;
    expect(backup).toEqual({ format: 'aletheia-backup', version: 1, exportedAt: 1234, nodes: [f.node('A')] });
    expect(exportJson(f.engine.tree, 1)).toContain('\n  "format": "aletheia-backup"');
  });

  it('refuses files that are not backups', () => {
    expect(() => parseBackup('{"format":"aletheia-backup"}')).toThrow('not an Aletheia backup');
    expect(() => parseBackup('{"format":"other","nodes":[]}')).toThrow('not an Aletheia backup');
    expect(() => parseBackup('{"format":"aletheia-backup","nodes":{}}')).toThrow('not an Aletheia backup');
    expect(parseBackup('{"format":"aletheia-backup","nodes":[]}')).toEqual([]);
  });

  it('indents every note line under its bullet, keeping blank lines empty', () => {
    expect(noteBlock('a\n\nb', 1)).toBe('    a\n\n    b');
    expect(bulletLine('x', 2)).toBe('    - x');
  });
});

describe('import details', () => {
  it('names an import after its file and date, for every month', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach((m, i) => expect(importTitle('a.md', new Date(2025, i, 3))).toBe(`Imported from a.md, 3 ${m} 2025`));
  });

  it('makes createNode commands in document order, each after the previous sibling', () => {
    const cmds = importCommands('P', [
      { content: 'a', note: 'na', children: [{ content: 'a1', note: '', children: [] }] },
      { content: 'b', note: '', children: [] },
    ]);
    expect(cmds.map((c) => c.type)).toEqual(['createNode', 'createNode', 'createNode']);
    const [a, a1, b] = cmds as Extract<(typeof cmds)[number], { type: 'createNode' }>[];
    expect(a).toEqual({ type: 'createNode', id: a!.id, parentId: 'P', content: 'a', note: 'na', at: 'last' });
    expect(a1).toEqual({ type: 'createNode', id: a1!.id, parentId: a!.id, content: 'a1', note: '', at: 'last' });
    expect(b).toEqual({ type: 'createNode', id: b!.id, parentId: 'P', content: 'b', note: '', at: { after: a!.id } });
    expect(new Set([a!.id, a1!.id, b!.id]).size).toBe(3);
    const anchored = importCommands(null, [{ content: 'x', note: '', children: [] }], 'anchor');
    expect(anchored[0]).toMatchObject({ parentId: null, at: { after: 'anchor' } });
  });

  it('counts nested items and returns null when an import changes nothing', () => {
    expect(countItems([])).toBe(0);
    expect(countItems([{ content: 'a', note: '', children: [{ content: 'b', note: '', children: [{ content: 'c', note: '', children: [] }] }] }])).toBe(3);
    const f = fixture(['A']);
    expect(importItems(f.engine, null, [])).toEqual({ ok: false, reason: 'nothing to do' });
  });

  it('parses notes: drops text before the first bullet, trims trailing blank lines, keeps inner indentation', () => {
    expect(parseMarkdownOutline('intro\n- a\n  line 1\n    indented\n\n\n- b')).toEqual([
      { content: 'a', note: 'line 1\nindented', children: [] },
      { content: 'b', note: '', children: [] },
    ]);
    expect(parseMarkdownOutline('- a\n\n  after blank')).toEqual([{ content: 'a', note: 'after blank', children: [] }]);
    expect(parseMarkdownOutline('-a\n- b')).toEqual([{ content: 'b', note: '', children: [] }]);
    expect(parseMarkdownOutline('2) two\n  10. ten')).toEqual([{ content: 'two', note: '', children: [{ content: 'ten', note: '', children: [] }] }]);
    expect(parseMarkdownOutline('- a\n\t- tab\n    - four')).toEqual([
      { content: 'a', note: '', children: [{ content: 'tab', note: '', children: [] }, { content: 'four', note: '', children: [] }] },
    ]);
    expect(parseMarkdownOutline('')).toEqual([]);
    expect(parseMarkdownOutline('-   spaced   ')).toEqual([{ content: 'spaced', note: '', children: [] }]);
  });
});

describe('import operations', () => {
  it('records imports as "import" operations, with an empty note on the title node', () => {
    const f = fixture([]);
    const r = importItems(f.engine, null, [{ content: 'a', note: '', children: [] }]);
    expect(r.ok && r.op.type).toBe('import');
    const id = importAsTopNode(f.engine, 'Title', [{ content: 'b', note: '', children: [] }]);
    expect(f.engine.tree.get(id!)).toMatchObject({ content: 'Title', note: '', parentId: null });
    expect(f.kids(null)).toEqual(['Title', 'a']);
  });
});
