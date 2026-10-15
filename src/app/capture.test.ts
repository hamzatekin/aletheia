import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/helpers';
import { addedLabel, addToInbox, captureTitle, findInbox, liftCaptureTitles, sharedItem } from './capture';

describe('sharedItem', () => {
  it('makes a titled link from a shared page', () => {
    expect(sharedItem({ title: 'Mirrors in Workflowy', text: 'https://blog.workflowy.com/mirrors' })).toEqual({
      content: '[Mirrors in Workflowy](https://blog.workflowy.com/mirrors)',
      note: '',
    });
    expect(sharedItem({ title: 'A [draft] page', url: 'https://x.test/a', text: 'A [draft] page\nworth reading' })).toEqual({
      content: '[A draft page](https://x.test/a)',
      note: 'worth reading',
    });
  });

  it('uses the first line of text as the item and the rest as its note', () => {
    expect(sharedItem({ text: 'Call Ayşe\nabout the trip\non Friday' })).toEqual({ content: 'Call Ayşe', note: 'about the trip\non Friday' });
    expect(sharedItem({ text: 'Look at https://x.test/b later' })).toEqual({ content: '[Look at later](https://x.test/b)', note: '' });
    expect(sharedItem({ url: 'https://x.test/c' })).toEqual({ content: 'https://x.test/c', note: '' });
    expect(sharedItem({})).toEqual({ content: '', note: '' });
  });
});

describe('captureTitle', () => {
  it('is the date and time old quick adds were named with, in the given language', () => {
    const at = new Date(2026, 9, 12, 13, 54);
    expect(captureTitle(at, 'en-US')).toBe('Oct 12, 2026, 1:54 PM');
    expect(captureTitle(at, 'en-GB')).toBe('12 Oct 2026, 13:54');
    expect(captureTitle(at, 'tr-TR')).toBe('12 Eki 2026 13:54');
  });
});

describe('addToInbox', () => {
  it('makes an Inbox at the top of Home once, and adds new items at its top in one undo step', () => {
    const f = fixture(['Projects', 'Someday']);
    const first = addToInbox(f.engine, { content: 'one', note: '' });
    expect(f.kids(null)).toEqual(['Inbox', 'Projects', 'Someday']);
    const second = addToInbox(f.engine, { content: 'two', note: 'details' });
    expect(second.inbox).toBe(first.inbox);
    const inbox = () => f.engine.tree.children(first.inbox).map((id) => f.engine.tree.get(id)!.content);
    expect(inbox()).toEqual(['two', 'one']);
    expect(f.engine.tree.get(second.id)!.note).toBe('details');
    f.engine.undo();
    expect(inbox()).toEqual(['one']);
    f.engine.undo();
    expect(findInbox(f.engine.tree)).toBeNull();
  });

  it('uses an existing top-level Inbox, whatever its case, and opens it', () => {
    const f = fixture(['Projects', ['**inbox**', ['old']]]);
    f.engine.execute({ type: 'toggleCollapse', id: f.ids['**inbox**']!, collapsed: true });
    addToInbox(f.engine, { content: 'new', note: '' });
    expect(f.kids('**inbox**')).toEqual(['new', 'old']);
    expect(f.node('**inbox**').collapsed).toBe(false);
  });
});

describe('addedLabel', () => {
  const now = new Date(2026, 9, 15, 9, 0);
  const at = new Date(2026, 9, 13, 11, 32).getTime();

  it('shows day, month and time this year, and only day and month when short', () => {
    expect(addedLabel(at, { now, locale: 'tr-TR' })).toBe('13 Eki 11:32');
    expect(addedLabel(at, { now, locale: 'en-US' })).toBe('Oct 13, 11:32 AM');
    expect(addedLabel(at, { now, locale: 'tr-TR', short: true })).toBe('13 Eki');
  });

  it('shows the year instead of the time for other years', () => {
    const old = new Date(2025, 11, 31, 23, 59).getTime();
    expect(addedLabel(old, { now, locale: 'tr-TR' })).toBe('31 Ara 2025');
    expect(addedLabel(old, { now, locale: 'en-US', short: true })).toBe('Dec 31, 2025');
  });
});

describe('liftCaptureTitles', () => {
  /** An Inbox item added at a known moment, then given `content` (a function of when it was added) and `note`. */
  function item(f: ReturnType<typeof fixture>, content: (createdAt: number) => string, note: string): string {
    const { id } = addToInbox(f.engine, { content: 'x', note });
    const createdAt = f.engine.tree.get(id)!.createdAt;
    f.engine.execute({ type: 'updateContent', id, content: content(createdAt) });
    return id;
  }
  const dated = (at: number) => captureTitle(new Date(at), 'en-US');

  it('names Inbox items still called by their date with their note\'s first line, in one undo step', () => {
    const f = fixture(['Projects']);
    const plain = item(f, () => 'Groceries', 'milk');
    const empty = item(f, dated, '');
    const list = item(f, dated, '- one\n- two');
    const lavazza = item(f, dated, "Lavazza\nThey're in house\nOne guy");
    const renamed = item(f, () => 'Oct 1, 2020, 9:00 AM', 'Kept\nas is');
    const long = item(f, dated, 'Merkezi fatigue saymamış lazım.');
    const before = (id: string) => [f.engine.tree.get(id)!.content, f.engine.tree.get(id)!.note];
    const was = [plain, empty, list, lavazza, renamed, long].map(before);

    expect(liftCaptureTitles(f.engine, 'en-US')).toBe(2);
    expect([plain, empty, list, lavazza, renamed, long].map(before)).toEqual([
      ['Groceries', 'milk'],
      was[1],
      was[2],
      ['Lavazza', "They're in house\nOne guy"],
      ['Oct 1, 2020, 9:00 AM', 'Kept\nas is'],
      ['Merkezi fatigue saymamış lazım.', ''],
    ]);
    expect(liftCaptureTitles(f.engine, 'en-US')).toBe(0);
    f.engine.undo();
    expect([plain, empty, list, lavazza, renamed, long].map(before)).toEqual(was);
  });

  it('leaves dated items outside the Inbox, and does nothing without an Inbox', () => {
    const f = fixture([]);
    expect(liftCaptureTitles(f.engine, 'en-US')).toBe(0);
    f.engine.execute({ type: 'createNode', id: 'n1', parentId: null, content: 'x', note: 'First\nrest' });
    f.engine.execute({ type: 'updateContent', id: 'n1', content: dated(f.engine.tree.get('n1')!.createdAt) });
    addToInbox(f.engine, { content: 'other', note: '' });
    expect(liftCaptureTitles(f.engine, 'en-US')).toBe(0);
    expect(f.engine.tree.get('n1')!.note).toBe('First\nrest');
  });
});
