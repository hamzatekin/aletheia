import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { plainText } from '@/editor/markdown';
import { useCoarsePointer } from './MobileToolbar';
import { useAncestors } from './use-outline';

interface Props {
  rootId: string;
}

/**
 * Home › ancestor › ancestor. Clicking any crumb zooms out to it. On phones
 * they stay on one line that scrolls sideways, starting at the end so the
 * nearest parent is in view.
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

  const crumb =
    'truncate rounded hover:bg-hover hover:text-ink ' + (coarse ? 'max-w-40 shrink-0 px-2 py-1.5' : 'max-w-48 px-1 py-0.5');
  return (
    <nav
      ref={navRef}
      aria-label="Breadcrumbs"
      className={'mb-3 flex items-center text-sm text-muted ' + (coarse ? 'crumbs-scroll -mx-2 flex-nowrap overflow-x-auto' : 'flex-wrap')}
      data-overflow-left={overflowLeft || undefined}
      onScroll={coarse ? (e) => setOverflowLeft(e.currentTarget.scrollLeft > 0) : undefined}
    >
      <Link to="/" className={crumb}>
        Home
      </Link>
      {ancestors.map((a) => (
        <span key={a.id} className="flex shrink-0 items-center">
          <span className="mx-0.5 select-none text-faint">›</span>
          <Link to={`/n/${a.id}`} className={crumb}>
            {plainText(a.content) || 'Untitled'}
          </Link>
        </span>
      ))}
    </nav>
  );
}
