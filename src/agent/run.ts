import { AiError, SessionExpired, type Step } from '@/ai/client';
import type { TreeReader } from '@/model';
import type { SearchIndex } from '@/search';
import { AGENT_SYSTEM, MAX_STEPS, parseReply, readLabel, readResults, Refs, startPrompt, type ChatTurn } from './prompt';

export interface AgentRun {
  answer: string;
  changes: unknown[];
  /** The numbers AI used for rows, to read its changes and citations. */
  refs: Refs;
}

/**
 * Ask AI a question about the notes, letting it search and open rows until it
 * answers. Reads run here, on this device, against the live outline. With a
 * relay session each step sends only what's new; without one (or when the
 * session ends midway) the whole conversation so far is sent, both sides,
 * with the system prompt again.
 */
export async function runAgent(o: {
  tree: TreeReader;
  search: SearchIndex;
  step: Step;
  key: string;
  /** The row they're on, or null for the whole outline. */
  item: string | null;
  history: readonly ChatTurn[];
  question: string;
  /** Called with each step's reads ("Searching “coffee”, Reading “Work”"), for the chat to show. */
  progress(label: string): void;
}): Promise<AgentRun> {
  const refs = new Refs();
  const transcript: string[] = [startPrompt({ tree: o.tree, refs, item: o.item, history: o.history, question: o.question })];
  let session: string | null = null;
  let next = transcript[0]!;

  const ask = async (): Promise<string> => {
    try {
      const r = await o.step(o.key, session === null ? transcript.join('\n\n') : next, session, AGENT_SYSTEM);
      session = r.session;
      return r.text;
    } catch (e) {
      if (!(e instanceof SessionExpired) || session === null) throw e;
      session = null;
      const r = await o.step(o.key, transcript.join('\n\n'), null, AGENT_SYSTEM);
      session = r.session;
      return r.text;
    }
  };

  for (let stepNo = 1; stepNo <= MAX_STEPS; stepNo++) {
    const text = await ask();
    const reply = parseReply(text);
    if ('answer' in reply) return { answer: reply.answer, changes: reply.changes, refs };
    if (stepNo === MAX_STEPS) break;
    o.progress(reply.reads.map((r) => readLabel(o.tree, refs, r)).join(', '));
    next = readResults(o.tree, o.search, refs, reply.reads, stepNo === MAX_STEPS - 1);
    transcript.push(`You: ${text.trim()}`, next);
  }
  throw new AiError(`AI kept reading and didn't answer in ${MAX_STEPS} steps. Try a narrower question.`);
}
