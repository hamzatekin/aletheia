import { describe, expect, it } from 'vitest';
import { blockToHtml, inlineToHtml, plainText } from './markdown';

describe('markdown dialect', () => {
  it('renders inline marks without a paragraph wrapper', () => {
    expect(inlineToHtml('**b** *i* `c` ~~s~~')).toBe('<strong>b</strong> <em>i</em> <code>c</code> <s>s</s>');
  });

  it('links open in a new tab', () => {
    expect(inlineToHtml('[wf](https://workflowy.com)')).toBe(
      '<a href="https://workflowy.com" target="_blank" rel="noopener noreferrer">wf</a>',
    );
  });

  it('escapes raw HTML instead of passing it through', () => {
    expect(inlineToHtml('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
    expect(inlineToHtml('a <script>alert(1)</script>')).toContain('&lt;script&gt;');
  });

  it('does not linkify bare URLs and keeps soft breaks as newlines', () => {
    expect(inlineToHtml('see https://x.y')).toBe('see https://x.y');
    expect(blockToHtml('a\nb')).toBe('<p>a\nb</p>\n');
  });

  it('renders block notes with paragraphs and lists', () => {
    expect(blockToHtml('p1\n\n- one\n- two')).toBe('<p>p1</p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n');
  });
});

describe('plainText', () => {
  it('strips marks and keeps link text', () => {
    expect(plainText('**b** and [l](http://x) `c`')).toBe('b and l c');
    expect(plainText('')).toBe('');
  });
});
