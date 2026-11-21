import { createEffect, createSignal, For } from 'solid-js';
import { appPath } from '@/app/routing';
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
export function Breadcrumbs(props: Props) {
  const ancestors = useAncestors(() => props.rootId);
  const { navigate } = useOutline();
  // Through the page's navigate, so zooming out animates.
  const zoomOut = (e: MouseEvent, to: string, from: string) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    navigate(to, { state: { from } });
  };
  const coarse = useCoarsePointer();
  let nav: HTMLElement | undefined;
  const [overflowLeft, setOverflowLeft] = createSignal(false);

  // Start scrolled to the end, so the nearest parent is in view.
  createEffect(
    () => ancestors(),
    () => {
      if (!nav) return;
      nav.scrollLeft = nav.scrollWidth;
      setOverflowLeft(nav.scrollLeft > 0);
    },
  );

  const parent = () => ancestors().at(-1);
  const parentName = () => {
    const p = parent();
    return p ? plainText(p.content) || 'Untitled' : HOME_LABEL;
  };
  const parentPath = () => {
    const p = parent();
    return p ? `/n/${p.id}` : '/';
  };
  const homeFrom = () => ancestors()[0]?.id ?? props.rootId;
  const crumb = () => ['shrink-0 truncate rounded px-1 py-0.5 hover:bg-hover hover:text-ink', coarse() ? 'max-w-40' : 'max-w-48'];
  return (
    <div class="crumbs-bar fixed top-3 z-30 flex h-[34px] items-center text-sm text-muted pointer-coarse:top-[9px] pointer-coarse:h-10">
      <a
        href={appPath(parentPath())}
        noscroll
        onClick={(e) => zoomOut(e, parentPath(), props.rootId)}
        class="flex size-[34px] shrink-0 items-center justify-center rounded-md hover:bg-hover hover:text-ink pointer-coarse:size-10"
        aria-label={`Back to ${parentName()}`}
        title={`Back to ${parentName()} (${isMac ? '⌘' : 'Ctrl+'},)`}
        data-testid="zoom-out"
      >
        <BackIcon />
      </a>
      <nav
        ref={nav}
        aria-label="Breadcrumbs"
        class="crumbs-scroll flex min-w-0 flex-nowrap items-center overflow-x-auto"
        data-overflow-left={overflowLeft() ? 'true' : undefined}
        onScroll={(e) => setOverflowLeft(e.currentTarget.scrollLeft > 0)}
      >
        <a href={appPath('/')} noscroll onClick={(e) => zoomOut(e, '/', homeFrom())} class={crumb()}>
          {HOME_LABEL}
        </a>
        <For each={ancestors()} keyed={(a) => a.id}>
          {(a, i) => {
            const from = () => ancestors()[i() + 1]?.id ?? props.rootId;
            return (
              <span class="flex shrink-0 items-center">
                <span class="mx-0.5 select-none text-faint" aria-hidden="true">
                  ›
                </span>
                <a href={appPath(`/n/${a().id}`)} noscroll onClick={(e) => zoomOut(e, `/n/${a().id}`, from())} class={crumb()}>
                  {plainText(a().content) || 'Untitled'}
                </a>
              </span>
            );
          }}
        </For>
      </nav>
    </div>
  );
}

function BackIcon() {
  return (
    <svg class="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
