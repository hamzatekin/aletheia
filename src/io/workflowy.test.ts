import { describe, expect, it } from 'vitest';
import { opmlItems, type RawOutline } from './import';
import { codeTitle, decodeEntities, extractFencedBlocks, extractWorkflowyCodeBlocks, fencedBlock, looksLikeWorkflowyHtml, workflowyHtmlToMarkdown } from './workflowy';

const raw = (text: string, extra: Partial<RawOutline> = {}): RawOutline => ({ text, note: '', complete: false, children: [], ...extra });

describe('workflowyHtmlToMarkdown', () => {
  it('maps bold, italic, strike and links, and drops styling Markdown lacks', () => {
    expect(workflowyHtmlToMarkdown('<b>bold</b> and <i>it</i> and <s>gone</s>')).toBe('**bold** and *it* and ~~gone~~');
    expect(workflowyHtmlToMarkdown('<u>under</u> <span class="colored c-red">red</span> <span class="colored bc-yellow">hl</span>')).toBe('under red hl');
    expect(workflowyHtmlToMarkdown('see <a href="https://x.dev/?a=1&amp;b=2">docs</a>')).toBe('see [docs](https://x.dev/?a=1&b=2)');
    expect(workflowyHtmlToMarkdown('<a href="https://x.dev">https://x.dev</a>')).toBe('<https://x.dev>');
    expect(workflowyHtmlToMarkdown('<b><i>both</i></b>')).toBe('***both***');
  });

  it('keeps edge spaces outside marks and drops empty marks', () => {
    expect(workflowyHtmlToMarkdown('a<b> bold </b>b')).toBe('a **bold** b');
    expect(workflowyHtmlToMarkdown('x<b> </b>y<i></i>')).toBe('x y');
  });

  it('keeps date text, decodes entities, and handles <br> per field', () => {
    expect(workflowyHtmlToMarkdown('due <time startYear="2024" startMonth="1" startDay="5">Fri, Jan 5, 2024</time>')).toBe('due Fri, Jan 5, 2024');
    expect(workflowyHtmlToMarkdown('R&amp;D &lt;3 #tag @me')).toBe('R&D <3 #tag @me');
    expect(workflowyHtmlToMarkdown('one<br>two')).toBe('one two');
    expect(workflowyHtmlToMarkdown('one<br />two', true)).toBe('one\ntwo');
  });

  it('decodes numeric entities', () => {
    expect(decodeEntities('&#39;a&#x27; &bogus;')).toBe("'a' &bogus;");
  });
});

describe('looksLikeWorkflowyHtml', () => {
  it('needs known, balanced tags', () => {
    expect(looksLikeWorkflowyHtml('<b>x</b>')).toBe(true);
    expect(looksLikeWorkflowyHtml('a<br>b')).toBe(true);
    expect(looksLikeWorkflowyHtml('A <b> & "q"')).toBe(false);
    expect(looksLikeWorkflowyHtml('<div>x</div>')).toBe(false);
    expect(looksLikeWorkflowyHtml('plain')).toBe(false);
  });
});

describe('opmlItems', () => {
  it('converts WorkFlowy markup and strikes through completed items', () => {
    const items = opmlItems([
      raw('<b>Project</b>', { note: 'line<br>next', children: [raw('done', { complete: true }), raw('R&amp;D')] }),
    ]);
    expect(items).toEqual([
      { content: '**Project**', note: 'line\nnext', children: [
        { content: '~~done~~', note: '', children: [] },
        { content: 'R&D', note: '', children: [] },
      ] },
    ]);
  });

  it('leaves other OPML text alone', () => {
    expect(opmlItems([raw('A <b> & "q" &amp;')])).toEqual([{ content: 'A <b> & "q" &amp;', note: '', children: [] }]);
  });

  it('treats a file with ownerEmail as WorkFlowy even without markup', () => {
    expect(opmlItems([raw('R&amp;D')], true)[0]!.content).toBe('R&D');
  });
});

describe('WorkFlowy code blocks', () => {
  it('moves a multi-line code block out of the content into a fenced block in the note', () => {
    const code = '<code>git fetch origin\ngit rebase origin/main</code>';
    const [item] = opmlItems([raw(code, { note: 'my note' })], true);
    expect(item!.content).toBe('git fetch origin');
    expect(item!.note).toBe('```\ngit fetch origin\ngit rebase origin/main\n```\n\nmy note');
  });

  it('turns terminal prose pasted into a code block back into Markdown', () => {
    const code = '<code>⏺ Your local main is out of date with the remote.\n\n  1. Firms with no settings saved yet\n  - The `send` check still runs first</code>';
    const [item] = opmlItems([raw(code)], true);
    expect(item!.content).toBe('Your local main is out of date with the remote.');
    expect(item!.note).toBe('Your local main is out of date with the remote.\n\n1. Firms with no settings saved yet\n- The `send` check still runs first');
  });

  it('keeps the text around a code block as the title and <br> as line breaks', () => {
    const [item] = opmlItems([raw('Query: <pre>SELECT *<br>FROM t</pre>')], true);
    expect(item!.content).toBe('Query:');
    expect(item!.note).toBe('```\nSELECT *\nFROM t\n```');
  });

  it('keeps code blocks in notes in place and single-line code inline', () => {
    const [item] = opmlItems([raw('use <code>npm i</code>', { note: 'before<code>a\nb</code>after' })], true);
    expect(item!.content).toBe('use `npm i`');
    expect(item!.note).toBe('before\n\n```\na\nb\n```\n\nafter');
  });

  it('uses a longer fence when the code has backtick fences of its own', () => {
    const [item] = opmlItems([raw('<code>```js\nx\n```</code>')], true);
    expect(item!.note).toBe('````\n```js\nx\n```\n````');
  });
});

describe('WorkFlowy ``` code blocks', () => {
  it('moves a fenced block out of the content, turning box-drawn tables into tables', () => {
    const table = '┌─────┬──────┐\n│ Run │ Cost │\n├─────┼──────┤\n│ a   │ 1    │\n└─────┴──────┘';
    const [item] = opmlItems([raw('Run results\n```\n' + table + '\n```')], true);
    expect(item!.content).toBe('Run results');
    expect(item!.note).toBe('| Run | Cost |\n| --- | --- |\n| a | 1 |');
  });

  it('uses the first code line as the title for a node that is only a fence', () => {
    const [item] = opmlItems([raw('```bash\n  pnpm build\n  pnpm test\n```')], true);
    expect(item!.content).toBe('pnpm build');
    expect(item!.note).toBe('```\npnpm build\npnpm test\n```');
  });

  it('decodes entities inside fences and handles several blocks in order', () => {
    const [item] = opmlItems([raw('a\n```\nx &lt; y\n```\nb\n```\nsecond\n```')], true);
    expect(item!.content).toBe('a b');
    expect(item!.note).toBe('```\nx < y\n```\n\n```\nsecond\n```');
  });
});

describe('fences in plain OPML', () => {
  it('moves them to the note without touching the code', () => {
    const [item] = opmlItems([raw('Log\n```\n<b> &amp; x\n```', { note: 'n' })]);
    expect(item).toEqual({ content: 'Log', note: '```\n<b> &amp; x\n```\n\nn', children: [] });
  });
});

describe('dedent', () => {
  it('drops only the indentation all lines share', () => {
    expect(fencedBlock('\n    a\n      b\n\n    c\n')).toBe('```\na\n  b\n\nc\n```');
  });
});

describe('WorkFlowy HTML: details', () => {
  it('decodes named entities in any case and numeric ones in range', () => {
    expect(decodeEntities('&quot;&apos;&gt;&lt;&amp;&nbsp;|')).toBe('"\'><& |');
    expect(decodeEntities('&AMP; &Lt;')).toBe('& <');
    expect(decodeEntities('&#X41;&#x42;&#67;')).toBe('ABC');
    expect(decodeEntities('&#0; &#x110000; &#1114111;')).toBe('&#0; &#x110000; \u{10FFFF}');
  });

  it('knows every WorkFlowy tag and needs them properly nested', () => {
    for (const tag of ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'pre', 'a', 'span', 'time', 'mark', 'font']) {
      expect(looksLikeWorkflowyHtml(`<${tag}>x</${tag}>`)).toBe(true);
    }
    expect(looksLikeWorkflowyHtml('<b><i>x</b></i>')).toBe(false);
    expect(looksLikeWorkflowyHtml('<b>x')).toBe(false);
  });

  it('maps strong, em, strike, del and code to Markdown marks', () => {
    expect(workflowyHtmlToMarkdown('<strong>a</strong> <em>b</em> <strike>c</strike> <del>d</del> <code>e</code>')).toBe('**a** *b* ~~c~~ ~~d~~ `e`');
  });

  it('reads href in single quotes, any case and with spaces around =', () => {
    expect(workflowyHtmlToMarkdown("<a href='https://a.dev'>a</a>")).toBe('[a](https://a.dev)');
    expect(workflowyHtmlToMarkdown('<a HREF = "https://b.dev">b</a>')).toBe('[b](https://b.dev)');
  });

  it('keeps the text of links without a target, and makes an empty link a bare URL', () => {
    expect(workflowyHtmlToMarkdown('<a>text</a>')).toBe('text');
    expect(workflowyHtmlToMarkdown('<a href="">text</a>')).toBe('text');
    expect(workflowyHtmlToMarkdown('see <a href="https://x.dev"></a>')).toBe('see <https://x.dev>');
  });

  it('ignores unknown tags and stray closing tags', () => {
    expect(workflowyHtmlToMarkdown('<b>x<div>y</b>')).toBe('**xy**');
    expect(workflowyHtmlToMarkdown('x</b>y')).toBe('xy');
  });

  it('keeps the spaces around a mark in notes, and drops trailing spaces before line breaks', () => {
    expect(workflowyHtmlToMarkdown('a<b>  x  </b>b', true)).toBe('a  **x**  b');
    expect(workflowyHtmlToMarkdown('a  <br>b', true)).toBe('a\nb');
  });
});

describe('WorkFlowy code blocks: details', () => {
  it('reads code spans with attributes, any kind of <br>, and nested tags', () => {
    expect(extractWorkflowyCodeBlocks('<code class="x">a\nb</code>').blocks).toEqual(['a\nb']);
    expect(extractWorkflowyCodeBlocks('<pre>a<br />b<BR/>c</pre>').blocks).toEqual(['a\nb\nc']);
    expect(extractWorkflowyCodeBlocks('<code><span class="x">a</span>\n<b>b</b></code>').blocks).toEqual(['a\nb']);
  });

  it('keeps code that is one line apart from trailing line breaks inline', () => {
    expect(extractWorkflowyCodeBlocks('<code>npm i\n</code>')).toEqual({ html: '<code>npm i\n</code>', blocks: [] });
  });

  it('leaves a space where a block was by default, or the placeholder given', () => {
    expect(extractWorkflowyCodeBlocks('a<code>x\ny</code>b')).toEqual({ html: 'a b', blocks: ['x\ny'] });
    expect(extractWorkflowyCodeBlocks('a<code>x\ny</code>b', '#').html).toBe('a#b');
    expect(extractFencedBlocks('a```\nx\n```b')).toEqual({ html: 'a b', blocks: ['x'] });
  });

  it('accepts a closing fence right after the code, and keeps many blocks in order', () => {
    expect(extractFencedBlocks('```\ncode```').blocks).toEqual(['code']);
    const many = Array.from({ length: 12 }, (_, i) => `<code>${i}\n${i}</code>`).join(' ');
    expect(extractWorkflowyCodeBlocks(many).blocks).toEqual(Array.from({ length: 12 }, (_, i) => `${i}\n${i}`));
  });

  it('trims every trailing blank line from a fenced block', () => {
    expect(fencedBlock('a\n\n\n')).toBe('```\na\n```');
  });

  it('titles a code-only node with its first non-blank line, without the ⏺ marker, cut at 80 characters', () => {
    expect(codeTitle('\n   \n  ⏺  hello  \nworld')).toBe('hello');
    expect(codeTitle('⏺x')).toBe('x');
    expect(codeTitle('a ⏺ b')).toBe('a ⏺ b');
    expect(codeTitle('   ')).toBe('');
    const eighty = 'x'.repeat(80);
    expect(codeTitle(eighty)).toBe(eighty);
    expect(codeTitle(`${'y'.repeat(78)} zzz`)).toBe(`${'y'.repeat(78)}…`);
    expect(codeTitle('z'.repeat(81))).toBe(`${'z'.repeat(79)}…`);
  });
});

describe('opmlItems: details', () => {
  it('treats the whole file as WorkFlowy when markup shows up in a note or a child', () => {
    expect(opmlItems([raw('R&amp;D', { note: '<b>x</b>' })])[0]).toEqual({ content: 'R&D', note: '**x**', children: [] });
    expect(opmlItems([raw('R&amp;D', { children: [raw('<i>y</i>')] })])[0]!.content).toBe('R&D');
    expect(opmlItems([raw('R&amp;D', { complete: true })])[0]!.content).toBe('~~R&D~~');
  });

  it('leaves plain text without fences exactly as written', () => {
    expect(opmlItems([raw('A  B\nC', { note: 'n  \n' })])).toEqual([{ content: 'A  B\nC', note: 'n  \n', children: [] }]);
  });

  it('collapses the text around a plain fence and adds no empty note paragraph', () => {
    expect(opmlItems([raw('Log   here\n```\nx\n```')])).toEqual([{ content: 'Log here', note: '```\nx\n```', children: [] }]);
    expect(opmlItems([raw('```\nfirst line\nmore\n```')])[0]!.content).toBe('first line');
  });

  it('keeps an empty item empty, even when completed', () => {
    expect(opmlItems([raw('<b></b>')], true)[0]!.content).toBe('');
    expect(opmlItems([raw('', { complete: true })], true)[0]!.content).toBe('');
  });

  it('trims the note text around code blocks', () => {
    const [item] = opmlItems([raw('t', { note: '  before  <code>a\nb</code>  after  ' })], true);
    expect(item!.note).toBe('before\n\n```\na\nb\n```\n\nafter');
  });
});
