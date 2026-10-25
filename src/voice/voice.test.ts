import { describe, expect, it } from 'vitest';
import { AiError } from '@/ai/client';
import { findInbox } from '@/app/capture';
import { fixture } from '@/test/helpers';
import { createVoiceService } from './service';
import { voiceItem, voicePrompt } from './voice-note';
import { mixDown, wavBytes } from './wav';

describe('wavBytes', () => {
  it('writes a 16-bit mono PCM header and clamped little-endian samples', () => {
    const bytes = wavBytes(new Float32Array([0, 1, -1, 2, -0.5]), 16_000);
    const view = new DataView(bytes.buffer);
    const ascii = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
    expect(bytes.length).toBe(44 + 10);
    expect([ascii(0), ascii(8), ascii(12), ascii(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint32(4, true)).toBe(36 + 10);
    expect([view.getUint32(16, true), view.getUint16(20, true), view.getUint16(22, true)]).toEqual([16, 1, 1]);
    expect([view.getUint32(24, true), view.getUint32(28, true), view.getUint16(32, true), view.getUint16(34, true)]).toEqual([16_000, 32_000, 2, 16]);
    expect(view.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767, -16384]);
  });
});

describe('mixDown', () => {
  it('averages the channels, and passes one channel through', () => {
    expect([...mixDown([new Float32Array([1, 0.5]), new Float32Array([0, -0.5])])]).toEqual([0.5, 0]);
    const mono = new Float32Array([0.25]);
    expect(mixDown([mono])).toBe(mono);
    expect([...mixDown([])]).toEqual([]);
  });
});

describe('voice memo text', () => {
  it('asks for a title line, then a tidy note in the words that were said', () => {
    const prompt = voicePrompt('um so buy milk');
    expect(prompt.endsWith('\n\nMemo:\num so buy milk')).toBe(true);
    expect(prompt).toContain('First line: a short title of at most 8 words');
    expect(prompt).toContain('Add nothing I did not say.');
  });

  it("takes AI's first line as the title and the rest as the note", () => {
    expect(voiceItem('"Groceries."\n\n- milk\n- eggs\n', 'buy milk and eggs')).toEqual({ content: 'Groceries', note: '- milk\n- eggs' });
  });

  it('keeps the transcript as the note when AI gave only a title', () => {
    expect(voiceItem('Groceries', 'buy milk and eggs')).toEqual({ content: 'Groceries', note: 'buy milk and eggs' });
  });

  it("names the memo by its first words when AI couldn't help", () => {
    expect(voiceItem(null, 'Call the dentist on Monday.')).toEqual({ content: 'Call the dentist on Monday', note: 'Call the dentist on Monday.' });
    expect(voiceItem('  \n', 'one two three four five six seven eight nine ten')).toEqual({
      content: 'one two three four five six seven eight…',
      note: 'one two three four five six seven eight nine ten',
    });
  });
});

/** Fakes for everything outside the service, recording what it was given. */
function setup({ key = 'k' as string | null, transcript = 'buy milk' as string | (() => Promise<string>), reply = 'Groceries\n\nBuy milk.' as string | Error } = {}) {
  const f = fixture(['Projects']);
  const calls: string[] = [];
  const voice = createVoiceService({
    engine: f.engine,
    key: () => key,
    canRecord: () => true,
    now: () => 1000,
    record: async () => {
      calls.push('record');
      return {
        stop: async () => (calls.push('stop'), new Blob(['audio'])),
        cancel: () => void calls.push('cancel'),
      };
    },
    encode: async (blob) => `b64:${await blob.text()}`,
    transcribe: async (k, audio) => {
      calls.push(`transcribe ${k} ${audio}`);
      return typeof transcript === 'string' ? transcript : transcript();
    },
    complete: async (k, prompt) => {
      calls.push(`complete ${k} ${prompt.split('\n').at(-1)}`);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });
  const inbox = () => {
    const id = findInbox(f.engine.tree);
    return id === null ? null : f.engine.tree.children(id).map((c) => f.engine.tree.get(c)!);
  };
  return { f, voice, calls, inbox };
}

describe('voice service', () => {
  it('records, transcribes, tidies with AI and adds the memo at the top of the Inbox', async () => {
    const { f, voice, calls, inbox } = setup();
    await voice.start();
    expect(voice.state.getState()).toEqual({ phase: 'recording', since: 1000 });
    const id = await voice.finish();
    expect(calls).toEqual(['record', 'stop', 'transcribe k b64:audio', 'complete k buy milk']);
    expect(f.kids(null)).toEqual(['Inbox', 'Projects']);
    expect(inbox()!.map((n) => [n.id, n.content, n.note])).toEqual([[id, 'Groceries', 'Buy milk.']]);
    expect(voice.state.getState()).toEqual({ phase: 'idle' });
  });

  it('saves the plain transcript when the tidying fails', async () => {
    const { voice, inbox } = setup({ reply: new AiError('AI is busy') });
    await voice.start();
    await voice.finish();
    expect(inbox()!.map((n) => [n.content, n.note])).toEqual([['buy milk', 'buy milk']]);
  });

  it('keeps the recording when speech to text fails, and Try again sends it once more', async () => {
    let fail = true;
    const { voice, calls, inbox } = setup({ transcript: async () => (fail ? Promise.reject(new AiError('You are offline.')) : 'buy milk') });
    await voice.start();
    expect(await voice.finish()).toBeNull();
    expect(voice.state.getState()).toEqual({ phase: 'error', text: 'You are offline.', retry: true });
    expect(inbox()).toBeNull();
    fail = false;
    expect(await voice.retry()).not.toBeNull();
    expect(calls.filter((c) => c.startsWith('transcribe'))).toEqual(['transcribe k b64:audio', 'transcribe k b64:audio']);
    expect(inbox()!.map((n) => n.content)).toEqual(['Groceries']);
    expect(await voice.retry()).toBeNull();
  });

  it('adds nothing when nothing was heard', async () => {
    const { voice, calls, inbox } = setup({ transcript: '  ' });
    await voice.start();
    expect(await voice.finish()).toBeNull();
    expect(voice.state.getState()).toEqual({ phase: 'error', text: "Didn't catch anything. Try again a bit closer to the phone.", retry: false });
    expect(calls).toEqual(['record', 'stop', 'transcribe k b64:audio']);
    expect(inbox()).toBeNull();
  });

  it('Cancel throws the recording away, even while it is being written down', async () => {
    const { voice, calls, inbox } = setup();
    await voice.start();
    voice.cancel();
    expect(calls).toEqual(['record', 'cancel']);
    expect(voice.state.getState()).toEqual({ phase: 'idle' });
    expect(await voice.finish()).toBeNull();

    await voice.start();
    const pending = voice.finish();
    voice.cancel();
    expect(await pending).toBeNull();
    expect(inbox()).toBeNull();
    expect(voice.state.getState()).toEqual({ phase: 'idle' });
  });

  it('needs sync for AI, and says when the microphone is blocked', async () => {
    const off = setup({ key: null });
    expect(off.voice.available()).toBe(false);
    await off.voice.start();
    expect(off.voice.state.getState()).toEqual({ phase: 'error', text: 'Turn on sync in Settings to use AI on this device.', retry: false });
    expect(off.calls).toEqual([]);

    const f = fixture();
    const blocked = createVoiceService({
      engine: f.engine,
      key: () => 'k',
      canRecord: () => true,
      record: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      encode: async () => '',
      transcribe: async () => '',
      complete: async () => '',
    });
    expect(blocked.available()).toBe(true);
    await blocked.start();
    expect(blocked.state.getState()).toEqual({ phase: 'error', text: 'The microphone is blocked. Allow it for this site in the browser settings.', retry: false });
  });
});
