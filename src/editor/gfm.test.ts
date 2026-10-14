import { describe, expect, it } from 'vitest';
import { blockToHtml, inlineToHtml } from './markdown';
import { alertMarker } from './gfm';

const link = (href: string, text = href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

describe('GitHub Markdown in notes', () => {
  it('links bare http(s), www. and e-mail addresses, but not file names', () => {
    expect(blockToHtml('see https://x.y/a?b=1. www.x.org, README.md, a@b.co')).toBe(
      `<p>see ${link('https://x.y/a?b=1')}. ${link('http://www.x.org', 'www.x.org')}, README.md, ${link('mailto:a@b.co', 'a@b.co')}</p>\n`,
    );
    expect(inlineToHtml('www.x.org')).toBe(link('http://www.x.org', 'www.x.org'));
  });

  it('turns quotes starting with [!NOTE] and the like into titled alerts', () => {
    expect(blockToHtml('> [!TIP]\n> Use it')).toBe(
      '<blockquote class="markdown-alert markdown-alert-tip">\n<p><span class="markdown-alert-title">Tip</span>Use it</p>\n</blockquote>\n',
    );
    expect(blockToHtml('> [!warning] On one line')).toBe(
      '<blockquote class="markdown-alert markdown-alert-warning">\n<p><span class="markdown-alert-title">Warning</span>On one line</p>\n</blockquote>\n',
    );
    expect(blockToHtml('> [!NOTICE] not a kind')).toBe('<blockquote>\n<p>[!NOTICE] not a kind</p>\n</blockquote>\n');
    expect(blockToHtml('[!NOTE] not a quote')).toBe('<p>[!NOTE] not a quote</p>\n');
  });

  it('keeps the HTML tags GitHub keeps and shows any other tag as text', () => {
    expect(blockToHtml('<kbd>K</kbd> and H<sub>2</sub>O, <Component> and <script>x</script>')).toBe(
      '<p><kbd>K</kbd> and H<sub>2</sub>O, &lt;Component&gt; and &lt;script&gt;x&lt;/script&gt;</p>\n',
    );
    expect(blockToHtml('<details><summary>Log</summary>\n\nbody\n</details>')).toBe('<details><summary>Log</summary>\n<p>body</p>\n</details>');
    expect(blockToHtml('<Foo>\n\nnext')).toBe('<p>&lt;Foo&gt;</p>\n<p>next</p>\n');
    expect(blockToHtml('<!-- hidden -->')).toBe('<!-- hidden -->');
  });

  it('keeps raw HTML out of a node\'s line', () => {
    expect(inlineToHtml('<kbd>K</kbd>')).toBe('&lt;kbd&gt;K&lt;/kbd&gt;');
  });

  it('shows images', () => {
    expect(blockToHtml('![a diagram](https://x.y/d.png "Title")')).toBe('<p><img src="https://x.y/d.png" alt="a diagram" title="Title"></p>\n');
  });

  it('colours code in fences that name a known language, and only those', () => {
    expect(blockToHtml('```py\nx = 1\n```')).toBe('<pre><code class="language-py">x = <span class="hljs-number">1</span>\n</code></pre>\n');
    expect(blockToHtml('```\nx = 1\n```')).toBe('<pre><code>x = 1\n</code></pre>\n');
    expect(blockToHtml('```nope\nx = 1\n```')).toBe('<pre><code class="language-nope">x = 1\n</code></pre>\n');
  });

  it('collects footnotes at the end, with anchors of their own note', () => {
    expect(blockToHtml('a[^1]\n\n[^1]: n', 'node')).toBe(
      '<p>a<sup class="footnote-ref"><a href="#fn-node-1" id="fnref-node-1">[1]</a></sup></p>\n' +
        '<hr class="footnotes-sep">\n<section class="footnotes">\n<ol class="footnotes-list">\n' +
        '<li id="fn-node-1" class="footnote-item"><p>n <a href="#fnref-node-1" class="footnote-backref">↩︎</a></p>\n</li>\n</ol>\n</section>\n',
    );
  });

  it('turns :shortcodes: into emoji, but not smileys', () => {
    expect(blockToHtml(':tada: :white_check_mark: :) :-)')).toBe('<p>🎉 ✅ :) :-)</p>\n');
  });

  it('aligns table columns', () => {
    expect(blockToHtml('| a | b |\n|:-|-:|\n| 1 | 2 |')).toBe(
      '<table>\n<thead>\n<tr>\n<th style="text-align:left">a</th>\n<th style="text-align:right">b</th>\n</tr>\n</thead>\n' +
        '<tbody>\n<tr>\n<td style="text-align:left">1</td>\n<td style="text-align:right">2</td>\n</tr>\n</tbody>\n</table>\n',
    );
  });
});

describe('alertMarker', () => {
  it('reads the kind and the length of the marker with what follows it on its line', () => {
    expect(alertMarker('[!NOTE]\nrest')).toEqual({ kind: 'note', length: 8 });
    expect(alertMarker('[!Caution]  rest')).toEqual({ kind: 'caution', length: 12 });
    expect(alertMarker('[!NOTE]')).toEqual({ kind: 'note', length: 7 });
    expect(alertMarker(' [!NOTE]')).toBeNull();
    expect(alertMarker('[!HINT]')).toBeNull();
  });
});
