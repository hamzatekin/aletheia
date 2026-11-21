import { createContext, createMemo, createSignal, For, Show, useContext, type Accessor } from 'solid-js';
import { useEngine } from '@/app/engine-context';
import { appPath } from '@/app/routing';
import { HOME_LABEL } from '@/app/sandbox';
import { plainText } from '@/editor/markdown';
import { ancestorIds, parentKey } from '@/model';
import { useSettings, type SettingsStore } from '@/store/settings-store';
import { useTreeStore } from '@/store/tree-store';
import { isWide } from '@/ui/media';
import { useOutline } from './outline-context';
import { useNode } from './use-outline';
import { StarIcon, useStarred } from './Star';

interface Props {
  settings: SettingsStore;
}

interface SidebarContext {
  /** Ancestors of the zoomed node; kept expanded so it stays visible. */
  trail: Accessor<ReadonlySet<string>>;
  depthLimit: Accessor<number>;
}

const Ctx = createContext<SidebarContext>();
const EMPTY: readonly string[] = [];

function useChildren(id: Accessor<string | null>): Accessor<readonly string[]> {
  const engine = useEngine();
  return useTreeStore(engine.store, (s) => s.childrenByParent.get(parentKey(id())) ?? EMPTY);
}

/** The whole document as a clickable table of contents. Clicking an item zooms into it. */
export function OutlineSidebar(props: Props) {
  const { engine, actions, rootId } = useOutline();
  const open = useSettings(props.settings, (s) => s.sidebarOpen);
  const depthLimit = useSettings(props.settings, (s) => s.outlineDepth);
  const structureVersion = useTreeStore(engine.store, (s) => s.structureVersion);
  const trail = createMemo(() => {
    structureVersion(); // recompute when the hierarchy changes
    const root = rootId();
    return new Set(root === null ? [] : ancestorIds(engine.tree, root)) as ReadonlySet<string>;
  });
  const top = useChildren(() => null);
  const context: SidebarContext = { trail, depthLimit };

  // Below the wide breakpoint the sidebar floats over the page: close it after picking an item.
  const closeIfNarrow = (e: MouseEvent & { target: Element }) => {
    if (e.target.closest('a') && !isWide()) {
      props.settings.getState().update({ sidebarOpen: false });
    }
  };

  return (
    <Show when={open()}>
      {/* Narrow screens: a drawer above everything, the top-right buttons included. */}
      <div
        class="fixed inset-0 z-50 bg-black/20 lg:hidden"
        aria-hidden="true"
        onMouseDown={() => props.settings.getState().update({ sidebarOpen: false })}
      />
      <aside
        class="sidebar fixed inset-y-0 left-0 z-50 flex flex-col shadow-xl lg:z-30 lg:shadow-none"
        aria-label="Document outline"
        data-testid="outline-sidebar"
        onClick={closeIfNarrow}
      >
        <div class="flex items-center justify-between px-4 pt-4 pb-2">
          <span class="text-xs font-semibold tracking-wider text-muted uppercase">Outline</span>
          <button
            type="button"
            onClick={() => props.settings.getState().update({ sidebarOpen: false })}
            class="rounded p-1 text-muted hover:bg-hover hover:text-ink"
            aria-label="Hide outline"
            title="Hide outline (Ctrl+\)"
          >
            <SidebarIcon />
          </button>
        </div>
        <nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-6 text-sm">
          <a
            href={appPath('/')}
            noscroll
            class={['mb-1 flex items-center rounded px-2 py-1', rootId() === null ? 'bg-active font-medium' : 'text-muted hover:bg-hover']}
          >
            {HOME_LABEL}
          </a>
          <StarredList />
          <Ctx value={context}>
            <ul>
              <For each={top()}>{(id) => <Item id={id} depth={0} />}</For>
            </ul>
          </Ctx>
        </nav>
        <div class="border-t border-line p-2">
          <button
            type="button"
            onClick={() => actions.toggleHelp(true)}
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted hover:bg-hover"
          >
            <span class="flex size-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">?</span>
            Tutorial and shortcuts
          </button>
        </div>
      </aside>
    </Show>
  );
}

/** The starred nodes above the outline; a part of the open sidebar, so the list is kept only while it shows. */
function StarredList() {
  const { rootId } = useOutline();
  const starred = useStarred();
  return (
    <Show when={starred().length > 0}>
      <section class="mb-2 border-b border-line pb-2" aria-label="Starred" data-testid="starred-list">
        <div class="px-2 pt-1 pb-0.5 text-[11px] font-semibold tracking-wider text-faint uppercase">Starred</div>
        <ul>
          <For each={starred()}>{(id) => <StarredItem id={id} active={rootId() === id} />}</For>
        </ul>
      </section>
    </Show>
  );
}

/** A starred node: click to go there; the star unstars it. */
function StarredItem(props: { id: string; active: boolean }) {
  const { engine } = useOutline();
  const node = useNode(() => props.id);
  const title = () => plainText(node()?.content ?? '').trim() || 'Untitled';
  return (
    <Show when={node()}>
      <li class={['group flex items-center rounded pr-1', props.active ? 'bg-active font-medium' : 'text-muted']}>
        <button
          type="button"
          onClick={() => engine.execute({ type: 'toggleStar', id: props.id, starred: false })}
          class="star-on flex h-7 w-6 shrink-0 items-center justify-center rounded hover:text-ink"
          aria-label={`Unstar ${title()}`}
          title="Unstar"
        >
          <StarIcon filled size={13} />
        </button>
        <a href={appPath(`/n/${props.id}`)} noscroll class="min-w-0 flex-1 truncate rounded px-1 py-1 hover:bg-hover" title={title()} data-testid="starred-item">
          {title()}
        </a>
      </li>
    </Show>
  );
}

function Item(props: { id: string; depth: number }) {
  const { rootId } = useOutline();
  const { trail, depthLimit } = useContext(Ctx);
  const node = useNode(() => props.id);
  const kids = useChildren(() => props.id);
  const [override, setOverride] = createSignal<boolean | null>(null);
  const expanded = () => kids().length > 0 && (override() ?? (props.depth + 1 < depthLimit() || trail().has(props.id)));
  const active = () => rootId() === props.id;
  const title = () => plainText(node()?.content ?? '').trim() || 'Untitled';

  return (
    <Show when={node()}>
      <li>
        <div
          class={['group flex items-center rounded pr-2', active() ? 'bg-active font-medium' : trail().has(props.id) ? 'text-ink' : 'text-muted']}
          style={{ 'padding-left': `${props.depth * 14}px` }}
        >
          <Show when={kids().length > 0} fallback={<span class="w-5 shrink-0" />}>
            <button
              type="button"
              onClick={() => setOverride(!expanded())}
              class="flex h-7 w-5 shrink-0 items-center justify-center text-faint hover:text-ink"
              aria-label={expanded() ? 'Collapse in outline' : 'Expand in outline'}
              aria-expanded={expanded() ? 'true' : 'false'}
            >
              <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" class={{ '-rotate-90': !expanded() }}>
                <path d="M1.5 3 L5 7 L8.5 3 Z" />
              </svg>
            </button>
          </Show>
          <a
            href={appPath(`/n/${props.id}`)}
            noscroll
            class="min-w-0 flex-1 truncate rounded px-1 py-1 hover:bg-hover"
            title={title()}
            data-testid="outline-item"
          >
            {title()}
          </a>
        </div>
        <Show when={expanded()}>
          <ul>
            <For each={kids()}>{(k) => <Item id={k} depth={props.depth + 1} />}</For>
          </ul>
        </Show>
      </li>
    </Show>
  );
}

/** A panel icon; `side` says which edge the sidebar sits on. */
export function SidebarIcon(props: { side?: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" />
      <path d={(props.side ?? 'left') === 'left' ? 'M6 2.5v11' : 'M10 2.5v11'} />
    </svg>
  );
}
