import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Typesets the formulas of a rendered note with KaTeX. Loaded only once a
 * note with math shows, so KaTeX and its fonts stay out of the app bundle.
 * A formula KaTeX can't read shows as its source in red, as on GitHub.
 */
export function drawMath(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>('.math-inline, .math-display')) {
    if (el.firstElementChild) continue; // already drawn
    katex.render(el.textContent ?? '', el, { displayMode: el.classList.contains('math-display'), throwOnError: false, strict: 'ignore' });
  }
}
