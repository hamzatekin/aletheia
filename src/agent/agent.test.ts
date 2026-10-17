import { describe, expect, it } from 'vitest';
import { AiError, SessionExpired, type Step } from '@/ai/client';
import type { EditorSession } from '@/editor/session';
import { SearchIndex } from '@/search';
import { fixture, outline } from '@/test/helpers';
import { planChanges } from './changes';
import { AGENT_SCHEMA, AGENT_SYSTEM, linkCitations, parseReply, readReply, readResults, Refs, startPrompt } from './prompt';
import { runAgent } from './run';
import { createAgentService } from './service';

const session = { flush: () => {} } as unknown as EditorSession;

const spec = () =>
  fixture([
    ['Work', ['14 Oct', 'Suppliers']],
    ['Inbox', ['Lavazza', 'Liquidline', 'Call mum']],
  ]);

/** A relay that answers from a script and records what it was sent. */
function scripted(replies: string[], sessions = false) {
  const sent: { prompt: string; session: string | null }[] = [];
  const step: Step = async (_key, prompt, s) => {
    sent.push({ prompt, session: s });
    const text = replies.shift();
    if (text === undefined) throw new Error('script ran out');
    return { text, session: sessions ? 's1' : null };
  };
  return { sent, step };
}

describe('parseReply', () => {
  it('reads reads, answers, and falls back to plain text', () => {
    expect(parseReply('{"read":[{"search":" coffee "},{"open":3},{"open":"4"},{"nope":1}]}')).toEqual({ reads: [{ search: 'coffee' }, { open: 3 }, { open: 4 }] });
    expect(parseReply('Here:\n{"answer":" Done ","changes":[{"star":{"row":1}}]}')).toEqual({ answer: 'Done', changes: [{ star: { row: 1 } }] });
    expect(parseReply('{"answer":"Hi"}')).toEqual({ answer: 'Hi', changes: [] });
    expect(parseReply('Just text {not json}')).toEqual({ answer: 'Just text {not json}', changes: [] });
    expect(parseReply('{"read":[]}')).toEqual({ answer: '{"read":[]}', changes: [] });
  });

  it('finds the object among words, code fences and repeats', () => {
    // A real reply: the object in a fence, second thoughts, then the object again.
    const obj = '{"answer":"Grouped them [3].","changes":[{"create":{"under":4,"text":"Others","as":"o"}},{"move":{"row":7,"under":"o"}}]}';
    expect(parseReply(`\`\`\`json\n${obj}\n\`\`\`\n\nWait — that must be a single JSON object only; here it is:\n\n${obj}`)).toEqual({
      answer: 'Grouped them [3].',
      changes: [{ create: { under: 4, text: 'Others', as: 'o' } }, { move: { row: 7, under: 'o' } }],
    });
    expect(parseReply('{"read":[{"search":"a"}]}\n{"answer":"b"}')).toEqual({ answer: 'b', changes: [] });
    expect(parseReply('{"answer":"a"} then {"x":1}')).toEqual({ answer: 'a', changes: [] });
    expect(parseReply('Note { here: {"answer":"Use {braces} and \\"quotes\\" }"}')).toEqual({ answer: 'Use {braces} and "quotes" }', changes: [] });
    expect(parseReply('{"answer":"cut off')).toEqual({ answer: '{"answer":"cut off', changes: [] });
  });
});

describe('readReply', () => {
  it('takes the structured reply when it has a known shape, else reads the text', () => {
    expect(readReply('ignored', { answer: ' Done ', changes: [{ star: { row: 1, on: true } }] })).toEqual({ answer: 'Done', changes: [{ star: { row: 1, on: true } }] });
    expect(readReply('ignored', { read: [{ open: 2 }] })).toEqual({ reads: [{ open: 2 }] });
    expect(readReply('{"answer":"From text"}', {})).toEqual({ answer: 'From text', changes: [] });
    expect(readReply('{"answer":"From text"}', null)).toEqual({ answer: 'From text', changes: [] });
    expect(readReply('{"answer":"From text"}')).toEqual({ answer: 'From text', changes: [] });
  });
});

describe('prompts', () => {
  it('starts with the row they are on, the top of the outline and the question', () => {
    const f = spec();
    const refs = new Refs();
    f.engine.execute({ type: 'updateNote', id: f.ids.Lavazza!, note: 'Espresso beans' });
    const p = startPrompt({ tree: f.engine.tree, refs, item: f.ids.Lavazza!, history: [{ role: 'user', text: 'hi' }, { role: 'ai', text: 'hello' }], question: 'Move this to Work' });
    expect(p).toBe(
      [
        'They are on this row:',
        '[1] Lavazza  (inside: Inbox)',
        'Note:',
        'Espresso beans',
        'Nothing inside it.',
        '',
        'The top of their outline:',
        '[2] Work  (2 inside)',
        '  [3] 14 Oct',
        '  [4] Suppliers',
        '[5] Inbox  (3 inside)',
        '  [1] Lavazza  (has a note)',
        '  [6] Liquidline',
        '  [7] Call mum',
        '',
        'The conversation so far:',
        'Them: hi',
        'You: hello',
        '',
        'Them: Move this to Work',
      ].join('\n'),
    );
    expect(refs.list()).toEqual([f.ids.Lavazza, f.ids.Work, f.ids['14 Oct'], f.ids.Suppliers, f.ids.Inbox, f.ids.Liquidline, f.ids['Call mum']]);
    // The rules go as the system prompt, never next to note text.
    expect(AGENT_SYSTEM).toContain('Reply with exactly one JSON object and nothing else.');
    expect(AGENT_SYSTEM.startsWith("You are Avvos's personal assistant inside Aletheia")).toBe(true);
    expect(startPrompt({ tree: f.engine.tree, refs: new Refs(), item: null, history: [], question: 'q' }).startsWith('They are on the home page (the whole outline).\n\nThe top of their outline:\n[1] Work')).toBe(true);
  });

  it('shows what AI remembers on its own, not in the outline', () => {
    const f = fixture([['Work', ['14 Oct']], ['AI memory', ['Prefers short answers', 'Training for a 10k']]]);
    const p = startPrompt({ tree: f.engine.tree, refs: new Refs(), item: null, history: [], question: 'q' });
    expect(p).toBe(
      [
        'They are on the home page (the whole outline).',
        '',
        'What you remember about Avvos:',
        '[1] Prefers short answers',
        '[2] Training for a 10k',
        '',
        'The top of their outline:',
        '[3] Work  (1 inside)',
        '  [4] 14 Oct',
        '',
        'Them: q',
      ].join('\n'),
    );
  });

  it('turns citations into jump links', () => {
    const out = linkCitations('Do it [1, 2] now [3]. See [9]. A [link](x).', (n) => (n === 9 ? null : `Row ${n}`));
    expect(out).toBe('Do it [Row 1](#cite-1) [Row 2](#cite-2) now [Row 3](#cite-3). See [9]. A [link](x).');
  });

  it('answers searches and opens with numbered rows', () => {
    const f = spec();
    const refs = new Refs();
    const work = refs.ref(f.ids.Work!);
    const out = readResults(f.engine.tree, new SearchIndex(f.engine), refs, [{ search: 'liquidline' }, { open: work }, { open: 99 }, { search: 'zebra' }], true);
    expect(out).toBe(
      [
        'Results:',
        'search "liquidline":',
        '[2] Liquidline  (inside: Inbox)',
        '',
        'open [1]:',
        '[1] Work  (inside: top level)',
        'Inside it:',
        '[3] 14 Oct',
        '[4] Suppliers',
        '',
        'open [99]:',
        'There is no such row.',
        '',
        'search "zebra":',
        'No rows match.',
        '',
        'This is your last step: answer now with what you have.',
      ].join('\n'),
    );
  });
});

describe('planChanges', () => {
  it('creates a row, moves rows into it, and undoes it all', () => {
    const f = spec();
    const refs = new Refs();
    const [work, lavazza, liquid, mum] = [f.ids.Work!, f.ids.Lavazza!, f.ids.Liquidline!, f.ids['Call mum']!].map((id) => refs.ref(id));
    const before = outline(f);
    const plan = planChanges(f.engine.tree, refs, [
      { create: { under: work, text: 'Coffee', at: 'first', as: 'c' } },
      { move: { row: lavazza, under: 'c' } },
      { move: { row: liquid, under: 'c' } },
      { edit: { row: mum, text: 'Call mum on Sunday' } },
      { star: { row: work, on: true } },
    ]);
    expect(plan.dropped).toBe(0);
    expect(f.engine.batch(plan.items, 'ai').ok).toBe(true);
    expect(outline(f)).toEqual([
      ['Work', [['Coffee', ['Lavazza', 'Liquidline']], '14 Oct', 'Suppliers']],
      ['Inbox', ['Call mum on Sunday']],
    ]);
    expect(plan.done(f.engine.tree)).toEqual(['Created “Coffee” in “Work”.', 'Moved “Lavazza” to “Coffee”.', 'Moved “Liquidline” to “Coffee”.', 'Edited “Call mum on Sunday”.', 'Starred “Work”.']);
    expect(f.engine.batch(plan.undo(), 'undo ai').ok).toBe(true);
    expect(outline(f)).toEqual(before);
    expect(f.node('Work').starredAt ?? null).toBeNull();
  });

  it('remembers in a memory row it makes at the end of the top level, and undoes that too', () => {
    const f = spec();
    const before = outline(f);
    const plan = planChanges(f.engine.tree, new Refs(), [{ remember: 'Prefers short answers' }, { remember: ' Training for a 10k ' }, { remember: '  ' }]);
    expect(plan.dropped).toBe(1);
    expect(f.engine.batch(plan.items, 'ai').ok).toBe(true);
    expect(outline(f)).toEqual([...before, ['AI memory', ['Prefers short answers', 'Training for a 10k']]]);
    expect(plan.done(f.engine.tree)).toEqual(['Remembered “Prefers short answers”.', 'Remembered “Training for a 10k”.']);
    expect(f.engine.batch(plan.undo(), 'undo ai').ok).toBe(true);
    expect(outline(f)).toEqual(before);
  });

  it('adds memories to the memory row that is there, and undoes only them', () => {
    const f = fixture([['Work', []], ['AI memory', ['Prefers short answers']]]);
    const plan = planChanges(f.engine.tree, new Refs(), [{ remember: 'Training for a 10k' }]);
    f.engine.batch(plan.items, 'ai');
    expect(outline(f)).toEqual(['Work', ['AI memory', ['Prefers short answers', 'Training for a 10k']]]);
    f.engine.batch(plan.undo(), 'undo ai');
    expect(outline(f)).toEqual(['Work', ['AI memory', ['Prefers short answers']]]);
  });

  it('drops changes naming rows it was not shown, empty edits and moves into itself', () => {
    const f = spec();
    const refs = new Refs();
    const [work, oct] = [f.ids.Work!, f.ids['14 Oct']!].map((id) => refs.ref(id));
    const plan = planChanges(f.engine.tree, refs, [
      { move: { row: 42, under: work } },
      { move: { row: work, under: oct } },
      { create: { under: 'x', text: 'Lost' } },
      { create: { under: 'top', text: '' } },
      { edit: { row: work } },
      { delete: { row: work } },
      'nonsense',
      { create: { under: 'top', text: 'Ideas\nfor later' } },
    ]);
    expect(plan.dropped).toBe(7);
    f.engine.batch(plan.items, 'ai');
    expect(f.kids(null)).toEqual(['Work', 'Inbox', 'Ideas for later']);
    expect(plan.done(f.engine.tree)).toEqual(['Created “Ideas for later” in the top level.']);
  });
});

describe('runAgent', () => {
  it('runs the reads AI asks for, then returns its answer and changes', async () => {
    const f = spec();
    const { sent, step } = scripted(['{"read":[{"search":"call"}]}', '{"answer":"Starred it [7].","changes":[{"star":{"row":7}}]}']);
    const progress: string[] = [];
    const run = await runAgent({ tree: f.engine.tree, search: new SearchIndex(f.engine), step, key: 'k', item: null, history: [], question: 'Star the call', progress: (l) => progress.push(l) });
    expect(run.answer).toBe('Starred it [7].');
    expect(run.changes).toEqual([{ star: { row: 7 } }]);
    expect(run.refs.id(7)).toBe(f.ids['Call mum']);
    expect(progress).toEqual(['Searching “call”']);
    // No relay session: the second step carries the whole conversation.
    expect(sent[1]!.session).toBeNull();
    expect(sent[1]!.prompt.startsWith(sent[0]!.prompt)).toBe(true);
    expect(sent[1]!.prompt).toContain('You: {"read":[{"search":"call"}]}\n\nResults:\nsearch "call":\n[7] Call mum  (inside: Inbox)');
  });

  it('sends only what is new within a relay session, and starts over when it expires', async () => {
    const f = spec();
    const replies = ['{"read":[{"open":1}]}', '{"read":[{"open":2}]}', '{"answer":"ok"}'];
    const sent: { prompt: string; session: string | null; system: string }[] = [];
    let n = 0;
    const step: Step = async (_k, prompt, s, system) => {
      sent.push({ prompt, session: s, system });
      if (++n === 3) throw new SessionExpired('gone');
      return { text: replies.shift()!, session: 's1' };
    };
    const run = await runAgent({ tree: f.engine.tree, search: new SearchIndex(f.engine), step, key: 'k', item: null, history: [], question: 'q', progress: () => {} });
    expect(run.answer).toBe('ok');
    expect(sent.map((s) => s.session)).toEqual([null, 's1', 's1', null]);
    expect(sent.every((s) => s.system === AGENT_SYSTEM)).toBe(true);
    expect(sent[1]!.prompt.startsWith('Results:\nopen [1]:')).toBe(true);
    // After the session ended, the whole conversation goes again.
    expect(sent[3]!.prompt.startsWith(sent[0]!.prompt)).toBe(true);
    expect(sent[3]!.prompt).toContain('Results:\nopen [2]:');
  });

  it('sends the reply schema with each new session and uses the structured reply', async () => {
    const f = spec();
    const sent: { session: string | null; schema: object }[] = [];
    const replies = [
      { text: 'Looking.', structured: { read: [{ search: 'call' }] } },
      { text: 'Done.', structured: { answer: 'Starred it [7].', changes: [{ star: { row: 7, on: true } }] } },
    ];
    const step: Step = async (_k, _p, s, _system, schema) => {
      sent.push({ session: s, schema });
      return { ...replies.shift()!, session: null };
    };
    const run = await runAgent({ tree: f.engine.tree, search: new SearchIndex(f.engine), step, key: 'k', item: null, history: [], question: 'q', progress: () => {} });
    expect({ answer: run.answer, changes: run.changes }).toEqual({ answer: 'Starred it [7].', changes: [{ star: { row: 7, on: true } }] });
    expect(sent).toEqual([
      { session: null, schema: AGENT_SCHEMA },
      { session: null, schema: AGENT_SCHEMA },
    ]);
  });

  it('replays the structured step, not its text, when the conversation is sent again', async () => {
    const f = spec();
    const prompts: string[] = [];
    const replies = [{ text: 'Looking.', structured: { read: [{ search: 'call' }] } }, { text: '{"answer":"ok"}' }];
    const step: Step = async (_k, prompt) => {
      prompts.push(prompt);
      return { ...replies.shift()!, session: null };
    };
    await runAgent({ tree: f.engine.tree, search: new SearchIndex(f.engine), step, key: 'k', item: null, history: [], question: 'q', progress: () => {} });
    expect(prompts[1]).toContain('\n\nYou: {"read":[{"search":"call"}]}\n\nResults:\nsearch "call":');
  });

  it('gives up when AI keeps reading', async () => {
    const f = spec();
    const { step } = scripted(Array.from({ length: 6 }, () => '{"read":[{"search":"x"}]}'));
    const run = runAgent({ tree: f.engine.tree, search: new SearchIndex(f.engine), step, key: 'k', item: null, history: [], question: 'q', progress: () => {} });
    await expect(run).rejects.toThrow(AiError);
    await expect(run).rejects.toThrow("AI kept reading and didn't answer in 6 steps. Try a narrower question.");
  });
});

describe('AgentService', () => {
  const setup = (replies: string[], key: string | null = 'k') => {
    const f = spec();
    const r = scripted(replies);
    const agent = createAgentService({ engine: f.engine, session, search: new SearchIndex(f.engine), key: () => key, step: r.step });
    return { f, agent, sent: r.sent };
  };

  it('makes the changes asked for about the whole outline, with Undo', async () => {
    // On Home, rows are numbered from the top of the outline: Work is [1], Lavazza [5].
    const { f, agent } = setup(['{"answer":"Done.","changes":[{"create":{"under":1,"text":"Coffee","as":"c"}},{"move":{"row":5,"under":"c"}}]}']);
    const before = outline(f);
    await agent.ask('Make Coffee in Work and move Lavazza there');
    const s = agent.state.getState();
    expect(s.turns).toEqual([
      { role: 'user', text: 'Make Coffee in Work and move Lavazza there' },
      { role: 'ai', text: 'Done.', rows: s.turns[1]!.rows, did: ['Created “Coffee” in “Work”.', 'Moved “Lavazza” to “Coffee”.'], undoable: true },
    ]);
    expect({ busy: s.busy, steps: s.steps, error: s.error }).toEqual({ busy: false, steps: [], error: null });
    expect(outline(f)).toEqual([
      ['Work', ['14 Oct', 'Suppliers', ['Coffee', ['Lavazza']]]],
      ['Inbox', ['Liquidline', 'Call mum']],
    ]);
    agent.undoChanges(1);
    expect(outline(f)).toEqual(before);
    expect(agent.state.getState().turns[1]!.undone).toBe(true);
  });

  it('starts from the row you are on, and keeps one chat as you move around', async () => {
    const { f, agent, sent } = setup(['{"answer":"One"}', '{"answer":"Two"}']);
    agent.setPageRoot(f.ids.Inbox!);
    agent.setCurrentRow(f.ids.Lavazza!);
    expect(agent.here()).toBe(f.ids.Lavazza);
    await agent.ask('First');
    expect(sent[0]!.prompt.startsWith('They are on this row:\n[1] Lavazza  (inside: Inbox)')).toBe(true);
    // Zooming out keeps the row; zooming elsewhere is about the new page.
    agent.setPageRoot(null);
    expect(agent.here()).toBe(f.ids.Lavazza);
    agent.setPageRoot(f.ids.Work!);
    expect(agent.here()).toBe(f.ids.Work);
    await agent.ask('Second');
    expect(sent[1]!.prompt).toContain('The conversation so far:\nThem: First\nYou: One\n\nThem: Second');
    expect(agent.state.getState().turns.map((t) => t.text)).toEqual(['First', 'One', 'Second', 'Two']);
    agent.clear();
    expect(agent.state.getState().turns).toEqual([]);
  });

  it('keeps row numbers for the whole chat, so earlier answers still name the same rows', async () => {
    const { f, agent, sent } = setup(['{"answer":"It\'s [7]."}', '{"answer":"Starred [7].","changes":[{"star":{"row":7,"on":true}}]}', '{"answer":"ok"}']);
    await agent.ask('Which row is the call?');
    agent.setCurrentRow(f.ids['Call mum']!);
    await agent.ask('Star it');
    expect(sent[1]!.prompt).toBe(
      [
        'They are on this row:',
        '[7] Call mum  (inside: Inbox)',
        'Nothing inside it.',
        '',
        'The top of their outline:',
        '[1] Work  (2 inside)',
        '  [2] 14 Oct',
        '  [3] Suppliers',
        '[4] Inbox  (3 inside)',
        '  [5] Lavazza',
        '  [6] Liquidline',
        '  [7] Call mum',
        '',
        'The conversation so far:',
        'Them: Which row is the call?',
        "You: It's [7].",
        '',
        'Them: Star it',
      ].join('\n'),
    );
    expect(f.engine.tree.get(f.ids['Call mum']!)!.starredAt).toBeTypeOf('number');
    const turns = agent.state.getState().turns;
    expect(turns[1]!.rows![6]).toBe(f.ids['Call mum']);
    expect(turns[3]!.rows![6]).toBe(f.ids['Call mum']);
    // A new chat numbers from 1 again.
    agent.clear();
    await agent.ask('q');
    expect(sent[2]!.prompt.startsWith('They are on this row:\n[1] Call mum  (inside: Inbox)')).toBe(true);
  });

  it('remembers across chats: a memory from one chat is in the next', async () => {
    const { f, agent, sent } = setup(['{"answer":"Noted, Avvos.","changes":[{"remember":"Training for a 10k"}]}', '{"answer":"Keep going."}']);
    await agent.ask('I started training for a 10k');
    expect(agent.state.getState().turns[1]!.did).toEqual(['Remembered “Training for a 10k”.']);
    agent.clear();
    await agent.ask('How am I doing?');
    expect(sent[1]!.prompt).toContain('What you remember about Avvos:\n[1] Training for a 10k\n\nThe top of their outline:\n[2] Work');
    expect(f.kids(null)).toEqual(['Work', 'Inbox', 'AI memory']);
  });

  it('needs sync on, and shows a failed step as an error', async () => {
    const off = setup([], null);
    await off.agent.ask('hi');
    expect(off.agent.state.getState().error).toBe('Turn on sync in Settings to use AI on this device.');
    const { agent } = setup([]);
    await agent.ask('hi');
    expect(agent.state.getState()).toMatchObject({ busy: false, error: 'AI failed.', turns: [{ role: 'user', text: 'hi' }] });
  });
});
