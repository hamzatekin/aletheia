import { describe, expect, it } from 'vitest';
import { opmlItems, type RawOutline } from './import';
import { decodeEntities, looksLikeWorkflowyHtml, workflowyHtmlToMarkdown } from './workflowy';

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
