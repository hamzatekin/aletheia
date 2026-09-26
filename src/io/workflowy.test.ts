import { describe, expect, it } from 'vitest';
import { opmlItems, type RawOutline } from './import';
import { decodeEntities, fencedBlock, looksLikeWorkflowyHtml, workflowyHtmlToMarkdown } from './workflowy';

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
