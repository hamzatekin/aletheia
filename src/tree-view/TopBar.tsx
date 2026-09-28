import { useEffect, useRef } from 'react';

/**
 * Pixels at the top of the window the bar can cover (it is 52-56px tall), plus
 * a little air. Scrolling that brings a row into view keeps it below this.
 */
export const TOP_BAR_CLEARANCE_PX = 64;

/**
 * A solid strip behind the top buttons, like Dynalist's header, so text scrolls
 * under a surface instead of showing through the icons. It takes the color of
 * whatever it covers at the top (the desk around a book page, else the page)
 * and draws a hairline once the outline has scrolled under it.
 */
export function TopBar() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      if (ref.current) ref.current.dataset.scrolled = String(window.scrollY > 0);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return <div ref={ref} className="top-bar" aria-hidden="true" data-testid="top-bar" />;
}
