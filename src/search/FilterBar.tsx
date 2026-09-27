import { useEffect, useRef } from 'react';
import { useUiStore } from '@/store/ui-store';
import { useOutline } from '@/tree-view/outline-context';
import { usePageRows } from '@/tree-view/use-outline';
import { isFiltering, matchCount, queryWords } from './filter';

/**
 * The in-place search bar at the top of the page (magnifier, Ctrl/⌘+F).
 * Typing filters the page to the matching rows and their parents.
 */
export function FilterBar() {
  const { ui, actions, rootId, session } = useOutline();
  const filter = useUiStore(ui, (s) => s.filter);
  const rows = usePageRows(rootId);
  const inputRef = useRef<HTMLInputElement>(null);
  const on = filter !== null;
  const words = filter ? queryWords(filter.query) : [];

  useSearchHighlight(words);

  useEffect(() => {
    if (on) inputRef.current?.focus();
  }, [on]);

  if (!filter) return null;
  const count = isFiltering(filter) ? matchCount(rows) : null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Keys typed here belong to the input, not to the outline (Ctrl+Z, Enter, Tab…).
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      e.currentTarget.select();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      actions.closeFilter();
    } else if ((e.key === 'Enter' || e.key === 'ArrowDown') && rows.length > 0) {
      // Into the results: edit the first match (or the first row).
      e.preventDefault();
      const first = rows.find((r) => r.match) ?? rows[0]!;
      ui.focusNode(first.id, { kind: 'end' });
    }
  };

  return (
    <div className="filter-bar mb-4 flex items-center gap-2 rounded-md border border-line px-2.5" data-testid="filter-bar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-faint">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m20 20-4.2-4.2" />
      </svg>
      <input
        ref={inputRef}
        value={filter.query}
        onChange={(e) => ui.setFilter({ query: e.target.value, keep: new Set(), open: new Map() })}
        onFocus={() => {
          if (ui.getState().focus) {
            session.flush();
            ui.blur();
          }
        }}
        onKeyDown={onKeyDown}
        placeholder="Search this page"
        aria-label="Search this page"
        enterKeyHint="search"
        className="min-w-0 flex-1 bg-transparent py-1.5 text-[0.9em] outline-none placeholder:text-faint"
        data-testid="filter-input"
      />
      {count !== null && (
        <span className="shrink-0 text-xs text-faint tabular-nums" data-testid="filter-count">
          {count === 1 ? '1 match' : `${count} matches`}
        </span>
      )}
      <button
        type="button"
        onClick={() => actions.closeFilter()}
        onMouseDown={(e) => e.preventDefault()}
        className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-ink"
        aria-label="Close search"
        title="Close search (Esc)"
        data-testid="filter-close"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Marks the search words in the rows on screen with the CSS Custom Highlight
 * API, which paints without touching the DOM (so editors are unaffected).
 * Rows mount and unmount as the list scrolls, so it follows DOM changes.
 */
function useSearchHighlight(words: string[]) {
  const key = words.join('\u0000');
  useEffect(() => {
    const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
    if (!registry || typeof Highlight === 'undefined') return;
    if (words.length === 0) {
      registry.delete('search');
      return;
    }
    let frame = 0;
    const paint = () => {
      frame = 0;
      const ranges: Range[] = [];
      for (const el of document.querySelectorAll('[data-testid="outline"] .node-content, [data-testid="outline"] .node-note')) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const text = (t.nodeValue ?? '').toLowerCase();
          for (const w of words) {
            for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + w.length)) {
              const r = new Range();
              r.setStart(t, i);
              r.setEnd(t, i + w.length);
              ranges.push(r);
            }
          }
        }
      }
      registry.set('search', new Highlight(...ranges));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(paint);
    };
    paint();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      registry.delete('search');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the words
  }, [key]);
}
