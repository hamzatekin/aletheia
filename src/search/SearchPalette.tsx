import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { plainText } from '@/editor/markdown';
import { ancestorIds } from '@/model';
import { useUiStore } from '@/store/ui-store';
import { useOutline } from '@/tree-view/outline-context';

/** Ctrl/⌘+K: instant full-text search. Selecting zooms to the parent and focuses the node. */
export function SearchPalette() {
  const { engine, ui, search, actions } = useOutline();
  const open = useUiStore(ui, (s) => s.searchOpen);
  const [query, setQuery] = createSignal('');
  const [index, setIndex] = createSignal(0);
  let inputEl: HTMLInputElement | undefined;

  createEffect(
    () => open(),
    (isOpen) => {
      if (isOpen) {
        setQuery('');
        setIndex(0);
        inputEl?.focus();
      }
    },
  );

  const hits = createMemo(() => (open() ? search.search(query(), 20) : []));
  const selected = () => Math.min(index(), Math.max(0, hits().length - 1));

  const close = () => ui.setSearchOpen(false);
  const choose = (i: number) => {
    const hit = hits()[i];
    if (!hit) return;
    close();
    actions.revealNode(hit.id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, hits().length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(selected());
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
    <Show when={open()}>
      <div class="fixed inset-0 z-30 flex items-start justify-center bg-black/20 pt-[15vh]" onMouseDown={close} data-testid="search-palette">
        <div class="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-surface shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={(e) => (inputEl = e)}
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search…"
            aria-label="Search"
            class="w-full bg-transparent px-4 py-3 text-base outline-none placeholder:text-faint"
          />
          <Show when={hits().length > 0}>
            <ul role="listbox" class="max-h-80 overflow-y-auto border-t border-line py-1">
              <For each={hits()}>
                {(hit, i) => {
                  const node = engine.tree.get(hit.id);
                  if (!node) return null;
                  const path = pathOf(hit.id);
                  return (
                    <li
                      role="option"
                      aria-selected={i() === selected() ? 'true' : 'false'}
                      data-testid="search-hit"
                      class={['cursor-pointer px-4 py-1.5', { 'bg-active': i() === selected() }]}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(i());
                      }}
                      onMouseEnter={() => setIndex(i())}
                    >
                      <div class="truncate">{plainText(node.content) || 'Untitled'}</div>
                      <Show when={path !== '' || node.note !== ''}>
                        <div class="truncate text-xs text-muted">{path !== '' ? path : node.note.split('\n')[0]}</div>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
          <Show when={query().trim() !== '' && hits().length === 0}>
            <div class="border-t border-line px-4 py-2 text-sm text-faint">No results</div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
