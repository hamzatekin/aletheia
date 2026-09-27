import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/helpers';
import { addToInbox, findInbox, sharedItem } from './capture';

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
