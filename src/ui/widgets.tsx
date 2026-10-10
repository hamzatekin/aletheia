import type { ReactNode } from 'react';

/** A small spinning ring, sized for a line of text. */
export function Spinner() {
  return <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-faint border-t-transparent" aria-hidden="true" />;
}

/** Classes for the pill at the top centre of the page (AI notices, sync download progress). */
export const TOP_BANNER =
  'fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink shadow-lg';

/** The small bordered button of the settings sections. Without `onClick` it submits its form. */
export function Button({ primary, disabled, onClick, children }: { primary?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      disabled={disabled}
      onClick={onClick}
      className={
        'rounded border px-2.5 py-1 text-xs disabled:opacity-50 ' +
        (primary ? 'border-accent bg-selection text-accent hover:opacity-90' : 'border-line hover:bg-hover')
      }
    >
      {children}
    </button>
  );
}

/** "just now", "40s ago", "5 min ago", or the date. */
export function ago(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return new Date(at).toLocaleString();
}
