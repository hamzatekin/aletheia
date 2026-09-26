import { createContext, memo, useContext, useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { useEngine } from '@/app/engine-context';
import { plainText } from '@/editor/markdown';
import { ancestorIds, parentKey } from '@/model';
import { useSettings, type SettingsStore } from '@/store/settings-store';
import { useTreeStore } from '@/store/tree-store';
import { useOutline } from './outline-context';
import { useNode } from './use-outline';

interface Props {
  settings: SettingsStore;
  rootId: string | null;
}

interface SidebarContext {
  rootId: string | null;
  /** Ancestors of the zoomed node; kept expanded so it stays visible. */
  trail: ReadonlySet<string>;
  depthLimit: number;
}

const Ctx = createContext<SidebarContext>({ rootId: null, trail: new Set(), depthLimit: 2 });
const EMPTY: readonly string[] = [];

function useChildren(id: string | null): readonly string[] {
  const engine = useEngine();
  return useTreeStore(engine.store, (s) => s.childrenByParent.get(parentKey(id)) ?? EMPTY);
}

/** The whole document as a clickable table of contents. Clicking an item zooms into it. */
export function OutlineSidebar({ settings, rootId }: Props) {
  const engine = useEngine();
  const { ui, session } = useOutline();
  const open = useSettings(settings, (s) => s.sidebarOpen);
  const depthLimit = useSettings(settings, (s) => s.outlineDepth);
  const structureVersion = useTreeStore(engine.store, (s) => s.structureVersion);
  const trail = useMemo(
    () => new Set(rootId === null ? [] : ancestorIds(engine.tree, rootId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when the hierarchy changes
    [engine, rootId, structureVersion],
  );
  const top = useChildren(null);
  const context = useMemo(() => ({ rootId, trail, depthLimit }), [rootId, trail, depthLimit]);
  if (!open) return null;

  // Below the wide breakpoint the sidebar floats over the page: close it after picking an item.
  const closeIfNarrow = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a') && !window.matchMedia('(min-width: 1024px)').matches) {
      settings.getState().update({ sidebarOpen: false });
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-20 bg-black/20 lg:hidden"
        aria-hidden="true"
        onMouseDown={() => settings.getState().update({ sidebarOpen: false })}
      />
      <aside
        className="sidebar fixed inset-y-0 left-0 z-30 flex flex-col shadow-xl lg:shadow-none"
        aria-label="Document outline"
        data-testid="outline-sidebar"
        onClick={closeIfNarrow}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-xs font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">Outline</span>
          <button
            type="button"
            onClick={() => settings.getState().update({ sidebarOpen: false })}
            className="rounded p-1 text-neutral-500 hover:bg-(--subtle) hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
            aria-label="Hide outline"
            title="Hide outline (Ctrl+\)"
          >
            <SidebarIcon />
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 text-sm">
          <Link
            to="/"
            className={
              'mb-1 flex items-center rounded px-2 py-1 ' +
              (rootId === null ? 'bg-(--subtle) font-medium' : 'text-neutral-600 hover:bg-(--subtle) dark:text-neutral-300')
            }
          >
            Home
          </Link>
          <Ctx.Provider value={context}>
            <ul>
              {top.map((id) => (
                <Item key={id} id={id} depth={0} />
              ))}
            </ul>
          </Ctx.Provider>
        </nav>
        <div className="border-t border-(--subtle) p-2">
          <button
            type="button"
            onClick={() => {
              session.flush();
              ui.blur();
              ui.setHelpOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-600 hover:bg-(--subtle) dark:text-neutral-300"
          >
            <span className="flex size-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">?</span>
            Tutorial and shortcuts
          </button>
        </div>
      </aside>
    </>
  );
}

const Item = memo(function Item({ id, depth }: { id: string; depth: number }) {
  const { rootId, trail, depthLimit } = useContext(Ctx);
  const node = useNode(id);
  const kids = useChildren(id);
  const [override, setOverride] = useState<boolean | null>(null);
  if (!node) return null;
  const expanded = kids.length > 0 && (override ?? (depth + 1 < depthLimit || trail.has(id)));
  const active = rootId === id;
  const title = plainText(node.content).trim() || 'Untitled';

  return (
    <li>
      <div
        className={
          'group flex items-center rounded pr-2 ' +
          (active ? 'bg-(--subtle) font-medium' : trail.has(id) ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-600 dark:text-neutral-300')
        }
        style={{ paddingLeft: depth * 14 }}
      >
        {kids.length > 0 ? (
          <button
            type="button"
            onClick={() => setOverride(!expanded)}
            className="flex h-7 w-5 shrink-0 items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            aria-label={expanded ? 'Collapse in outline' : 'Expand in outline'}
            aria-expanded={expanded}
          >
            <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" className={expanded ? '' : '-rotate-90'}>
              <path d="M1.5 3 L5 7 L8.5 3 Z" />
            </svg>
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Link
          to={`/n/${id}`}
          className="min-w-0 flex-1 truncate rounded px-1 py-1 hover:bg-(--subtle)"
          title={title}
          data-testid="outline-item"
        >
          {title}
        </Link>
      </div>
      {expanded && (
        <ul>
          {kids.map((k) => (
            <Item key={k} id={k} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
});

export function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" />
      <path d="M6 2.5v11" />
    </svg>
  );
}
