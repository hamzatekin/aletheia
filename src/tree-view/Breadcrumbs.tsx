import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { HOME_LABEL } from '@/app/sandbox';
import { plainText } from '@/editor/markdown';
import { isMac, plainClick, useCoarsePointer } from '@/ui/media';
import { useOutline } from './outline-context';
import { useAncestors } from './use-outline';

interface Props {
  rootId: string;
}

/**
 * ‹ Home › ancestor › ancestor, up in the top bar like WorkFlowy's, so every
 * page starts with just its title and the title sits at the same spot on Home
 * and on every zoomed page. The arrow goes up one level; any crumb zooms out
 * to it. On phones the crumbs stay on one line that scrolls sideways, starting
 * at the end so the nearest parent is in view.
 */
export function Breadcrumbs({ rootId }: Props) {
  const ancestors = useAncestors(rootId);
  const { navigate } = useOutline();
  // Through the page's navigate, so zooming out animates.
  const zoomOut = (to: string, from: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    void navigate(to, { state: { from } });
  };
  const coarse = useCoarsePointer();
  const navRef = useRef<HTMLElement>(null);
  const [overflowLeft, setOverflowLeft] = useState(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    nav.scrollLeft = nav.scrollWidth;
    setOverflowLeft(nav.scrollLeft > 0);
  }, [ancestors]);

  const parent = ancestors.at(-1);
  const parentName = parent ? plainText(parent.content) || 'Untitled' : HOME_LABEL;
  const crumb = 'shrink-0 truncate rounded px-1 py-0.5 hover:bg-hover hover:text-ink ' + (coarse ? 'max-w-40' : 'max-w-48');
  return (
    <div className="crumbs-bar fixed top-3 z-30 flex h-[34px] items-center text-sm text-muted pointer-coarse:top-[9px] pointer-coarse:h-10">
      <Link
        to={parent ? `/n/${parent.id}` : '/'}
        state={{ from: rootId }}
        onClick={zoomOut(parent ? `/n/${parent.id}` : '/', rootId)}
        className="flex size-[34px] shrink-0 items-center justify-center rounded-md hover:bg-hover hover:text-ink pointer-coarse:size-10"
        aria-label={`Back to ${parentName}`}
        title={`Back to ${parentName} (${isMac ? '⌘' : 'Ctrl+'},)`}
        data-testid="zoom-out"
      >
        <BackIcon />
      </Link>
      <nav
        ref={navRef}
        aria-label="Breadcrumbs"
        className="crumbs-scroll flex min-w-0 flex-nowrap items-center overflow-x-auto"
        data-overflow-left={overflowLeft || undefined}
        onScroll={(e) => setOverflowLeft(e.currentTarget.scrollLeft > 0)}
      >
        <Link to="/" state={{ from: ancestors[0]?.id ?? rootId }} onClick={zoomOut('/', ancestors[0]?.id ?? rootId)} className={crumb}>
          {HOME_LABEL}
        </Link>
        {ancestors.map((a, i) => (
          <span key={a.id} className="flex shrink-0 items-center">
            <span className="mx-0.5 select-none text-faint" aria-hidden="true">
              ›
            </span>
            <Link to={`/n/${a.id}`} state={{ from: ancestors[i + 1]?.id ?? rootId }} onClick={zoomOut(`/n/${a.id}`, ancestors[i + 1]?.id ?? rootId)} className={crumb}>
              {plainText(a.content) || 'Untitled'}
            </Link>
          </span>
        ))}
      </nav>
    </div>
  );
}

function BackIcon() {
  return (
    <svg className="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
