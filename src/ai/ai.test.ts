import { describe, expect, it } from 'vitest';
import type { EditorSession } from '@/editor/session';
import { fixture } from '@/test/helpers';
import { AiError, httpStep, SessionExpired, type Complete } from './client';
import { createAiService } from './service';
import { cleanTitle, titlePrompt } from './suggest-title';

const session = { flush: () => {} } as unknown as EditorSession;

describe('titlePrompt', () => {
  it('sends the note and the items under the node', () => {
    const f = fixture([['Trip', ['**Flights**', ['Hotel', ['Near the station']]]]]);
    f.engine.execute({ type: 'updateNote', id: f.ids.Trip!, note: 'Lisbon in May' });
    const prompt = titlePrompt(f.engine.tree, f.ids.Trip!)!;
    expect(prompt).toContain('Current title: Trip');
    expect(prompt).toContain('Note:\nLisbon in May');
    expect(prompt).toContain('Items under it:\n- Flights\n- Hotel\n  - Near the station');
  });

  it('has nothing to ask for a bare row', () => {
    const f = fixture(['Alone']);
    expect(titlePrompt(f.engine.tree, f.ids.Alone!)).toBeNull();
  });
});

describe('cleanTitle', () => {
  it('keeps one plain line', () => {
    expect(cleanTitle('"Weekly groceries."')).toBe('Weekly groceries');
    expect(cleanTitle('\nTitle: **Lisbon trip**\nBecause…')).toBe('Lisbon trip');
    expect(cleanTitle('# Plan')).toBe('Plan');
    expect(cleanTitle('x'.repeat(200))).toHaveLength(120);
  });
});

describe('suggestTitle', () => {
  const setup = (complete: Complete, key: string | null = 'k') => {
    const f = fixture([['Old', ['milk', 'eggs']]]);
    const ai = createAiService({ engine: f.engine, session, key: () => key, complete });
    return { f, ai, id: f.ids.Old!, content: () => f.engine.tree.get(f.ids.Old!)!.content };
  };

  it('puts the title in the row, with an Undo', async () => {
    const { ai, id, content } = setup(async () => 'Groceries');
    await ai.suggestTitle(id);
    expect(content()).toBe('Groceries');
    const notice = ai.state.getState().notice!;
    expect(notice.kind).toBe('done');
    notice.action!.run();
    expect(content()).toBe('Old');
    expect(ai.state.getState().busy.size).toBe(0);
  });

  it('does not overwrite a row edited while waiting', async () => {
    let s!: ReturnType<typeof setup>;
    s = setup(async () => {
      s.f.engine.execute({ type: 'updateContent', id: s.id, content: 'Typed meanwhile' });
      return 'Groceries';
    });
    await s.ai.suggestTitle(s.id);
    expect(s.content()).toBe('Typed meanwhile');
    expect(s.ai.state.getState().notice).toMatchObject({ kind: 'done', text: 'Suggested: Groceries', action: { label: 'Use' } });
  });

  it('shows the error and leaves the row alone', async () => {
    const { ai, id, content } = setup(async () => {
      throw new AiError('AI is unavailable right now.');
    });
    await ai.suggestTitle(id);
    expect(content()).toBe('Old');
    expect(ai.state.getState().notice).toEqual({ kind: 'error', text: 'AI is unavailable right now.' });
  });

  it('needs sync on', async () => {
    const { ai, id } = setup(async () => 'x', null);
    expect(ai.available()).toBe(false);
    await ai.suggestTitle(id);
    expect(ai.state.getState().notice?.kind).toBe('error');
  });
});

describe('httpStep', () => {
  const server = (replies: Response[]) => {
    const sent: unknown[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return replies.shift()!;
    }) as typeof fetch;
    return { sent, step: httpStep('', fetchFn) };
  };

  it('sends the system prompt and schema only when a session starts, and returns the structured reply', async () => {
    const { sent, step } = server([
      Response.json({ text: 'x', session: 's1', structured: { answer: 'Hi' } }),
      Response.json({ text: 'y', session: 's1' }),
      Response.json({ error: 'session expired' }, { status: 410 }),
    ]);
    const schema = { type: 'object' };
    expect(await step('k', 'Start', null, 'Rules', schema)).toEqual({ text: 'x', session: 's1', structured: { answer: 'Hi' } });
    expect(await step('k', 'Next', 's1', 'Rules', schema)).toEqual({ text: 'y', session: 's1' });
    await expect(step('k', 'Again', 's1', 'Rules', schema)).rejects.toThrow(SessionExpired);
    expect(sent).toEqual([
      { prompt: 'Start', session: null, system: 'Rules', json_schema: { type: 'object' } },
      { prompt: 'Next', session: 's1' },
      { prompt: 'Again', session: 's1' },
    ]);
  });
});
