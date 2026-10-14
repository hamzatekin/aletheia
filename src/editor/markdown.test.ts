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

  it('links bare URLs as GitHub does and keeps soft breaks as newlines', () => {
    expect(inlineToHtml('see https://x.y')).toBe('see <a href="https://x.y" target="_blank" rel="noopener noreferrer">https://x.y</a>');
    expect(blockToHtml('a\nb')).toBe('<p>a\nb</p>\n');
  });

  it('links bare http(s) and e-mail addresses, but not file names or www. without a scheme', () => {
    const link = (href: string, text = href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    expect(blockToHtml('see https://x.y/a?b=1. www.x.org, README.md, a@b.co')).toBe(
      `<p>see ${link('https://x.y/a?b=1')}. www.x.org, README.md, ${link('mailto:a@b.co', 'a@b.co')}</p>\n`,
    );
  });

  it('shows images in notes, lazily and without a referrer', () => {
    expect(blockToHtml('![a diagram](https://x.y/d.png "Title")')).toBe(
      '<p><img src="https://x.y/d.png" alt="a diagram" title="Title" referrerpolicy="no-referrer" loading="lazy"></p>\n',
    );
  });

  it('shows code fences as plain code', () => {
    expect(blockToHtml('```py\nx = 1\n```')).toBe('<pre><code class="language-py">x = 1\n</code></pre>\n');
  });

  it('aligns table columns', () => {
    expect(blockToHtml('| a | b |\n|:-|-:|\n| 1 | 2 |')).toBe(
      '<table>\n<thead>\n<tr>\n<th style="text-align:left">a</th>\n<th style="text-align:right">b</th>\n</tr>\n</thead>\n' +
        '<tbody>\n<tr>\n<td style="text-align:left">1</td>\n<td style="text-align:right">2</td>\n</tr>\n</tbody>\n</table>\n',
    );
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
