import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { HOME_LABEL } from '@/app/sandbox';
import { plainText } from '@/editor/markdown';
import { isMac, useCoarsePointer } from '@/ui/media';
import { useAncestors } from './use-outline';

interface Props {
  rootId: string;
}

/** The phone top bar's height (3.25rem); see .top-bar in index.css. */
const TOP_BAR_PX = 52;


/**
 * Home › ancestor › ancestor, starting where the title's text starts. Clicking
 * any crumb zooms out to it, and the arrow in the gutter (where the star and
 * the bullets sit) goes up one level, like WorkFlowy's back button. On phones
 * the crumbs stay on one line that scrolls sideways, starting at the end so
 * the nearest parent is in view, and once they scroll under the top bar a
 * "‹ Parent" button pinned there keeps the way back in reach, as WorkFlowy's
 * phone app does.
 */
export function Breadcrumbs({ rootId }: Props) {
  const ancestors = useAncestors(rootId);
  const coarse = useCoarsePointer();
  const navRef = useRef<HTMLElement>(null);
  const [overflowLeft, setOverflowLeft] = useState(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!coarse || !nav) return;
    nav.scrollLeft = nav.scrollWidth;
    setOverflowLeft(nav.scrollLeft > 0);
  }, [coarse, ancestors]);

  // Phones: is the row of crumbs hidden under the top bar?
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scrolledPast, setScrolledPast] = useState(false);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!coarse || !wrap) return;
    const observer = new IntersectionObserver(([entry]) => setScrolledPast(!entry!.isIntersecting && entry!.boundingClientRect.top < TOP_BAR_PX), {
      rootMargin: `-${TOP_BAR_PX}px 0px 0px 0px`,
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [coarse]);

  const parent = ancestors.at(-1);
  const parentName = parent ? plainText(parent.content) || 'Untitled' : HOME_LABEL;
  const crumb = crumbClass(coarse);
  return (
    <div ref={wrapRef} className="crumbs relative mb-3">
      {coarse && scrolledPast && (
        <Link
          to={parent ? `/n/${parent.id}` : '/'}
          state={{ from: rootId }}
          className="fixed top-3 left-13 z-25 flex h-[34px] max-w-[min(9rem,calc(100vw-15rem))] items-center gap-0.5 rounded-md pr-2 pl-1 text-sm text-muted hover:bg-hover hover:text-ink"
          aria-label={`Back to ${parentName}`}
          data-testid="zoom-out-pinned"
        >
          <BackIcon />
          <span className="truncate">{parentName}</span>
        </Link>
      )}
      <Link
        to={parent ? `/n/${parent.id}` : '/'}
        state={{ from: rootId }}
        className="crumbs-back absolute flex items-center justify-center rounded-full text-muted hover:bg-hover hover:text-ink"
        aria-label={`Back to ${parentName}`}
        title={`Back to ${parentName} (${isMac ? '⌘' : 'Ctrl+'},)`}
        data-testid="zoom-out"
      >
        <BackIcon />
      </Link>
      <nav
        ref={navRef}
        aria-label="Breadcrumbs"
        className={'flex items-center text-sm text-muted ' + (coarse ? 'crumbs-scroll -mx-1.5 flex-nowrap overflow-x-auto' : '-mx-1 flex-wrap')}
        data-overflow-left={overflowLeft || undefined}
        onScroll={coarse ? (e) => setOverflowLeft(e.currentTarget.scrollLeft > 0) : undefined}
      >
        <Link to="/" state={{ from: ancestors[0]?.id ?? rootId }} className={crumb}>
          {HOME_LABEL}
        </Link>
        {ancestors.map((a, i) => (
          <span key={a.id} className="flex shrink-0 items-center">
            <span className="mx-0.5 select-none text-faint" aria-hidden="true">
              ›
            </span>
            <Link to={`/n/${a.id}`} state={{ from: ancestors[i + 1]?.id ?? rootId }} className={crumb}>
              {plainText(a.content) || 'Untitled'}
            </Link>
          </span>
        ))}
      </nav>
    </div>
  );
}

// The nav's negative margin equals the crumbs' padding, so the first crumb's text lines up with the title.
const crumbClass = (coarse: boolean) =>
  'truncate rounded hover:bg-hover hover:text-ink ' + (coarse ? 'max-w-40 shrink-0 px-1.5 py-1.5' : 'max-w-48 px-1 py-0.5');

/**
 * Home has no parents, so its breadcrumbs' line holds just a house, as
 * WorkFlowy's does: the line is never blank, so the first thing on every page
 * sits the same distance from the top, and the title and list stay put too.
 */
export function HomeCrumbs() {
  const coarse = useCoarsePointer();
  return (
    <div className={'crumbs mb-3 flex text-sm text-muted ' + (coarse ? '-mx-1.5' : '-mx-1')} data-testid="home-crumbs">
      <span className={coarse ? 'px-1.5 py-1.5' : 'px-1 py-0.5'} role="img" aria-label={`You are on ${HOME_LABEL}`} title={HOME_LABEL}>
        <svg className="inline-block align-[-2px]" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 10.5L12 3l9 7.5" />
          <path d="M5 9v11h14V9" />
        </svg>
      </span>
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
