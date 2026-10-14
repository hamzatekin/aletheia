import { useLayoutEffect, useMemo, useRef, type HTMLAttributes } from 'react';
import { renderBlock } from './render';

type DrawMath = (root: HTMLElement) => void;
let drawMath: DrawMath | undefined;
let loading: Promise<DrawMath> | undefined;

/** KaTeX, fetched the first time a note needs it (tried again later if that fails, say offline). */
function loadMath(): Promise<DrawMath> {
  loading ??= import('./draw-math').then(
    (m) => (drawMath = m.drawMath),
    (error: unknown) => {
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

/**
 * A note rendered as GitHub Markdown. Formulas are typeset after render;
 * once KaTeX has loaded that happens before paint, so notes don't jump.
 */
export function RenderedNote({ note, docId, ...props }: { note: string; docId?: string | undefined } & HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderBlock(note, docId), [note, docId]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el?.querySelector('.math-inline, .math-display')) return;
    if (drawMath) drawMath(el);
    // Offline before KaTeX was ever fetched, the TeX stays as written.
    else loadMath().then((draw) => el.isConnected && draw(el), () => {});
  }, [html]);
  return <div ref={ref} {...props} dangerouslySetInnerHTML={{ __html: html }} />;
}
