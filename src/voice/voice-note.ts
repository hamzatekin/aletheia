import { cleanTitle } from '@/ai/suggest-title';

/** Words for a title when AI couldn't tidy the memo. */
const FALLBACK_WORDS = 8;

/** Ask AI to turn a transcribed voice memo into a title and a tidy note, in the words that were said. */
export function voicePrompt(transcript: string): string {
  return [
    'Below is a voice memo I recorded on my phone, turned into text by speech recognition. Make it an item for my outline.',
    'First line: a short title of at most 8 words, in the language of the memo, with no quotes and no full stop at the end.',
    'Then a blank line, then the memo as a tidy Markdown note. Keep my words and meaning. Drop filler words, false starts and repeats, fix obvious mistakes of the speech recognition, split it into paragraphs, and use a list only where I list things. Add nothing I did not say.',
    'Reply with only the title and the note.',
    '',
    'Memo:',
    transcript,
  ].join('\n');
}

/**
 * The item for the Inbox: AI's title and note, or, when AI failed (`reply`
 * null) or gave no note, the transcript itself under its first words.
 */
export function voiceItem(reply: string | null, transcript: string): { content: string; note: string } {
  if (reply !== null) {
    const [first = '', ...rest] = reply.trim().split('\n');
    const title = cleanTitle(first);
    const note = rest.join('\n').trim();
    if (title !== '') return { content: title, note: note !== '' ? note : transcript };
  }
  const words = transcript.split(/\s+/).filter((w) => w !== '');
  const title = words.slice(0, FALLBACK_WORDS).join(' ').replace(/[.,;:!?]+$/, '');
  return { content: words.length > FALLBACK_WORDS ? `${title}…` : title, note: transcript };
}
