import { describe, expect, it } from 'vitest';
import { blockToHtml } from '@/editor/markdown';
import { boxTablesToMarkdown, dedent, formatTerminalContent, formatTerminalNote, hasBoxTable, isTerminalPaste, looksLikeTerminalProse, terminalHtmlToText, terminalPasteMarkdown, terminalToMarkdown } from './terminal';

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

describe('box tables: edge cases', () => {
  it('needs a line of only box characters followed closely by a row', () => {
    expect(hasBoxTable('abc ───\n│ x │')).toBe(false);
    expect(hasBoxTable('─── abc\n│ x │')).toBe(false);
    expect(hasBoxTable('│   │\n│ a │')).toBe(false);
    expect(hasBoxTable('─│')).toBe(false);
    expect(hasBoxTable('│ a │\n└───┘')).toBe(false);
    expect(hasBoxTable('x\n───\nmore\n\n│ a │')).toBe(false);
    expect(hasBoxTable('  ┌───┐  \n  │ a │')).toBe(true);
    expect(hasBoxTable('┌───┐\n│ a │\nend')).toBe(true);
    expect(hasBoxTable('┌───┐\n\n│ a │')).toBe(true);
  });

  it('converts an indented table and one without a bottom border', () => {
    expect(boxTablesToMarkdown('  ┌───┐\n  │ a │\n  ├───┤\n  │ b │')).toBe('| a |\n| --- |\n| b |');
  });

  it('joins wrapped lines whose cell counts differ, skipping empty pieces', () => {
    const table = ['┌───┬───┐', '│ a │ b │', '├───┼───┤', '│ c │ d │', '│ e │   │', '├───┼───┤', '│ f │', '│ g │ h │', '└───┴───┘'].join('\n');
    expect(boxTablesToMarkdown(table)).toBe(['| a | b |', '| --- | --- |', '| c e | d |', '| f g | h |'].join('\n'));
  });

  it('leaves rows without any rule alone', () => {
    expect(boxTablesToMarkdown('│ a │\n│ b │')).toBe('│ a │\n│ b │');
  });

  it('adds blank lines around a table only where needed', () => {
    const t = '┌───┐\n│ a │\n├───┤\n│ b │\n└───┘';
    const md = '| a |\n| --- |\n| b |';
    expect(boxTablesToMarkdown(t)).toBe(md);
    expect(boxTablesToMarkdown(`x\n\n${t}\n\ny`)).toBe(`x\n\n${md}\n\ny`);
    expect(boxTablesToMarkdown(`x\n   \n${t}\n  \ny`)).toBe(`x\n   \n${md}\n  \ny`);
    expect(boxTablesToMarkdown(`x\n${t}\ny`)).toBe(`x\n\n${md}\n\ny`);
  });
});

describe('dedent', () => {
  it('ignores blank and whitespace-only lines when finding the shared indent', () => {
    expect(dedent('    a\n  \n    b')).toBe('a\n\nb');
    expect(dedent('\ta\n\t\tb')).toBe('a\n\tb');
    expect(dedent('   \n  ')).toBe('   \n  ');
    expect(dedent('a\n  b')).toBe('a\n  b');
  });
});

describe('terminalToMarkdown: details', () => {
  it('normalizes line endings', () => {
    expect(terminalToMarkdown('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('removes the ⏺ marker only at the start of a line, with or without a space', () => {
    expect(terminalToMarkdown('⏺x')).toBe('x');
    expect(terminalToMarkdown('x ⏺ y')).toBe('x ⏺ y');
    expect(terminalToMarkdown('⏺ First line\n  second line')).toBe('First line\nsecond line');
  });

  it('drops trailing spaces', () => {
    expect(terminalToMarkdown('a   \nb')).toBe('a\nb');
  });

  it('only turns whole lines of ─ ━ ═ into rules, with a blank line before unless there is one', () => {
    expect(terminalToMarkdown('───\nx')).toBe('---\n\nx');
    expect(terminalToMarkdown('a\n\n━━━━\nb')).toBe('a\n\n---\n\nb');
    expect(terminalToMarkdown('a\n  ═══\nb')).toBe('a\n\n---\n\nb');
    expect(terminalToMarkdown('text ───')).toBe('text ───');
    expect(terminalToMarkdown('─── text')).toBe('─── text');
    expect(terminalToMarkdown('──')).toBe('──');
  });

  it('turns bullets at the start of a line into list items, keeping nesting', () => {
    expect(terminalToMarkdown('• a\n  ● b\n    ◦ c\n▪   d')).toBe('- a\n  - b\n    - c\n- d');
    expect(terminalToMarkdown('a • b')).toBe('a • b');
    expect(terminalToMarkdown('•x')).toBe('•x');
  });

  it('trims blank lines at the ends and squeezes long runs of blank lines', () => {
    expect(terminalToMarkdown('\n\n\na\n\n\n\nb\n\n\n')).toBe('a\n\nb');
  });
});

describe('looksLikeTerminalProse: details', () => {
  const twice = (line: string) => `${line}\n${line}`;

  it('treats lines that start or end like code as code, indented or not, in any case', () => {
    const code = [
      '{ the opening brace of a block here',
      '} the closing brace of a block here',
      '( the opening paren of a list here',
      ') the closing paren of a list here',
      '[ the opening bracket of a list here',
      '] the closing bracket of a list here',
      '; a stray semicolon at the start here',
      '// a comment about how this all works',
      '#include the standard input output header',
      'import the whole thing from the other module',
      'export the whole thing to the other module',
      'const value of the whole thing is here',
      'let value of the whole thing be here',
      'var value of the whole thing is here',
      'function names are written in this way',
      'def names are written in this way too',
      'class names are written in this way too',
      'return the whole value to the caller now',
      'if (the value is set then do this thing',
      'if(the value is set then do this thing',
      'for (each item in the list do this thing',
      '$ run the whole build from the start',
      '> quoted output from the shell goes here',
      '<div class is used for the whole layout',
      '</div closes the whole layout block here',
      'the line ends with an opening brace here {',
      'the line ends with a semicolon here ;   ',
      'IMPORT the whole thing from the other module',
    ];
    for (const line of code) {
      expect(looksLikeTerminalProse(twice(line))).toBe(false);
      expect(looksLikeTerminalProse(twice(`    ${line}`))).toBe(false);
    }
    expect(looksLikeTerminalProse(twice('important things to say about this'))).toBe(true);
    expect(looksLikeTerminalProse(twice('functional words that make a sentence'))).toBe(true);
  });

  it('counts only non-blank lines', () => {
    expect(looksLikeTerminalProse('Some prose about the plan here.\n\n   \n\nMore prose about the plan here.')).toBe(true);
    expect(looksLikeTerminalProse('Some prose about the plan here.\n\n\n')).toBe(false);
  });

  it('needs four words besides a list marker, and mostly letters', () => {
    expect(looksLikeTerminalProse(twice('alpha beta gamma delta'))).toBe(true);
    expect(looksLikeTerminalProse(twice('alpha beta gamma'))).toBe(false);
    expect(looksLikeTerminalProse(twice('alpha  beta  gamma'))).toBe(false);
    expect(looksLikeTerminalProse(twice('- alpha beta gamma'))).toBe(false);
    expect(looksLikeTerminalProse(twice('-   alpha beta gamma'))).toBe(false);
    expect(looksLikeTerminalProse(twice('* alpha beta gamma'))).toBe(false);
    expect(looksLikeTerminalProse(twice('• alpha beta gamma'))).toBe(false);
    expect(looksLikeTerminalProse(twice('1. alpha beta gamma'))).toBe(false);
    expect(looksLikeTerminalProse(twice('12) alpha beta gamma'))).toBe(false);
    expect(looksLikeTerminalProse(twice('- alpha beta gamma delta'))).toBe(true);
    // Exactly 60% letters is not enough.
    expect(looksLikeTerminalProse(twice('abc d e f.'))).toBe(false);
    expect(looksLikeTerminalProse(twice('v1 2 3 4 5 6 7 8'))).toBe(false);
    expect(looksLikeTerminalProse(twice('            abcd efgh ijkl mnop'))).toBe(true);
  });

  it('needs at least 60% prose lines', () => {
    const prose = 'This line is a plain English sentence.';
    const code = 'const x = compute(1, 2);';
    expect(looksLikeTerminalProse([prose, prose, prose, code, code].join('\n'))).toBe(true);
    expect(looksLikeTerminalProse([prose, code, code].join('\n'))).toBe(false);
  });
});

describe('isTerminalPaste / formatTerminalContent', () => {
  it('spots box tables and Claude Code answers', () => {
    expect(isTerminalPaste('┌───┐\n│ a │')).toBe(true);
    expect(isTerminalPaste('⏺ The answer')).toBe(true);
    expect(isTerminalPaste('intro\n  ⏺ The answer')).toBe(true);
    expect(isTerminalPaste('a ⏺ b')).toBe(false);
    expect(isTerminalPaste('⏺x')).toBe(false);
    expect(isTerminalPaste('plain')).toBe(false);
  });

  it('drops the leading marker and the space after it', () => {
    expect(formatTerminalContent('⏺ hello')).toBe('hello');
    expect(formatTerminalContent('⏺   hello')).toBe('hello');
    expect(formatTerminalContent('⏺hello')).toBe('hello');
    expect(formatTerminalContent('a ⏺ b')).toBe('a ⏺ b');
  });
});

describe('formatTerminalNote: fences', () => {
  const prose = 'Some prose that was pasted into a code block.\nIt has several words on each line too.';

  it('converts prose in ~~~ fences and fences with a language', () => {
    expect(formatTerminalNote(`~~~\n${prose}\n~~~`)).toBe(prose);
    expect(formatTerminalNote(`\`\`\`text\n${prose}\n\`\`\``)).toBe(prose);
    expect(formatTerminalNote(`\`\`\`\`\n${prose}\n\`\`\`\``)).toBe(prose);
  });

  it('only takes fences that open and close on their own lines', () => {
    const inline = `x \`\`\`\n${prose}\n\`\`\``;
    expect(formatTerminalNote(inline)).toBe(inline);
    const trailing = `\`\`\`\n${prose}\n\`\`\` trailing`;
    expect(formatTerminalNote(trailing)).toBe(trailing);
  });

  it('leaves an unchanged note exactly as it was, and squeezes blank lines in a changed one', () => {
    expect(formatTerminalNote('a\n\n\n\nb')).toBe('a\n\n\n\nb');
    expect(formatTerminalNote(`a\n\n\n\n\`\`\`\n${prose}\n\`\`\``)).toBe(`a\n\n${prose}`);
  });
});

// How Ghostty copies styled terminal text: one pre block, an inline box per style.
const ghostty = (body: string) => `<div style="font-family: monospace; white-space: pre;">${body}</div>`;
const bold = (t: string) => `<div style="display: inline;font-weight: bold;">${t}</div>`;
const blue = (t: string) => `<div style="display: inline;color: rgb(177, 185, 249);">${t}</div>`;
const grey = (t: string) => `<div style="display: inline;color: rgb(153, 153, 153);">${t}</div>`;
const green = (t: string) => `<div style="display: inline;color: rgb(78, 186, 101);">${t}</div>`;

describe('styled terminal copies', () => {
  it('keep bold as bold and colored words as inline code', () => {
    const html = ghostty(
      [
        `${green('⏺')} ${bold('Since Wed 7 Oct')} · 9 pieces of work`,
        '',
        `  ${bold('New and improved')}`,
        `  1. ${bold('An AI check stops texts.')} A firm now presses "Check".`,
        `     Status: Merged · ${grey('dev only')}`,
        '',
        `  ${bold('Sources')} (for you)`,
        `  - 1: ${blue('e34b418a4')}, ${blue('734008f05')} · fixes: ${blue('a7264167a')}`,
      ].join('\n'),
    );
    expect(terminalPasteMarkdown('⏺ Since Wed 7 Oct · 9 pieces of work', html)).toBe(
      [
        '**Since Wed 7 Oct** · 9 pieces of work',
        '',
        '**New and improved**',
        '1. **An AI check stops texts.** A firm now presses "Check".',
        '   Status: Merged · dev only',
        '',
        '**Sources** (for you)',
        '- 1: `e34b418a4`, `734008f05` · fixes: `a7264167a`',
      ].join('\n'),
    );
  });

  it('keep spaces outside the marks, close them at line ends and merge touching runs', () => {
    expect(terminalHtmlToText(ghostty(`${bold(' two words ')}x\n${bold('a')}${bold('b\nc')}`))).toBe(' **two words** x\n**ab**\n**c**');
  });

  it('read palette colors, hex colors, <b> and font weights, and leave the default color alone', () => {
    const pal = (n: number, t: string) => `<div style="display: inline;color: var(--vt-palette-${n});">${t}</div>`;
    expect(terminalHtmlToText(ghostty(`${pal(4, 'blue')} ${pal(7, 'white')} ${pal(12, 'bright')} ${pal(21, 'cube')} ${pal(8, 'grey')}`))).toBe('`blue` white `bright` cube grey');
    expect(terminalHtmlToText(ghostty('<span style="color:#36f">a</span> <span style="color: #333333">b</span> <b>c</b> <span style="font-weight: 700">d</span> <span style="font-weight: 400">e</span>'))).toBe('`a` b **c** **d** e');
    const wrapped = '<div style="white-space: pre; color: rgb(200, 60, 60);">all red <span style="color: rgb(60, 60, 200)">blue</span></div>';
    expect(terminalHtmlToText(wrapped)).toBe('all red `blue`');
  });

  it('tell hues from greys at the edge, and read every way of writing a style', () => {
    const run = (style: string) => terminalHtmlToText(ghostty(`<span style="${style}">w</span>`));
    expect(run('color: rgb(100, 100, 148)')).toBe('`w`');
    expect(run('color: rgb(100, 100, 147)')).toBe('w');
    // Doubling a 6-digit hex's digits would make this grey look red.
    expect(run('color: #808a8f')).toBe('w');
    expect(run('color: blue')).toBe('w');
    expect(run('background-color: rgb(0, 0, 255)')).toBe('w');
    expect(run('color : rgb(0, 0, 255)')).toBe('`w`');
    expect(run('color:rgba(0,0,255,0.5)')).toBe('`w`');
    expect(run('font-weight:bold')).toBe('**w**');
    expect(run('font-weight : 600')).toBe('**w**');
    expect(run('font-weight: 500')).toBe('w');
    expect(terminalHtmlToText(ghostty("<span style='color: #00f'>w</span> <strong>s</strong>"))).toBe('`w` **s**');
    const slots = [0, 1, 6, 7, 8, 9, 14, 15, 16, 17].map((n) => `<span style="color: var(--vt-palette-${n})">${n}</span>`);
    expect(terminalHtmlToText(ghostty(slots.join(' ')))).toBe('0 `1` `6` 7 8 `9` `14` 15 16 17');
  });

  it('split lines on \\n, \\r\\n and <br>, and read no-break spaces as spaces', () => {
    expect(terminalHtmlToText(ghostty('a\r\nb\nc<br>d\u00a0e'))).toBe('a\nb\nc\nd e');
  });

  it('follow the nesting of tags, comments included, and stop at the end of the first block', () => {
    expect(terminalHtmlToText(ghostty('<b>x<i>y</b>z'))).toBe('**xy**z');
    expect(terminalHtmlToText(ghostty('<b>x <span style="color:#00f">y</span></b><!-- a > b -->.'))).toBe('**x** **`y`**.');
    expect(terminalHtmlToText('<pre>a</pre><pre>b</pre>')).toBe('a');
    expect(terminalHtmlToText('<p style="white-space : pre">open\n<b>b</b> c')).toBe('open\n**b** c');
    expect(terminalHtmlToText('<div style ="white-space: pre; color: #00f">blue</div>')).toBe('blue');
  });

  it('leave colored symbols and words with backticks unmarked', () => {
    expect(terminalHtmlToText(ghostty(`${green('•')} ${blue('──')} ${blue('a`b')} ${blue('(x)')}`))).toBe('• ── a`b `(x)`');
  });

  it('take only the terminal block, with <br> lines and entities, from the HTML around it', () => {
    const windows =
      '<html><head><meta charset="utf-8"><style>p { color: red }</style><title>t</title></head><body><!--StartFragment-->ignored<br>' +
      '<div style="display:inline-block;white-space:pre;color:#cccccc;font-family:\'Cascadia Mono\'">' +
      '<span style="color:#cccccc">a &lt;b&gt; &amp;&nbsp;c</span><br><span style="color:#3b78ff">hash</span><br/>end</div>after<!--EndFragment--></body></html>';
    expect(terminalHtmlToText(windows)).toBe('a <b> & c\n`hash`\nend');
    expect(terminalHtmlToText('<pre>one\n<b>two</b></pre>')).toBe('one\n**two**');
  });

  it('are not HTML from editors or web pages', () => {
    expect(terminalHtmlToText('<p><b>bold</b> text</p>')).toBeNull();
    // VS Code copies code with a block per line: an ordinary paste.
    const vscode = '<div style="color: #d4d4d4;white-space: pre;"><div><span style="color: #569cd6;">const</span> a = 1;</div></div>';
    expect(terminalPasteMarkdown('const a = 1;', vscode)).toBeNull();
    expect(terminalPasteMarkdown('plain words', '')).toBeNull();
  });

  it('fall back to the plain text when there is no terminal HTML', () => {
    expect(terminalPasteMarkdown('⏺ Done • one', '')).toBe('Done • one');
    expect(terminalPasteMarkdown('⏺ Done', '<p>Done</p>')).toBe('Done');
    expect(terminalPasteMarkdown('x', ghostty(`${bold('Hi')} there`))).toBe('**Hi** there');
    expect(terminalPasteMarkdown('x', '<div style="white-space:pre"><span style="display:inline-block;font-weight:bold">Hi</span></div>')).toBe('**Hi**');
    expect(terminalPasteMarkdown('x', '<div style="white-space: pre"><span style="display : inline; font-weight: bold">Hi</span></div>')).toBe('**Hi**');
  });
});
