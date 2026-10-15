import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/helpers';
import { createUiStore } from '@/store/ui-store';
import { liftFirstLine, nameAllFromNotes, nameFromNote, watchNameFromNote } from './first-line';
import { registerNoteFlush } from './note-flush';
import type { EditorSession } from './session';

describe('liftFirstLine', () => {
  it('makes the first line the text and keeps the rest as the note', () => {
    expect(liftFirstLine("Lavazza\nThey're in house\nOne guy")).toEqual({ content: 'Lavazza', note: "They're in house\nOne guy" });
  });

  it('takes a one-line note whole and leaves no note', () => {
    expect(liftFirstLine('Merkezi fatigue saymamış lazım.')).toEqual({ content: 'Merkezi fatigue saymamış lazım.', note: '' });
  });

  it('skips blank lines before the first line and between it and the rest', () => {
    expect(liftFirstLine('\n  \nTitle\n\n\nBody\n\n- a')).toEqual({ content: 'Title', note: 'Body\n\n- a' });
  });

  it('keeps inline Markdown and drops a hard break marker and outer spaces', () => {
    expect(liftFirstLine('  **Bold** and [a link](https://x.test)  \nrest')).toEqual({ content: '**Bold** and [a link](https://x.test)', note: 'rest' });
    expect(liftFirstLine('Title\\\nrest')).toEqual({ content: 'Title', note: 'rest' });
  });

  it.each([
    ['', 'empty'],
    ['\n \n', 'blank'],
    ['# Heading\nrest', 'a heading'],
    ['#\nrest', 'an empty heading'],
    ['- item', 'a list'],
    ['* item', 'a star list'],
    ['+ item', 'a plus list'],
    ['1. one', 'a numbered list'],
    ['2) two', 'a numbered list with a parenthesis'],
    ['- [ ] task', 'a checklist'],
    ['> quote', 'a quote'],
    ['| a | b |\n| - | - |', 'a table'],
    ['```\ncode\n```', 'a code fence'],
    ['~~~\ncode\n~~~', 'a tilde fence'],
    ['![photo](https://x.test/a.png)', 'an image'],
    ['---', 'a rule'],
    ['***', 'a star rule'],
    ['___', 'an underscore rule'],
    ['<div>x</div>', 'HTML'],
    ['Title\n===', 'a setext heading'],
    ['Title\n---', 'a setext subheading'],
  ])('leaves %j alone (%s)', (note) => {
    expect(liftFirstLine(note)).toBeNull();
  });

  it('lifts lines that only look like block Markdown further in', () => {
    expect(liftFirstLine('#hashtag here')).toEqual({ content: '#hashtag here', note: '' });
    expect(liftFirstLine('-5 degrees')).toEqual({ content: '-5 degrees', note: '' });
    expect(liftFirstLine('2026 plans')).toEqual({ content: '2026 plans', note: '' });
    expect(liftFirstLine('Plan\n- one')).toEqual({ content: 'Plan', note: '- one' });
  });
});

describe('nameFromNote', () => {
  it('names an item with no text from its note, in one undo step', () => {
    const f = fixture(['', 'Named']);
    const id = f.ids['']!;
    f.engine.execute({ type: 'updateNote', id, note: 'Lavazza\n\nOne guy' });
    expect(nameFromNote(f.engine, id)).toBe(true);
    expect([f.engine.tree.get(id)!.content, f.engine.tree.get(id)!.note]).toEqual(['Lavazza', 'One guy']);
    f.engine.undo();
    expect([f.engine.tree.get(id)!.content, f.engine.tree.get(id)!.note]).toEqual(['', 'Lavazza\n\nOne guy']);
  });

  it('leaves items with text, without a liftable note, deleted, or missing', () => {
    const f = fixture(['Named', 'a', 'b', 'c']);
    f.engine.execute({ type: 'updateNote', id: f.ids['Named']!, note: 'First\nrest' });
    for (const [label, note] of [['a', ''], ['b', '# Heading'], ['c', 'Gone']] as const) {
      f.engine.execute({ type: 'updateContent', id: f.ids[label]!, content: ' ' });
      f.engine.execute({ type: 'updateNote', id: f.ids[label]!, note });
    }
    f.engine.execute({ type: 'deleteSubtree', id: f.ids['c']! });
    for (const label of ['Named', 'a', 'b', 'c']) expect(nameFromNote(f.engine, f.ids[label]!)).toBe(false);
    expect(nameFromNote(f.engine, 'missing')).toBe(false);
    expect(f.engine.tree.get(f.ids['b']!)!.content).toBe(' ');
    expect(f.engine.tree.get(f.ids['Named']!)!.note).toBe('First\nrest');
  });
});

describe('nameAllFromNotes', () => {
  it('names every nameless item with a liftable note, in one undo step', () => {
    const f = fixture(['', ['Parent', ['']], 'Named']);
    const ids = f.engine.tree.children(null);
    const nested = f.engine.tree.children(f.ids['Parent']!)[0]!;
    f.engine.execute({ type: 'updateNote', id: ids[0]!, note: 'Top\nrest' });
    f.engine.execute({ type: 'updateNote', id: nested, note: 'Nested' });
    f.engine.execute({ type: 'updateNote', id: f.ids['Named']!, note: 'Kept' });
    expect(nameAllFromNotes(f.engine)).toBe(2);
    const view = () => [ids[0]!, nested, f.ids['Named']!].map((id) => [f.engine.tree.get(id)!.content, f.engine.tree.get(id)!.note]);
    expect(view()).toEqual([['Top', 'rest'], ['Nested', ''], ['Named', 'Kept']]);
    expect(nameAllFromNotes(f.engine)).toBe(0);
    f.engine.undo();
    expect(view()).toEqual([['', 'Top\nrest'], ['', 'Nested'], ['Named', 'Kept']]);
  });
});

describe('watchNameFromNote', () => {
  function setup() {
    const f = fixture(['', 'Other']);
    const id = f.ids['']!;
    const ui = createUiStore();
    const flushed: string[] = [];
    const session: { nodeId: string | null; flush: () => void } = { nodeId: null, flush: () => void flushed.push(`content:${session.nodeId}`) };
    watchNameFromNote(f.engine, ui, session as unknown as EditorSession);
    return { f, id, ui, session, flushed, content: () => f.engine.tree.get(id)!.content };
  }

  it('saves the open note, then names the item, when the caret leaves the item', () => {
    const { f, id, ui, content } = setup();
    ui.focusNode(id, { kind: 'end' }, 'note');
    // The note editor's pending typing lands on the flush.
    const off = registerNoteFlush(id, () => f.engine.execute({ type: 'updateNote', id, note: 'Typed\nmore' }));
    // Into the item's own text: still the same item, nothing happens yet.
    ui.focusNode(id, { kind: 'end' });
    expect(content()).toBe('');
    ui.focusNode(id, { kind: 'end' }, 'note');
    ui.focusNode(f.ids['Other']!, { kind: 'end' });
    off();
    expect([content(), f.engine.tree.get(id)!.note]).toEqual(['Typed', 'more']);
  });

  it('saves the item\'s text first when leaving from it, so typed text is kept', () => {
    const { f, id, ui, session, flushed, content } = setup();
    f.engine.execute({ type: 'updateNote', id, note: 'First\nrest' });
    ui.focusNode(id, { kind: 'end' });
    session.nodeId = id;
    session.flush = () => {
      flushed.push('content');
      f.engine.execute({ type: 'updateContent', id, content: 'My name' });
    };
    ui.blur();
    expect(flushed).toEqual(['content']);
    expect([content(), f.engine.tree.get(id)!.note]).toEqual(['My name', 'First\nrest']);
  });

  it('does not flush the session when it holds another item', () => {
    const { f, id, ui, session, flushed, content } = setup();
    f.engine.execute({ type: 'updateNote', id, note: 'First\nrest' });
    ui.focusNode(id, { kind: 'end' });
    session.nodeId = f.ids['Other']!;
    ui.blur();
    expect(flushed).toEqual([]);
    expect(content()).toBe('First');
  });
});
