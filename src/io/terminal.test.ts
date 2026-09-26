import { describe, expect, it } from 'vitest';
import { blockToHtml } from '@/editor/markdown';
import { boxTablesToMarkdown, formatTerminalNote, hasBoxTable, looksLikeTerminalProse, terminalToMarkdown } from './terminal';

const ruled = [
  '┌──────────┬────────────────┐',
  '│ Option   │ Trade-off      │',
  '├──────────┼────────────────┤',
  '│ Wider    │ Easy, but long │',
  '│ page     │ lines tire     │',
  '├──────────┼────────────────┤',
  '│ Tables   │ Cells wrap     │',
  '└──────────┴────────────────┘',
].join('\n');

describe('box tables', () => {
  it('spots them', () => {
    expect(hasBoxTable(ruled)).toBe(true);
    expect(hasBoxTable('just text\n───────\nmore')).toBe(false);
  });

  it('become GFM tables, joining rows wrapped over several lines', () => {
    expect(boxTablesToMarkdown(ruled)).toBe(
      ['| Option | Trade-off |', '| --- | --- |', '| Wider page | Easy, but long lines tire |', '| Tables | Cells wrap |'].join('\n'),
    );
  });

  it('keeps one row per line when only the header is ruled off', () => {
    const table = ['┌───┬───┐', '│ a │ b │', '├───┼───┤', '│ 1 │ 2 │', '│ 3 │ │ ', '└───┴───┘'].join('\n');
    expect(boxTablesToMarkdown(table)).toBe(['| a | b |', '| --- | --- |', '| 1 | 2 |', '| 3 |  |'].join('\n'));
  });

  it('escapes pipes and puts blank lines around the table', () => {
    const text = ['Before', '┌─────┐', '│ a|b │', '├─────┤', '│ c   │', '└─────┘', 'After'].join('\n');
    expect(boxTablesToMarkdown(text)).toBe(['Before', '', '| a\\|b |', '| --- |', '| c |', '', 'After'].join('\n'));
  });

  it('render as an HTML table', () => {
    expect(blockToHtml(boxTablesToMarkdown(ruled))).toContain('<td>Wider page</td>');
  });
});

describe('terminalToMarkdown', () => {
  it('drops Claude Code markers and shared indent, keeps lists and paragraphs', () => {
    const text = ['  ⏺ The plan has two parts:', '', '    1. Import the file', '    2. Show it', '', '    • a bullet'].join('\n');
    expect(terminalToMarkdown(text)).toBe(['The plan has two parts:', '', '1. Import the file', '2. Show it', '', '- a bullet'].join('\n'));
  });

  it('turns rule lines into Markdown rules without making headings', () => {
    expect(terminalToMarkdown('Title\n──────\nBody')).toBe('Title\n\n---\n\nBody');
  });

  it('converts tables inside the text', () => {
    expect(terminalToMarkdown(`Summary:\n${ruled}\nDone.`)).toContain('\n\n| Option | Trade-off |');
  });
});

describe('looksLikeTerminalProse', () => {
  it('is true for prose and for tables', () => {
    expect(looksLikeTerminalProse('This is a sentence about the plan we follow.\nAnd here is another line of prose text.')).toBe(true);
    expect(looksLikeTerminalProse(ruled)).toBe(true);
  });

  it('is false for code', () => {
    expect(looksLikeTerminalProse('const a = 1;\nfunction f() {\n  return a;\n}')).toBe(false);
    expect(looksLikeTerminalProse('$ pnpm install\n$ pnpm build')).toBe(false);
    expect(looksLikeTerminalProse('one line of prose here only')).toBe(false);
  });
});

describe('formatTerminalNote', () => {
  it('turns prose and table code blocks into Markdown and keeps real code', () => {
    const note = ['Intro', '', '```', ruled, '```', '', '```', 'Some prose that was pasted into a code block.', 'It has several words on each line too.', '```', '', '```js', 'const a = 1;', '```'].join('\n');
    expect(formatTerminalNote(note)).toBe(
      [
        'Intro',
        '',
        '| Option | Trade-off |',
        '| --- | --- |',
        '| Wider page | Easy, but long lines tire |',
        '| Tables | Cells wrap |',
        '',
        'Some prose that was pasted into a code block.',
        'It has several words on each line too.',
        '',
        '```js',
        'const a = 1;',
        '```',
      ].join('\n'),
    );
  });

  it('converts box tables outside code blocks and leaves plain notes as they are', () => {
    expect(formatTerminalNote(`See:\n${ruled}`)).toContain('| Tables | Cells wrap |');
    const plain = 'Just a note\n\n- item';
    expect(formatTerminalNote(plain)).toBe(plain);
  });
});
