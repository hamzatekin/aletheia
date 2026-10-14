import markdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { blockToHtml } from './markdown';
import { inlineMathAt, inlineMathSpans, math } from './math';
import { sourceBlocks } from './note-source';

describe('inlineMathAt', () => {
  it('reads $tex$ and $`tex`$', () => {
    expect(inlineMathAt('a $x^2$ b', 2)).toEqual({ tex: 'x^2', end: 7 });
    expect(inlineMathAt('$`a $ b`$', 0)).toEqual({ tex: 'a $ b', end: 9 });
  });

  it('skips an escaped closing $', () => {
    expect(inlineMathAt('$a\\$b$', 0)).toEqual({ tex: 'a\\$b', end: 6 });
  });

  it('leaves money and loose dollars alone', () => {
    expect(inlineMathAt('$5 and $10', 0)).toBeNull();
    expect(inlineMathAt('$ x$', 0)).toBeNull();
    expect(inlineMathAt('$x $', 0)).toBeNull();
    expect(inlineMathAt('$$x$$', 0)).toBeNull();
    expect(inlineMathAt('$x', 0)).toBeNull();
    expect(inlineMathAt('$', 0)).toBeNull();
    expect(inlineMathAt('$`x', 0)).toBeNull();
    expect(inlineMathAt('$x\n\ny$', 0)).toBeNull();
    expect(inlineMathAt('x$', 0)).toBeNull();
  });

  it('lets a formula span one line break', () => {
    expect(inlineMathAt('$a\nb$', 0)).toEqual({ tex: 'a\nb', end: 5 });
  });
});

describe('inlineMathSpans', () => {
  it('finds every formula, and none behind a backslash', () => {
    expect(inlineMathSpans('a $x$ and $`y`$, \\$z$ $5')).toEqual([
      [2, 5],
      [10, 15],
    ]);
    expect(inlineMathSpans('no math')).toEqual([]);
  });
});

describe('math in rendered notes', () => {
  it('marks inline formulas for KaTeX', () => {
    expect(blockToHtml('Energy $E=mc^2$ costs $5 and $10, $`a<b`$.')).toBe(
      '<p>Energy <span class="math-inline">E=mc^2</span> costs $5 and $10, <span class="math-inline">a&lt;b</span>.</p>\n',
    );
  });

  it('marks $$ blocks and ```math fences as display formulas', () => {
    expect(blockToHtml('$$\n\\int_0^1 x\\,dx\n$$\nafter')).toBe('<div class="math-display">\\int_0^1 x\\,dx</div>\n<p>after</p>\n');
    expect(blockToHtml('$$ a + b $$')).toBe('<div class="math-display">a + b</div>\n');
    expect(blockToHtml('$$a\nb$$')).toBe('<div class="math-display">a\nb</div>\n');
    expect(blockToHtml('```math\nx^2\n```')).toBe('<div class="math-display">x^2</div>\n');
  });

  it('leaves an unclosed $$ and an indented one as text', () => {
    expect(blockToHtml('$$\nx')).toBe('<p>$$\nx</p>\n');
    expect(blockToHtml('    $$x$$')).toBe('<pre><code>$$x$$\n</code></pre>\n');
  });

  it('keeps formulas away from emoji and Markdown', () => {
    expect(blockToHtml('$a_1 *b* :tada:$')).toBe('<p><span class="math-inline">a_1 *b* :tada:</span></p>\n');
  });
});

describe('math as source (the note editor)', () => {
  const md = markdownIt().use(math, { render: 'source' }).use(math, { render: 'source' });

  it('shows formulas as written and $$ blocks as math code', () => {
    expect(md.render('a $x_1$ b\n\n$$\n\\frac{1}{2}\n$$')).toBe('<p>a $x_1$ b</p>\n<pre><code class="language-math">\\frac{1}{2}\n</code></pre>\n');
  });

  it('counts a $$ block with blank lines in it as one block', () => {
    expect(sourceBlocks('$$\na\n\nb\n$$\n\nnext')).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 7 },
    ]);
  });
});
