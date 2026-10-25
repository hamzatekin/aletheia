import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Engine } from '@/commands';
import { AI_NEEDS_SYNC, AiError, type Complete, type Transcribe } from '@/ai/client';
import { addToInbox } from '@/app/capture';
import type { Recording, StartRecording } from './recorder';
import { voiceItem, voicePrompt } from './voice-note';

/** The app stops a recording here, a little under what the Worker takes. */
export const MAX_RECORDING_MS = 5 * 60_000;

type VoiceState =
  | { phase: 'idle' }
  | { phase: 'recording'; since: number }
  | { phase: 'working' }
  /** `retry` when the recording is kept and can be sent again. */
  | { phase: 'error'; text: string; retry: boolean };

export interface VoiceService {
  readonly state: StoreApi<VoiceState>;
  /** Whether voice memos work here: AI needs sync, and the browser must be able to record. */
  available(): boolean;
  /** Start listening. */
  start(): Promise<void>;
  /** Stop, turn the memo into an Inbox item and return its id (null when it failed or was cancelled). */
  finish(): Promise<string | null>;
  /** Send the last recording again after a failure. */
  retry(): Promise<string | null>;
  /** Stop listening, or close the error, and throw the recording away. */
  cancel(): void;
}

interface Deps {
  engine: Engine;
  key(): string | null;
  complete: Complete;
  transcribe: Transcribe;
  record: StartRecording;
  /** A recording as base64 WAV. */
  encode(blob: Blob): Promise<string>;
  canRecord(): boolean;
  now?: () => number;
}

export function createVoiceService({ engine, key, complete, transcribe, record, encode, canRecord, now = Date.now }: Deps): VoiceService {
  const state = createStore<VoiceState>(() => ({ phase: 'idle' }));
  let recording: Recording | null = null;
  let audio: string | null = null;
  // Bumped by cancel, so a memo still being written down when cancelled is dropped.
  let run = 0;

  const fail = (text: string, retry: boolean) => state.setState({ phase: 'error', text, retry }, true);

  /** Transcript, then AI's tidy version, then the Inbox item. */
  const save = async (k: string, base64: string, mine: number): Promise<string | null> => {
    state.setState({ phase: 'working' }, true);
    let transcript: string;
    try {
      transcript = (await transcribe(k, base64)).trim();
    } catch (e) {
      if (mine === run) fail(e instanceof AiError ? e.message : 'Could not turn the recording into text.', true);
      return null;
    }
    if (mine !== run) return null;
    if (transcript === '') {
      fail("Didn't catch anything. Try again a bit closer to the phone.", false);
      return null;
    }
    let reply: string | null = null;
    try {
      reply = await complete(k, voicePrompt(transcript));
    } catch {
      // Keep the plain transcript; the memo matters more than the tidying.
    }
    if (mine !== run) return null;
    const { id } = addToInbox(engine, voiceItem(reply, transcript));
    audio = null;
    state.setState({ phase: 'idle' }, true);
    return id;
  };

  return {
    state,
    available: () => key() !== null && canRecord(),
    async start() {
      if (state.getState().phase === 'recording' || state.getState().phase === 'working') return;
      if (key() === null) return fail(AI_NEEDS_SYNC, false);
      audio = null;
      const mine = ++run;
      try {
        const r = await record();
        if (mine !== run) return r.cancel();
        recording = r;
      } catch (e) {
        const denied = e instanceof DOMException && e.name === 'NotAllowedError';
        return fail(denied ? 'The microphone is blocked. Allow it for this site in the browser settings.' : 'Could not start the microphone.', false);
      }
      state.setState({ phase: 'recording', since: now() }, true);
    },
    async finish() {
      const k = key();
      if (!recording || k === null) return null;
      const r = recording;
      recording = null;
      const mine = run;
      state.setState({ phase: 'working' }, true);
      let encoded: string;
      try {
        encoded = await encode(await r.stop());
      } catch {
        if (mine === run) fail('Could not read the recording.', false);
        return null;
      }
      if (mine !== run) return null;
      audio = encoded;
      return save(k, encoded, mine);
    },
    async retry() {
      const k = key();
      if (audio === null || k === null) return null;
      return save(k, audio, run);
    },
    cancel() {
      run++;
      recording?.cancel();
      recording = null;
      audio = null;
      state.setState({ phase: 'idle' }, true);
    },
  };
}
