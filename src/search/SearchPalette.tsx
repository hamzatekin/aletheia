import { useEffect, useMemo, useRef, useState } from 'react';
import { plainText } from '@/editor/markdown';
import { ancestorIds } from '@/model';
import { useUiStore } from '@/store/ui-store';
import { useOutline } from '@/tree-view/outline-context';

/** Ctrl/⌘+K: instant full-text search. Selecting zooms to the parent and focuses the node. */
export function SearchPalette() {
  const { engine, ui, search, actions } = useOutline();
  const open = useUiStore(ui, (s) => s.searchOpen);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const hits = useMemo(() => (open ? search.search(query, 20) : []), [open, search, query]);
  const selected = Math.min(index, Math.max(0, hits.length - 1));

  if (!open) return null;

  const close = () => ui.setSearchOpen(false);
  const choose = (i: number) => {
    const hit = hits[i];
    if (!hit) return;
    close();
    actions.revealNode(hit.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(selected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const pathOf = (id: string) =>
    ancestorIds(engine.tree, id)
      .reverse()
      .map((a) => plainText(engine.tree.get(a)?.content ?? ''))
      .join(' › ');

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/20 pt-[15vh]" onMouseDown={close} data-testid="search-palette">
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search…"
          aria-label="Search"
          className="w-full bg-transparent px-4 py-3 text-base outline-none placeholder:text-neutral-400"
        />
        {hits.length > 0 && (
          <ul role="listbox" className="max-h-80 overflow-y-auto border-t border-neutral-200 py-1 dark:border-neutral-700">
            {hits.map((hit, i) => {
              const node = engine.tree.get(hit.id);
              if (!node) return null;
              const path = pathOf(hit.id);
              return (
                <li
                  key={hit.id}
                  role="option"
                  aria-selected={i === selected}
                  data-testid="search-hit"
                  className={'cursor-pointer px-4 py-1.5 ' + (i === selected ? 'bg-neutral-100 dark:bg-neutral-800' : '')}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(i);
                  }}
                  onMouseEnter={() => setIndex(i)}
                >
                  <div className="truncate">{plainText(node.content) || 'Untitled'}</div>
                  {(path !== '' || node.note !== '') && (
                    <div className="truncate text-xs text-neutral-500">{path !== '' ? path : node.note.split('\n')[0]}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {query.trim() !== '' && hits.length === 0 && <div className="border-t border-neutral-200 px-4 py-2 text-sm text-neutral-400 dark:border-neutral-700">No results</div>}
      </div>
    </div>
  );
}
