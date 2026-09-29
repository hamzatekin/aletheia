import { describe, expect, it } from 'vitest';
import type { EditorSession } from '@/editor/session';
import { SearchIndex } from '@/search';
import { fixture } from '@/test/helpers';
import { textMatches } from './find';
import { answerItems, chatPrompt, linkCitations, outlineDigest, parseRelated, relatedPrompt } from './prompts';
import { createRelatedService } from './service';

const session = { flush: () => {} } as unknown as EditorSession;

const spec = () =>
  fixture([
    ['Launch pricing', ['Free tier limits', 'Compare with Dynalist']],
    ['Ideas', [['Pricing page copy', ['Pricing FAQ']], 'Dark theme']],
    ['Groceries', ['milk', 'eggs']],
  ]);

describe('textMatches', () => {
  it('finds rows elsewhere sharing the item words, not the item itself or rows inside it', () => {
    const f = spec();
    const hits = textMatches(f.engine.tree, new SearchIndex(f.engine), f.ids['Launch pricing']!).map((h) => h.id);
    // A row and the row above it are not both listed.
    expect(hits.filter((h) => h === f.ids['Pricing page copy'] || h === f.ids['Pricing FAQ'])).toHaveLength(1);
    expect(hits).not.toContain(f.ids['Launch pricing']);
    expect(hits).not.toContain(f.ids['Free tier limits']);
    expect(hits).not.toContain(f.ids.milk);
  });
});

describe('outlineDigest', () => {
  it('numbers the other rows, indented, leaving the item and its rows out', () => {
    const f = spec();
    const d = outlineDigest(f.engine.tree, f.ids['Launch pricing']!, []);
    expect(d.text).toContain('[1] Ideas\n  [2] Pricing page copy\n    [3] Pricing FAQ');
    expect(d.text).not.toContain('Free tier');
    expect(d.rows[1]).toBe(f.ids['Pricing page copy']);
  });
});

describe('parseRelated', () => {
  it('reads the rows AI picked and drops made-up or excluded ones', () => {
    const f = spec();
    const id = f.ids['Launch pricing']!;
    const { rows } = relatedPrompt(f.engine.tree, id, []);
    const answer = 'Sure:\n{"related":[{"row":2,"why":"Same pricing work","duplicate":false},{"row":99},{"row":3,"duplicate":true},{"row":2}]}';
    expect(parseRelated(f.engine.tree, id, answer, rows)).toEqual([
      { id: f.ids['Pricing page copy'], why: 'Same pricing work' },
      { id: f.ids['Pricing FAQ'], duplicate: true },
    ]);
    expect(() => parseRelated(f.engine.tree, id, 'no idea', rows)).toThrow();
  });
});

describe('chat helpers', () => {
  it('numbers the item [0] and the related rows from [1]', () => {
    const f = spec();
    const p = chatPrompt(f.engine.tree, f.ids['Launch pricing']!, [f.ids['Pricing page copy']!], [{ role: 'user', text: 'hi' }], 'Next?');
    expect(p).toContain('The item [0]:\nTitle: Launch pricing');
    expect(p).toContain('[1] Pricing page copy  (inside: Ideas)');
    expect(p).toContain('    - Pricing FAQ');
    expect(p).toContain('Them: hi');
    expect(p).toContain('Them: Next?');
  });

  it('turns citations into jump links', () => {
    const out = linkCitations('Do it [1, 2] now [0]. See [9].', (n) => (n === 9 ? null : `Row ${n}`));
    expect(out).toBe('Do it [Row 1](#cite-1) [Row 2](#cite-2) now [Row 0](#cite-0). See [9].');
  });

  it('adds bullets as items, without citations or the lead-in', () => {
    expect(answerItems('Here you go:\n- Draft the page [1]\n  - Short\n- Ask **Ali** [2]\n\nGood luck')).toEqual([
      { content: 'Draft the page', note: '', children: [{ content: 'Short', note: '', children: [] }] },
      { content: 'Ask **Ali**', note: '', children: [] },
    ]);
    expect(answerItems('One idea.\n\nAnother [0].')).toEqual([
      { content: 'One idea.', note: '', children: [] },
      { content: 'Another.', note: '', children: [] },
    ]);
  });
});

describe('RelatedService', () => {
  const setup = (complete: (prompt: string) => Promise<string>, key: string | null = 'k') => {
    const f = spec();
    const related = createRelatedService({ engine: f.engine, session, search: new SearchIndex(f.engine), key: () => key, complete: (_k, p) => complete(p) });
    return { f, related };
  };

  it('follows the zoomed item and lists AI picks before text matches', async () => {
    const { f, related } = setup(async () => '{"related":[{"row":5,"why":"Also about launch"}]}');
    related.setPageRoot(f.ids['Launch pricing']!);
    expect(related.list().length).toBeGreaterThan(0);
    related.show();
    await related.findMore();
    const digest = outlineDigest(f.engine.tree, f.ids['Launch pricing']!, related.state.getState().text.map((t) => t.id));
    const first = related.list()[0]!;
    expect(first).toEqual({ id: digest.rows[4], why: 'Also about launch' });
  });

  it('moves a row here and back', () => {
    const { f, related } = setup(async () => '{"related":[]}');
    const target = f.ids['Launch pricing']!;
    related.setPageRoot(target);
    related.pullHere(f.ids['Dark theme']!);
    expect(f.kids('Launch pricing')).toEqual(['Free tier limits', 'Compare with Dynalist', 'Dark theme']);
    related.undoPull(f.ids['Dark theme']!);
    expect(f.kids('Ideas')).toEqual(['Pricing page copy', 'Dark theme']);
  });

  it('answers questions and adds an answer to the outline, with Undo', async () => {
    const { f, related } = setup(async () => '- Write the FAQ [1]\n- Set the price');
    related.setPageRoot(f.ids['Launch pricing']!);
    await related.ask('Next steps?');
    const turns = related.state.getState().chat.turns;
    expect(turns.map((t) => t.role)).toEqual(['user', 'ai']);
    related.insertAnswer(1);
    expect(f.kids('Launch pricing')).toEqual(['Free tier limits', 'Compare with Dynalist', 'Write the FAQ', 'Set the price']);
    expect(related.state.getState().chat.turns[1]!.added).toHaveLength(2);
    related.undoInsert(1);
    expect(f.kids('Launch pricing')).toEqual(['Free tier limits', 'Compare with Dynalist']);
  });

  it('needs sync on for AI, but still lists text matches', async () => {
    const { f, related } = setup(async () => '{}', null);
    related.setPageRoot(f.ids['Launch pricing']!);
    await related.ask('hi');
    expect(related.state.getState().chat.error).toMatch(/sync/);
    expect(related.list().length).toBeGreaterThan(0);
  });
});
